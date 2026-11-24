// 廠商計費寫入的輸入驗證（純函式；web server action 與 MCP 工具共用，client 也可以 import 常數）。
// 驗證失敗丟 VendorBillingInputError，訊息給人看（zh-TW）。

export const VENDOR_PROVIDERS = ["azure", "gcp", "aws", "cloudflare", "other"] as const;
export type VendorProvider = (typeof VENDOR_PROVIDERS)[number];

export const PAYMENT_METHOD_KINDS = ["card", "reseller_invoice", "bank_transfer", "wise_card", "other"] as const;
export type PaymentMethodKind = (typeof PAYMENT_METHOD_KINDS)[number];

export const LEDGER_MODES = ["match_only", "create_unmatched"] as const;
export type LedgerModeValue = (typeof LEDGER_MODES)[number];

export const ACCOUNT_STATUSES = ["active", "closed", "missing"] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

/** 固定支出的扣款週期（vendor_billing_accounts.schedule）；null = 不提醒（不算固定支出）。 */
export const ACCOUNT_SCHEDULES = ["fixed", "usage"] as const;
export type AccountSchedule = (typeof ACCOUNT_SCHEDULES)[number];

export const INVOICE_ACTIONS = ["confirm", "link", "unlink", "ignore", "create"] as const;
export type InvoiceAction = (typeof INVOICE_ACTIONS)[number];

export type { MatchStatus } from "./match";

export class VendorBillingInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VendorBillingInputError";
  }
}

function oneOf<T extends string>(v: unknown, allowed: readonly T[], label: string): T {
  if (typeof v === "string" && (allowed as readonly string[]).includes(v)) return v as T;
  throw new VendorBillingInputError(`${label}必須是 ${allowed.join(" / ")} 之一`);
}

function text(v: unknown, label: string, max = 200): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") throw new VendorBillingInputError(`${label}必須是文字`);
  const t = v.trim();
  if (t.length > max) throw new VendorBillingInputError(`${label}太長（最多 ${max} 字）`);
  return t === "" ? null : t;
}

function id(v: unknown, label: string): number | null {
  if (v === undefined || v === null || v === "" || v === "none") return null;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isSafeInteger(n) || n <= 0) throw new VendorBillingInputError(`${label}不是有效的 id`);
  return n;
}

const has = (o: Record<string, unknown>, k: string) => Object.hasOwn(o, k);

// ---------------------------------------------------------------------------
// 付款方式
// ---------------------------------------------------------------------------

export type PaymentMethodPatch = {
  id: number | null;
  kind?: PaymentMethodKind;
  label?: string;
  brand?: string | null;
  last4?: string | null;
  expiryMonth?: number | null;
  expiryYear?: number | null;
  holderName?: string | null;
  settlesFromAccountId?: number | null;
  isActive?: boolean;
  note?: string | null;
};

function requiredText(label: string, max: number, missing: string) {
  return (v: unknown): string => {
    const t = text(v, label, max);
    if (!t) throw new VendorBillingInputError(missing);
    return t;
  };
}

/** 末四碼：空 → null；剛好 4 位數字才收；更長的數字視為有人貼了完整卡號，拒絕且不截斷。 */
function parseLast4(v: unknown): string | null {
  if (v !== null && v !== undefined && typeof v !== "string" && typeof v !== "number") {
    throw new VendorBillingInputError("末四碼必須是 4 位數字");
  }
  const s = v === null || v === undefined ? "" : String(v).replaceAll(/[\s•*-]/g, "");
  if (s === "") return null;
  if (/^\d{4}$/.test(s)) return s;
  if (/^\d{5,}$/.test(s)) throw new VendorBillingInputError("只能存卡號末四碼，請勿輸入完整卡號");
  throw new VendorBillingInputError("末四碼必須是 4 位數字");
}

function optNumber(v: unknown): number | null {
  return v === null || v === undefined || v === "" ? null : Number(v);
}

function parseExpiryMonth(v: unknown): number | null {
  const m = optNumber(v);
  if (m !== null && (!Number.isInteger(m) || m < 1 || m > 12)) throw new VendorBillingInputError("到期月份必須是 1～12");
  return m;
}

/** 兩位數年份當 20xx。 */
function parseExpiryYear(v: unknown): number | null {
  let y = optNumber(v);
  if (y !== null && y >= 0 && y < 100) y += 2000;
  if (y !== null && (!Number.isInteger(y) || y < 2000 || y > 2100)) throw new VendorBillingInputError("到期年份不對");
  return y;
}

function parseBool(label: string) {
  return (v: unknown): boolean => {
    if (typeof v !== "boolean") throw new VendorBillingInputError(`${label} 必須是 true / false`);
    return v;
  };
}

type FieldParsers = Record<string, (v: unknown) => unknown>;

/** 只處理有傳的欄位（PATCH 語意：沒傳 = 不動）。 */
function applyFields(raw: Record<string, unknown>, parsers: FieldParsers): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, parse] of Object.entries(parsers)) {
    if (has(raw, key)) out[key] = parse(raw[key]);
  }
  return out;
}

const PAYMENT_METHOD_FIELDS: FieldParsers = {
  kind: (v) => oneOf(v, PAYMENT_METHOD_KINDS, "種類"),
  label: requiredText("名稱", 120, "請填寫付款方式名稱"),
  brand: (v) => text(v, "卡別", 60),
  last4: parseLast4,
  expiryMonth: parseExpiryMonth,
  expiryYear: parseExpiryYear,
  holderName: (v) => text(v, "持卡人", 120),
  settlesFromAccountId: (v) => id(v, "扣款帳戶"),
  isActive: parseBool("isActive"),
  note: (v) => text(v, "備註", 2000),
};

/**
 * 只存卡別、末四碼、到期、持卡人 —— 末四碼欄位收到更長的數字（有人貼了完整卡號）直接拒絕，
 * 不截斷、不存。沒傳的欄位不動（PATCH 語意）；新增時 kind 與 label 必填。
 */
export function normalizePaymentMethodInput(raw: Record<string, unknown>): PaymentMethodPatch {
  const out = { id: id(raw.id, "付款方式"), ...applyFields(raw, PAYMENT_METHOD_FIELDS) } as PaymentMethodPatch;
  if (out.id === null && (!out.kind || !out.label)) {
    throw new VendorBillingInputError("新增付款方式要填種類與名稱");
  }
  return out;
}

/** 同步來的（Azure）付款方式：卡的事實以平台為準，只能改名稱、扣款帳戶、啟用、備註。 */
export const SYNCED_PAYMENT_METHOD_EDITABLE = new Set(["label", "settlesFromAccountId", "isActive", "note"]);

// ---------------------------------------------------------------------------
// 計費帳號
// ---------------------------------------------------------------------------

export type BillingAccountPatch = {
  id: number | null;
  provider?: VendorProvider;
  externalId?: string | null;
  displayName?: string;
  partyId?: number | null;
  matchPartyIds?: number[];
  paymentMethodId?: number | null;
  ownerUserId?: string | null;
  ledgerMode?: LedgerModeValue;
  /** GCP：抵用點數記進管理帳（存在 meta.bookPromotionCredits）。 */
  bookPromotionCredits?: boolean;
  status?: AccountStatus;
  note?: string | null;
  // 固定支出（migrations/0039）：一個廠商計費帳戶就是一筆固定支出。
  schedule?: AccountSchedule | null;
  /** YYYY-MM-DD，任一次已知的扣款日；fixed 必填。 */
  anchorDate?: string | null;
  intervalMonths?: number;
  /** 預估每期金額（十進位字串，存 numeric）。 */
  expectedAmount?: string | null;
  currency?: string | null;
  billingUrl?: string | null;
};

function parseSchedule(v: unknown): AccountSchedule | null {
  if (v === null || v === undefined || v === "" || v === "none") return null;
  return oneOf(v, ACCOUNT_SCHEDULES, "扣款週期");
}

function parseDate(v: unknown): string | null {
  const t = text(v, "扣款日", 10);
  if (t === null) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t) || Number.isNaN(Date.parse(`${t}T00:00:00Z`))) {
    throw new VendorBillingInputError("扣款日必須是 YYYY-MM-DD");
  }
  return t;
}

function parseInterval(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 36) throw new VendorBillingInputError("每隔幾個月必須是 1～36 的整數");
  return n;
}

function parseAmount(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  // 只接受數字或字串；其他型別（物件、布林…）原本也會變成 NaN 而被擋下
  if (typeof v !== "number" && typeof v !== "string") throw new VendorBillingInputError("預估金額必須是 0 以上的數字");
  const n = typeof v === "number" ? v : Number(v.replaceAll(",", "").trim());
  if (!Number.isFinite(n) || n < 0 || n >= 1e16) throw new VendorBillingInputError("預估金額必須是 0 以上的數字");
  return (Math.round(n * 100) / 100).toString();
}

function parseCurrency(v: unknown): string | null {
  const t = text(v, "幣別", 3);
  if (t === null) return null;
  const c = t.toUpperCase();
  if (!/^[A-Z]{3}$/.test(c)) throw new VendorBillingInputError("幣別必須是 3 個英文字母（例如 TWD）");
  return c;
}

function parseUrl(v: unknown): string | null {
  const t = text(v, "帳單頁網址", 500);
  if (t === null) return null;
  try {
    const u = new URL(t);
    if (u.protocol === "https:" || u.protocol === "http:") return t;
  } catch {
    // 落到下面的錯誤
  }
  throw new VendorBillingInputError("帳單頁網址必須是 http:// 或 https:// 開頭");
}

function parseIdList(v: unknown): number[] {
  if (!Array.isArray(v)) throw new VendorBillingInputError("matchPartyIds 必須是陣列");
  const ids = v.map((x) => id(x, "比對廠商")).filter((x): x is number => x !== null);
  return [...new Set(ids)].slice(0, 20);
}

const BILLING_ACCOUNT_FIELDS: FieldParsers = {
  provider: (v) => oneOf(v, VENDOR_PROVIDERS, "平台"),
  externalId: (v) => text(v, "平台上的帳號 ID", 200),
  displayName: requiredText("名稱", 200, "請填寫計費帳號名稱"),
  partyId: (v) => id(v, "交易對象"),
  matchPartyIds: parseIdList,
  paymentMethodId: (v) => id(v, "付款方式"),
  ownerUserId: (v) => text(v, "負責人", 100),
  ledgerMode: (v) => oneOf(v, LEDGER_MODES, "入帳模式"),
  bookPromotionCredits: parseBool("bookPromotionCredits"),
  status: (v) => oneOf(v, ACCOUNT_STATUSES, "狀態"),
  note: (v) => text(v, "備註", 2000),
  schedule: parseSchedule,
  anchorDate: parseDate,
  intervalMonths: parseInterval,
  expectedAmount: parseAmount,
  currency: parseCurrency,
  billingUrl: parseUrl,
};

export function normalizeBillingAccountInput(raw: Record<string, unknown>): BillingAccountPatch {
  const out = { id: id(raw.id, "計費帳號"), ...applyFields(raw, BILLING_ACCOUNT_FIELDS) } as BillingAccountPatch;
  if (out.id === null && (!out.provider || !out.displayName)) {
    throw new VendorBillingInputError("新增計費帳號要填平台與名稱");
  }
  return out;
}

/** 同步來的帳號：平台、ID、名稱、狀態由同步決定，人只能改這些。 */
export const SYNCED_ACCOUNT_EDITABLE = new Set([
  "partyId",
  "matchPartyIds",
  "paymentMethodId",
  "ownerUserId",
  "ledgerMode",
  "bookPromotionCredits",
  "note",
  // 固定支出的排程是我們自己的設定，跟平台同步無關
  "schedule",
  "anchorDate",
  "intervalMonths",
  "expectedAmount",
  "currency",
  "billingUrl",
]);

/** 目前存著的排程欄位（新增時全是 null）。 */
export type ScheduleColumns = {
  schedule: string | null;
  anchorDate: string | null;
  expectedAmount: string | null;
  currency: string | null;
};

/**
 * 排程欄位之間的規則（套在 normalize 過的 patch 上，current = 目前存著的值；新增時傳 null）：
 *   - 存檔後是 fixed 卻沒有扣款日 → 擋（DB 的 chk_vendor_billing_account_anchor 也會擋，這裡給看得懂的錯誤）
 *   - 這次把週期改成 usage / 不提醒 → 扣款日清掉，免得畫面上留著沒作用的值
 *   - 這次填了預估金額、卻沒有任何幣別 → TWD；這次清掉預估金額、也沒另外指定幣別 → 幣別一起清掉
 */
export function applyScheduleRules(patch: BillingAccountPatch, current: ScheduleColumns | null): BillingAccountPatch {
  const out = { ...patch };
  const schedule = out.schedule === undefined ? (current?.schedule ?? null) : out.schedule;
  if (out.schedule !== undefined && schedule !== "fixed") out.anchorDate = null;
  const anchorDate = out.anchorDate === undefined ? (current?.anchorDate ?? null) : out.anchorDate;
  if (schedule === "fixed" && !anchorDate) throw new VendorBillingInputError("固定日期扣款要填扣款日");
  if (out.expectedAmount !== undefined) {
    const currency = out.currency === undefined ? (current?.currency ?? null) : out.currency;
    if (out.expectedAmount === null && out.currency === undefined) out.currency = null;
    else if (out.expectedAmount !== null && !currency) out.currency = "TWD";
  }
  return out;
}

/** 把「同步來的不能改」的欄位挑出來（回傳不允許的欄位名）。 */
export function forbiddenSyncedFields(patch: Record<string, unknown>, editable: ReadonlySet<string>): string[] {
  return Object.keys(patch).filter((k) => k !== "id" && patch[k] !== undefined && !editable.has(k));
}

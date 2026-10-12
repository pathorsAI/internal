import type { MatchStatus } from "./match";

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

export const INVOICE_ACTIONS = ["confirm", "link", "unlink", "ignore", "create"] as const;
export type InvoiceAction = (typeof INVOICE_ACTIONS)[number];

export type { MatchStatus };

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

const has = (o: Record<string, unknown>, k: string) => Object.prototype.hasOwnProperty.call(o, k);

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

/**
 * 只存卡別、末四碼、到期、持卡人 —— 末四碼欄位收到更長的數字（有人貼了完整卡號）直接拒絕，
 * 不截斷、不存。沒傳的欄位不動（PATCH 語意）；新增時 kind 與 label 必填。
 */
export function normalizePaymentMethodInput(raw: Record<string, unknown>): PaymentMethodPatch {
  const out: PaymentMethodPatch = { id: id(raw.id, "付款方式") };
  if (has(raw, "kind")) out.kind = oneOf(raw.kind, PAYMENT_METHOD_KINDS, "種類");
  if (has(raw, "label")) {
    const l = text(raw.label, "名稱", 120);
    if (!l) throw new VendorBillingInputError("請填寫付款方式名稱");
    out.label = l;
  }
  if (has(raw, "brand")) out.brand = text(raw.brand, "卡別", 60);
  if (has(raw, "last4")) {
    const v = raw.last4 === null || raw.last4 === undefined ? "" : String(raw.last4).replace(/[\s•*-]/g, "");
    if (v === "") out.last4 = null;
    else if (/^\d{4}$/.test(v)) out.last4 = v;
    else if (/^\d{5,}$/.test(v)) throw new VendorBillingInputError("只能存卡號末四碼，請勿輸入完整卡號");
    else throw new VendorBillingInputError("末四碼必須是 4 位數字");
  }
  if (has(raw, "expiryMonth")) {
    const m = raw.expiryMonth === null || raw.expiryMonth === "" || raw.expiryMonth === undefined ? null : Number(raw.expiryMonth);
    if (m !== null && (!Number.isInteger(m) || m < 1 || m > 12)) throw new VendorBillingInputError("到期月份必須是 1～12");
    out.expiryMonth = m;
  }
  if (has(raw, "expiryYear")) {
    let y = raw.expiryYear === null || raw.expiryYear === "" || raw.expiryYear === undefined ? null : Number(raw.expiryYear);
    if (y !== null && y >= 0 && y < 100) y += 2000;
    if (y !== null && (!Number.isInteger(y) || y < 2000 || y > 2100)) throw new VendorBillingInputError("到期年份不對");
    out.expiryYear = y;
  }
  if (has(raw, "holderName")) out.holderName = text(raw.holderName, "持卡人", 120);
  if (has(raw, "settlesFromAccountId")) out.settlesFromAccountId = id(raw.settlesFromAccountId, "扣款帳戶");
  if (has(raw, "isActive")) {
    if (typeof raw.isActive !== "boolean") throw new VendorBillingInputError("isActive 必須是 true / false");
    out.isActive = raw.isActive;
  }
  if (has(raw, "note")) out.note = text(raw.note, "備註", 2000);
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
  status?: AccountStatus;
  note?: string | null;
};

export function normalizeBillingAccountInput(raw: Record<string, unknown>): BillingAccountPatch {
  const out: BillingAccountPatch = { id: id(raw.id, "計費帳號") };
  if (has(raw, "provider")) out.provider = oneOf(raw.provider, VENDOR_PROVIDERS, "平台");
  if (has(raw, "externalId")) out.externalId = text(raw.externalId, "平台上的帳號 ID", 200);
  if (has(raw, "displayName")) {
    const d = text(raw.displayName, "名稱", 200);
    if (!d) throw new VendorBillingInputError("請填寫計費帳號名稱");
    out.displayName = d;
  }
  if (has(raw, "partyId")) out.partyId = id(raw.partyId, "交易對象");
  if (has(raw, "matchPartyIds")) {
    if (!Array.isArray(raw.matchPartyIds)) throw new VendorBillingInputError("matchPartyIds 必須是陣列");
    const ids = raw.matchPartyIds.map((x) => id(x, "比對廠商")).filter((x): x is number => x !== null);
    out.matchPartyIds = [...new Set(ids)].slice(0, 20);
  }
  if (has(raw, "paymentMethodId")) out.paymentMethodId = id(raw.paymentMethodId, "付款方式");
  if (has(raw, "ownerUserId")) out.ownerUserId = text(raw.ownerUserId, "負責人", 100);
  if (has(raw, "ledgerMode")) out.ledgerMode = oneOf(raw.ledgerMode, LEDGER_MODES, "入帳模式");
  if (has(raw, "status")) out.status = oneOf(raw.status, ACCOUNT_STATUSES, "狀態");
  if (has(raw, "note")) out.note = text(raw.note, "備註", 2000);
  if (out.id === null && (!out.provider || !out.displayName)) {
    throw new VendorBillingInputError("新增計費帳號要填平台與名稱");
  }
  return out;
}

/** 同步來的帳號：平台、ID、名稱、狀態由同步決定，人只能改這些。 */
export const SYNCED_ACCOUNT_EDITABLE = new Set(["partyId", "matchPartyIds", "paymentMethodId", "ownerUserId", "ledgerMode", "note"]);

/** 把「同步來的不能改」的欄位挑出來（回傳不允許的欄位名）。 */
export function forbiddenSyncedFields(patch: Record<string, unknown>, editable: ReadonlySet<string>): string[] {
  return Object.keys(patch).filter((k) => k !== "id" && patch[k] !== undefined && !editable.has(k));
}

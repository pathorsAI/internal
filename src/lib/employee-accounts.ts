// 員工收款帳戶的純函式（不碰 DB、不碰加密），server 與 client 共用：
// - 台灣常見銀行代碼表（表單的銀行下拉用；不在表上的代碼仍可自由輸入）
// - 帳號正規化與驗證（網頁 action、MCP tool、搬移腳本共用同一套規則）
// - 舊 salary_account 自由文字的解析
// - 遮罩後的顯示字串
//
// 這裡的型別只描述「遮罩過」的帳戶；完整帳號從來不會出現在這個檔案處理的物件裡。

export const EMPLOYEE_ACCOUNT_KINDS = ["bank", "wise", "other"] as const;
export type EmployeeAccountKind = (typeof EMPLOYEE_ACCOUNT_KINDS)[number];

/** 列表 / MCP / client 看得到的帳戶形狀：沒有完整帳號，只有末 5 碼。 */
export type MaskedEmployeeAccount = {
  id: number;
  employeeId: number;
  kind: string;
  bankCode: string | null;
  branchCode: string | null;
  bankName: string | null;
  accountHolder: string | null;
  accountLast5: string;
  currency: string;
  label: string | null;
  defaultForSalary: boolean;
  defaultForReimbursement: boolean;
  isActive: boolean;
  note: string | null;
};

/**
 * 台灣常見的金融機構代碼（財金資訊公司的 3 碼總機構代號）。只收常見的幾十家，
 * 給下拉選單用；不在表上的代碼一樣可以手動輸入。
 * 815 日盛已於 2023 年併入台北富邦、809 凱基前身為萬泰，舊帳戶仍可能出現故保留。
 */
export const TW_BANKS: ReadonlyArray<{ code: string; name: string }> = [
  { code: "004", name: "臺灣銀行" },
  { code: "005", name: "土地銀行" },
  { code: "006", name: "合作金庫" },
  { code: "007", name: "第一銀行" },
  { code: "008", name: "華南銀行" },
  { code: "009", name: "彰化銀行" },
  { code: "011", name: "上海商銀" },
  { code: "012", name: "台北富邦" },
  { code: "013", name: "國泰世華" },
  { code: "016", name: "高雄銀行" },
  { code: "017", name: "兆豐銀行" },
  { code: "048", name: "王道銀行" },
  { code: "050", name: "臺灣企銀" },
  { code: "052", name: "渣打銀行" },
  { code: "053", name: "台中銀行" },
  { code: "054", name: "京城銀行" },
  { code: "081", name: "滙豐銀行" },
  { code: "103", name: "新光銀行" },
  { code: "108", name: "陽信銀行" },
  { code: "118", name: "板信銀行" },
  { code: "147", name: "三信銀行" },
  { code: "700", name: "中華郵政" },
  { code: "803", name: "聯邦銀行" },
  { code: "805", name: "遠東商銀" },
  { code: "806", name: "元大銀行" },
  { code: "807", name: "永豐銀行" },
  { code: "808", name: "玉山銀行" },
  { code: "809", name: "凱基銀行" },
  { code: "810", name: "星展銀行" },
  { code: "812", name: "台新銀行" },
  { code: "815", name: "日盛銀行" },
  { code: "816", name: "安泰銀行" },
  { code: "822", name: "中國信託" },
  { code: "823", name: "將來銀行" },
  { code: "824", name: "連線銀行（LINE Bank）" },
  { code: "826", name: "樂天銀行" },
];

const BANK_BY_CODE = new Map(TW_BANKS.map((b) => [b.code, b.name]));

export function bankNameForCode(code: string | null | undefined): string | null {
  return code ? (BANK_BY_CODE.get(code) ?? null) : null;
}

/** 去掉空白與連字號（使用者常照存摺格式輸入 807-0180-1234…）。 */
export function normalizeAccountNumber(raw: string): string {
  return raw.replace(/[\s\-‐-―]/g, "");
}

/** 末 5 碼（正規化之後）。 */
export function accountLast5(normalized: string): string {
  return normalized.slice(-5);
}

export type EmployeeAccountErrorCode =
  | "kindInvalid"
  | "numberRequired"
  | "numberDigits"
  | "numberLength"
  | "bankCodeRequired"
  | "bankCodeFormat"
  | "branchCodeFormat"
  | "currencyFormat"
  | "notFound"
  | "inactive"
  | "wrongEmployee";

// 英文訊息給 MCP 直接回傳；網頁端用 code 查 i18n（errors.employeeAccount.*）。
const ERROR_MESSAGES: Record<EmployeeAccountErrorCode, string> = {
  kindInvalid: `"kind" must be one of: ${EMPLOYEE_ACCOUNT_KINDS.join(", ")}.`,
  numberRequired: "Account number is required.",
  numberDigits: "A bank account number must be 6–20 digits (spaces and dashes are ignored).",
  numberLength: "Account number must be 1–64 characters.",
  bankCodeRequired: "A bank account needs a 3-digit bank code (e.g. 807).",
  bankCodeFormat: "Bank code must be exactly 3 digits.",
  branchCodeFormat: "Branch code must be exactly 4 digits.",
  currencyFormat: "Currency must be a 3-letter code (e.g. TWD, USD).",
  notFound: "Employee bank account not found in your organization.",
  inactive: "That employee bank account is deactivated.",
  wrongEmployee: "That bank account belongs to a different employee.",
};

export class EmployeeAccountError extends Error {
  constructor(public readonly code: EmployeeAccountErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = "EmployeeAccountError";
  }
}

export function isAccountKind(v: string): v is EmployeeAccountKind {
  return (EMPLOYEE_ACCOUNT_KINDS as readonly string[]).includes(v);
}

/** 檢查帳號本體；回傳正規化後的值。 */
export function checkAccountNumber(kind: EmployeeAccountKind, raw: string | null | undefined): string {
  const n = normalizeAccountNumber(raw ?? "");
  if (!n) throw new EmployeeAccountError("numberRequired");
  if (kind === "bank") {
    if (!/^\d{6,20}$/.test(n)) throw new EmployeeAccountError("numberDigits");
  } else if (n.length > 64) {
    throw new EmployeeAccountError("numberLength");
  }
  return n;
}

/** 檢查銀行 / 分行代碼與幣別；回傳正規化後的值（空字串 → null、幣別轉大寫）。 */
export function checkAccountCodes(input: {
  kind: EmployeeAccountKind;
  bankCode?: string | null;
  branchCode?: string | null;
  currency?: string | null;
}): { bankCode: string | null; branchCode: string | null; currency: string } {
  const bankCode = input.bankCode?.trim() || null;
  const branchCode = input.branchCode?.trim() || null;
  const currency = (input.currency?.trim() || "TWD").toUpperCase();
  if (input.kind === "bank" && !bankCode) throw new EmployeeAccountError("bankCodeRequired");
  if (bankCode && !/^\d{3}$/.test(bankCode)) throw new EmployeeAccountError("bankCodeFormat");
  if (branchCode && !/^\d{4}$/.test(branchCode)) throw new EmployeeAccountError("branchCodeFormat");
  if (!/^[A-Z]{3}$/.test(currency)) throw new EmployeeAccountError("currencyFormat");
  return { bankCode, branchCode, currency };
}

/** 舊 salary_account 自由文字轉成帳戶時寫進 note 的固定字樣（搬移腳本也用）。 */
export const LEGACY_ACCOUNT_NOTE = "由舊的薪資帳戶欄位轉入";

export type ParsedLegacyAccount = {
  kind: EmployeeAccountKind;
  bankCode: string | null;
  branchCode: string | null;
  bankName: string | null;
  accountNumber: string;
};

/**
 * 舊 salary_account（自由文字）→ 帳戶欄位。
 * - 開頭是 3 碼數字 → 當成銀行代碼；後面若是「4 碼 + 分隔 + 數字」就拆出分行，
 *   其餘數字當帳號。帳號湊不到 6 碼就放棄解析，改走 other。
 * - 其他情況 → kind = other，整串（去掉空白 / 連字號）當帳號，交給人事後修正。
 */
export function parseLegacySalaryAccount(raw: string): ParsedLegacyAccount | null {
  const s = raw.trim();
  if (!s) return null;
  const m = /^(\d{3})([\s\S]*)$/.exec(s);
  if (m) {
    const bankCode = m[1];
    // 代碼後面可能夾著銀行名稱或括號（「807 永豐 0180-1234…」），先跳到第一個數字
    const rest = m[2].replace(/^\D+/, "");
    const branchMatch = /^(\d{4})[\s\-/]+(.+)$/.exec(rest);
    const branchCode = branchMatch ? branchMatch[1] : null;
    const digits = (branchMatch ? branchMatch[2] : rest).replace(/\D/g, "");
    if (/^\d{6,20}$/.test(digits)) {
      return { kind: "bank", bankCode, branchCode, bankName: bankNameForCode(bankCode), accountNumber: digits };
    }
  }
  const whole = normalizeAccountNumber(s).slice(0, 64);
  return { kind: "other", bankCode: null, branchCode: null, bankName: null, accountNumber: whole };
}

/** 帳戶的簡短稱呼：銀行名 → 標籤 → 銀行代碼，都沒有就回 null 讓呼叫端決定。 */
export function accountDisplayName(a: {
  bankName: string | null;
  label: string | null;
  bankCode: string | null;
}): string | null {
  return a.bankName ?? a.label ?? a.bankCode ?? null;
}

/** 「永豐銀行 ••••90123」— 發薪紀錄、撥款紀錄上的一行摘要。 */
export function formatAccountShort(a: {
  bankName: string | null;
  label: string | null;
  bankCode: string | null;
  accountLast5: string;
}): string {
  const name = accountDisplayName(a);
  return name ? `${name} ••••${a.accountLast5}` : `••••${a.accountLast5}`;
}

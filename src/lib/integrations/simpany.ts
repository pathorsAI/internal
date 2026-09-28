import {
  clearTokenCache,
  loadTokenCache,
  markNeedsReauth,
  recordSyncFailure,
  recordSyncSuccess,
  requireEnabledIntegration,
  saveTokenCache,
  updateConfig,
} from "./store";
import type {
  IntegrationConfig,
  IntegrationCredentials,
  IntegrationProvider,
  TokenCache,
} from "./types";

/**
 * Simpany（simpany.co）電子發票加值中心。
 *
 * ⚠️ Simpany 沒有公開 API。這裡用的是它會員網頁背後的私有 REST API（讀前端 bundle
 * 與實際唯讀呼叫確認過形狀），隨時可能改版。因此：
 * - 所有回應都當成 unknown 防禦式解析，認不得就把 Simpany 的原始錯誤訊息（截短）丟回去，
 *   不猜。
 * - 帳密（account / password）與 JWT 只存在 server 記憶體，不寫 log、不進錯誤訊息、
 *   不進任何回傳值。
 *
 * 三個 base：
 * - api.simpany.co/v1        登入、/me（使用者與公司清單）
 * - member2.simpany.co/api/v1/c/{companyId}/   電子發票（receipts）
 * - api.simpany.co/v1/{companyId}/salary-declaration/   薪資申報。讀取走 assertSalaryReadOnly
 *   （GET + 路徑白名單）；寫入（申報明細、發薪日、負責人、結算、寄薪資單）另走 assertSalaryWrite
 *   （method + 路徑逐條白名單），只由 src/lib/simpany-payroll.ts 呼叫。回應含身分證字號 / 地址 /
 *   國籍，解析時一律丟掉；請求 / 回應 body 一律不寫 log。
 */

const AUTH_BASE = "https://api.simpany.co/v1";
const EINVOICE_BASE = "https://member2.simpany.co/api/v1/c";
const SALARY_BASE = "https://api.simpany.co/v1";

/**
 * 薪資申報只允許這些路徑（相對於 {companyId}/salary-declaration/），而且只能 GET。
 * 結算、複製、建立、寄薪資單等端點一律不在清單內 —— 要加端點只能加唯讀的 GET。
 */
const SALARY_READ_ONLY_PATHS: readonly RegExp[] = [
  /^form\/monthly-forms\/\d{4}$/,
  /^form$/,
];
const SALARY_QUERY_KEYS: ReadonlySet<string> = new Set(["year", "month"]);

/** 薪資申報的唯讀護欄：非 GET、路徑不在白名單、或帶了白名單外的 query key，一律不發請求直接丟錯。 */
export function assertSalaryReadOnly(
  method: string,
  path: string,
  query?: Record<string, unknown>,
): void {
  if (method.toUpperCase() !== "GET") {
    throw new SimpanyError("config", `Simpany 薪資申報整合是唯讀的，拒絕送出 ${method} ${path}`);
  }
  if (!SALARY_READ_ONLY_PATHS.some((re) => re.test(path))) {
    throw new SimpanyError("config", `Simpany 薪資申報不允許呼叫 ${path}（不在唯讀端點白名單內）`);
  }
  for (const k of Object.keys(query ?? {})) {
    if (!SALARY_QUERY_KEYS.has(k)) {
      throw new SimpanyError("config", `Simpany 薪資申報不允許 query 參數 ${k}`);
    }
  }
}

/**
 * 薪資申報的**寫入**端點白名單（相對於 {companyId}/salary-declaration/），method 與路徑逐條對應。
 * 只有這幾條；員工的建立 / 修改 / 刪除（需要身分證字號）刻意不在清單內。
 * 讀取用的 GET（form、monthly-forms）仍走 assertSalaryReadOnly。
 */
const SALARY_WRITE_ENDPOINTS: readonly { method: string; path: RegExp }[] = [
  // 讀單一申報明細 / 表單設定（加項 / 減項選項、投保級距）—— 準備寫入時才用到
  { method: "GET", path: /^form\/\d+\/salary-declaration\/\d+$/ },
  { method: "GET", path: /^form\/\d+\/setting$/ },
  // 試算（Simpany UI 的即時預覽；不存檔，但仍是 POST）
  { method: "POST", path: /^form\/\d+\/salary-declaration\/\d+\/calculate$/ },
  // 存檔申報明細
  { method: "PUT", path: /^form\/\d+\/salary-declaration\/\d+$/ },
  // 從前一個月的表單複製員工與申報明細
  { method: "POST", path: /^form\/\d+\/copy$/ },
  // 發薪日
  { method: "PATCH", path: /^form\/\d+\/payday$/ },
  // 負責人旗標
  { method: "PUT", path: /^form\/\d+\/salary-declaration\/\d+\/company-owner$/ },
  // 結算（送給記帳士）
  { method: "POST", path: /^form\/\d+\/settle$/ },
  // 寄薪資單給員工
  { method: "POST", path: /^form\/\d+\/payslip\/send$/ },
];

/** 薪資申報的寫入護欄：method + 路徑不在白名單、或帶了任何 query，一律不發請求直接丟錯。 */
export function assertSalaryWrite(
  method: string,
  path: string,
  query?: Record<string, unknown>,
): void {
  const m = method.toUpperCase();
  if (!SALARY_WRITE_ENDPOINTS.some((e) => e.method === m && e.path.test(path))) {
    throw new SimpanyError("config", `Simpany 薪資申報不允許 ${m} ${path}（不在寫入端點白名單內）`);
  }
  if (Object.keys(query ?? {}).length > 0) {
    throw new SimpanyError("config", `Simpany 薪資申報寫入端點不接受 query 參數（${m} ${path}）`);
  }
}

/** 取不到 JWT exp 時的保守效期。 */
const FALLBACK_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

const BASE_HEADERS: Record<string, string> = {
  Accept: "application/json",
  "X-Requested-With": "XMLHttpRequest",
};

// ---------------------------------------------------------------------------
// Types (only the fields we rely on; everything else passes through as unknown)
// ---------------------------------------------------------------------------

export type SimpanyCompany = { id: number; name: string; regId: string | null };

export type SimpanyReceiptType = "B2B" | "B2C";
export type SimpanyTaxType = "TAXABLE" | "ZERO_TAX_RATE" | "EXEMPTION";

export type SimpanyReceiptListItem = {
  id: string;
  invoiceNumber: string | null;
  type: string;
  status: string;
  buyerVat: string | null;
  buyerName: string | null;
  buyerAddress: string | null;
  totalAmount: number;
  issuedAt: string | null;
  invalidatedAt: string | null;
  invalidReason: string | null;
  /** Simpany 說這張現在能不能作廢；回應沒有這個欄位時為 null。 */
  canInvalidate: boolean | null;
  allowances: unknown[];
};

export type SimpanyReceiptItem = {
  name: string;
  quantity: number;
  price: number;
  amount: number;
};

export type SimpanyReceiptDetail = SimpanyReceiptListItem & {
  uploadStatus: string | null;
  printStatus: string | null;
  randomNumber: string | null;
  buyerEmails: string[];
  taxType: string | null;
  customsClearanceType: string | null;
  zeroTaxRateReason: { code: string; name: string } | null;
  taxRate: number | null;
  isTaxIncluded: boolean | null;
  taxAmount: number;
  untaxedAmount: number;
  remark: string | null;
  carrierType: string | null;
  items: SimpanyReceiptItem[];
};

export type SimpanyListParams = {
  status: "ALL" | "INVALID";
  startDate: string;
  endDate: string;
  query?: string;
  page?: number;
  limit?: number;
};

export type SimpanyPage<T> = {
  data: T[];
  currentPage: number;
  lastPage: number;
  total: number;
};

export type SimpanyZeroTaxReason = { code: string; name: string };

/** POST receipts/{b2b|b2c} 的 body，照 Simpany 會員網頁組的樣子。 */
export type SimpanyCreateBody = {
  customId: null;
  customer: { vat?: string; name: string; address: string; emails: string[] };
  taxType: SimpanyTaxType;
  customsClearanceType: "NOT_VIA_CUSTOMS" | "VIA_CUSTOMS" | null;
  remark: string;
  isTaxIncluded: boolean;
  shouldAdjustTaxAmount: false;
  carrier: { type: string | null; number: string | null };
  npoBan: null;
  items: { name: string; quantity: number; price: number; subTotal: number }[];
  autocompleteSelectedIsVender: false;
  zeroTaxRateReasonCode: string | null;
};

/** 薪資申報：monthly-forms 的一格。id null = 那個月沒建表單。 */
export type SimpanySalaryMonthlyForm = {
  id: number | null;
  year: number;
  month: number;
  employees: { id: number; name: string }[];
};

/** 薪資申報明細的一個項目（去識別化：只有名稱、類型、金額）。 */
export type SimpanySalaryDeclarationItem = { name: string; type: string; amount: number };

/**
 * 表單上的一位員工。**刻意不含** personalId / address / nationality —— 解析時就丟掉。
 * declaration null = 表單上有這個人但沒有申報明細。
 */
export type SimpanySalaryFormEmployee = {
  id: number;
  name: string;
  employeeType: string | null;
  payslipSentAt: string | null;
  hasMissingEmployeeData: boolean | null;
  hasMissingSalaryData: boolean | null;
  declaration: {
    id: number | null;
    isCompanyOwner: boolean;
    payday: string | null;
    yearMonth: string | null;
    payStartDate: string | null;
    payEndDate: string | null;
    laborInsuranceStartDate: string | null;
    laborInsuranceEndDate: string | null;
    items: SimpanySalaryDeclarationItem[];
  } | null;
};

/** 月份必須依序結算：Simpany 列出前面還沒結算的月份（例如 "2026-06"）。 */
export type SimpanyMonthSequenceRestriction = { reason: string; missingMonths: string[] };

export type SimpanySalaryForm = {
  id: number | null;
  year: number;
  month: number;
  payday: string | null;
  isSettled: boolean;
  canSettle: boolean | null;
  /** null = 沒有順序限制。 */
  monthSequenceRestriction: SimpanyMonthSequenceRestriction | null;
  employees: SimpanySalaryFormEmployee[];
};

/** 申報明細的一個項目，含寫回 Simpany 需要的 itemId / note。 */
export type SimpanySalaryPayloadItem = {
  itemId: number;
  amount: number;
  note: string | null;
  name: string;
  type: string;
};

export type SimpanySalarySubtotal = {
  allowance: number | null;
  deduction: number | null;
  personalBurden: number | null;
  withholdingTax: number | null;
};

/**
 * GET form/{formId}/salary-declaration/{declId} 的白名單欄位（寫入時當模板用）。
 * 不含任何身分證字號 / 地址 / 國籍。
 */
export type SimpanySalaryDeclarationDetail = {
  id: number;
  isCompanyOwner: boolean;
  payday: string | null;
  yearMonth: string | null;
  payStartDate: string | null;
  payEndDate: string | null;
  laborInsuranceStartDate: string | null;
  laborInsuranceEndDate: string | null;
  laborPensionStartDate: string | null;
  laborPensionEndDate: string | null;
  shouldAskIfTerminated: boolean | null;
  hasPensionPreparationFundByCompany: boolean;
  pensionPreparationFundByCompanyRate: string;
  pensionPreparationFundBySelfRate: string;
  withholdingTaxDependents: number;
  healthInsuranceDependents: number;
  hasOrdinaryAccidentInsurance: boolean;
  hasEmploymentInsurance: boolean;
  hasOccupationalAccidentInsurance: boolean;
  items: SimpanySalaryPayloadItem[];
  subtotal: SimpanySalarySubtotal | null;
};

/** POST …/calculate 與 PUT …/salary-declaration/{declId} 的 body（Simpany 會員網頁送的形狀）。 */
export type SimpanySalaryDeclarationPayload = {
  payStartDate: string;
  payEndDate: string;
  hasEmploymentInsurance: boolean;
  hasOrdinaryAccidentInsurance: boolean;
  hasPensionPreparationFundByCompany: boolean;
  healthInsuranceDependents: number;
  pensionPreparationFundByCompanyRate: string;
  pensionPreparationFundBySelfRate: string;
  withholdingTaxDependents: number;
  /** 使用者可編輯的項目：ALLOWANCE、INSURANCE_RANGE、可選的 DEDUCTION（應稅其他減項、公司代墊款）。 */
  salaryDeclarationItems: SimpanySalaryPayloadItem[];
  /** Simpany 算出來的項目（保費、扣繳、小計…），來自上一次試算或 GET。 */
  calculatedSalaryDeclarationItems: SimpanySalaryPayloadItem[];
  laborInsuranceStartDate: string | null;
  laborInsuranceEndDate: string | null;
  laborPensionStartDate: string | null;
  laborPensionEndDate: string | null;
  hasOccupationalAccidentInsurance: boolean;
};

export type SimpanySalaryCalculation = {
  calculatedItems: SimpanySalaryPayloadItem[];
  subtotal: SimpanySalarySubtotal | null;
  /** 形狀未經驗證，只留基本型別的值（去個資）。 */
  suggestedInsuranceRange: unknown;
};

export type SimpanySalaryOption = { id: number; name: string };

export type SimpanySalarySetting = {
  minimumSalary: number | null;
  allowanceOptions: SimpanySalaryOption[];
  deductionOptions: SimpanySalaryOption[];
};

export type SimpanyPayslipSendBody =
  | { mode: "COMPANY_SALARY_DECLARATION_FORM"; mailContent: string }
  | { mode: "SALARY_DECLARATIONS"; salaryDeclarationIds: number[]; mailContent: string };

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type SimpanyErrorKind = "auth" | "validation" | "business" | "http" | "network" | "config";

/** 給人看的錯誤。message 永遠不含帳密或 token。 */
export class SimpanyError extends Error {
  constructor(
    readonly kind: SimpanyErrorKind,
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = "SimpanyError";
  }
}

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | null {
  if (typeof v === "string") return v;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

function num(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return 0;
}

function numOrNull(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function bool(v: unknown): boolean | null {
  return typeof v === "boolean" ? v : null;
}

/** 回應 body 截短後的字串，錯誤訊息用。 */
function snippet(body: unknown): string {
  let s: string;
  try {
    s = typeof body === "string" ? body : JSON.stringify(body);
  } catch {
    s = String(body);
  }
  s = s.replaceAll(/\s+/g, " ").trim();
  return s.length > 400 ? `${s.slice(0, 399)}…` : s;
}

/** 驗證錯誤：{ errors: { field: [msg] } } → 「field: msg、msg；field: msg」；沒有內容回 null。 */
function validationErrorsMessage(errors: Record<string, unknown>): string | null {
  const parts: string[] = [];
  for (const [field, msgs] of Object.entries(errors)) {
    const list = Array.isArray(msgs) ? msgs.map((m) => str(m) ?? snippet(m)) : [snippet(msgs)];
    parts.push(`${field}: ${list.join("、")}`);
  }
  return parts.length ? parts.join("；") : null;
}

/** 業務錯誤：{ status: "error", error: { title, details } } / { error: { code } }；沒有內容回 null。 */
function businessErrorMessage(e: Record<string, unknown>): string | null {
  const title = str(e.title) ?? str(e.message);
  const details = str(e.details) ?? (e.details === undefined ? null : snippet(e.details));
  const code = str(e.code);
  const text = [title, details].filter(Boolean).join("：");
  if (text) return code ? `${text}（${code}）` : text;
  if (code) return `錯誤代碼 ${code}`;
  return null;
}

/** 從 Simpany 的各種錯誤形狀裡抽出人看得懂的訊息。 */
export function simpanyErrorMessage(body: unknown): string | null {
  if (!isObj(body)) return typeof body === "string" && body.trim() ? snippet(body) : null;
  if (isObj(body.errors)) {
    const validation = validationErrorsMessage(body.errors);
    if (validation) return validation;
  }
  if (isObj(body.error)) {
    const business = businessErrorMessage(body.error);
    if (business) return business;
  }
  const message = str(body.message);
  if (message) return message;
  return snippet(body);
}

/** 薪資申報用：只取結構化的錯誤訊息（validation / business / message），絕不回 body 片段。 */
function salaryErrorMessage(body: unknown): string | null {
  if (!isObj(body)) return null;
  if (isObj(body.errors)) {
    const validation = validationErrorsMessage(body.errors);
    if (validation) return validation.slice(0, 400);
  }
  if (isObj(body.error)) {
    const business = businessErrorMessage(body.error);
    if (business) return business.slice(0, 400);
  }
  return str(body.message)?.slice(0, 400) ?? null;
}

/** JWT 的 exp（秒）→ Date；解不出來回 null。只讀 payload，不驗簽（那是 Simpany 的事）。 */
export function jwtExpiry(token: string): Date | null {
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    let b64 = parts[1].replaceAll("-", "+").replaceAll("_", "/");
    while (b64.length % 4) b64 += "=";
    const payload: unknown = JSON.parse(atob(b64));
    if (isObj(payload) && typeof payload.exp === "number") {
      const d = new Date(payload.exp * 1000);
      return Number.isNaN(d.getTime()) ? null : d;
    }
  } catch {
    // fall through
  }
  return null;
}

function parseCompany(v: unknown): SimpanyCompany | null {
  if (!isObj(v)) return null;
  const id = numOrNull(v.id);
  if (id == null) return null;
  return { id, name: str(v.name) ?? String(id), regId: str(v.reg_id) ?? str(v.regId) };
}

export function parseListItem(v: unknown): SimpanyReceiptListItem | null {
  if (!isObj(v)) return null;
  const id = str(v.id);
  if (!id) return null;
  return {
    id,
    invoiceNumber: str(v.invoiceNumber),
    type: str(v.type) ?? "",
    status: str(v.status) ?? "",
    buyerVat: str(v.buyerVat),
    buyerName: str(v.buyerName),
    buyerAddress: str(v.buyerAddress),
    totalAmount: num(v.totalAmount),
    issuedAt: str(v.issuedAt),
    invalidatedAt: str(v.invalidatedAt),
    invalidReason: str(v.invalidReason),
    canInvalidate: bool(v.canInvalidate),
    allowances: Array.isArray(v.allowances) ? v.allowances : [],
  };
}

export function parseDetail(v: unknown): SimpanyReceiptDetail | null {
  const base = parseListItem(v);
  if (!base || !isObj(v)) return null;
  const reason = isObj(v.zeroTaxRateReason)
    ? {
        code: str(v.zeroTaxRateReason.code) ?? "",
        name: str(v.zeroTaxRateReason.name) ?? "",
      }
    : null;
  const items: SimpanyReceiptItem[] = Array.isArray(v.items)
    ? v.items.filter(isObj).map((it) => ({
        name: str(it.name) ?? "",
        quantity: num(it.quantity),
        price: num(it.price),
        amount: num(it.amount),
      }))
    : [];
  return {
    ...base,
    uploadStatus: str(v.uploadStatus),
    printStatus: str(v.printStatus),
    randomNumber: str(v.randomNumber),
    buyerEmails: Array.isArray(v.buyerEmails)
      ? v.buyerEmails.map((e) => str(e)).filter((e): e is string => Boolean(e))
      : [],
    taxType: str(v.taxType),
    customsClearanceType: str(v.customsClearanceType),
    zeroTaxRateReason: reason?.code ? reason : null,
    taxRate: numOrNull(v.taxRate),
    isTaxIncluded: bool(v.isTaxIncluded),
    taxAmount: num(v.taxAmount),
    untaxedAmount: num(v.untaxedAmount),
    remark: str(v.remark),
    carrierType: str(v.carrierType),
    items,
  };
}

/** YYYY-MM-DD（或 ISO 字串的日期部分）；其他格式回 null。 */
function dateStr(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  return m ? m[1] : null;
}

export function parseSalaryMonthlyForms(data: unknown, year: number): SimpanySalaryMonthlyForm[] {
  const list = Array.isArray(data) ? data : [];
  return list
    .filter(isObj)
    .map((f): SimpanySalaryMonthlyForm | null => {
      const month = numOrNull(f.month);
      if (month == null || month < 1 || month > 12) return null;
      const employees = Array.isArray(f.employees)
        ? f.employees
            .filter(isObj)
            .map((e) => ({ id: numOrNull(e.id), name: str(e.name)?.trim() ?? "" }))
            .filter((e): e is { id: number; name: string } => e.id != null && e.name !== "")
        : [];
      return { id: numOrNull(f.id), year: numOrNull(f.year) ?? year, month, employees };
    })
    .filter((f): f is SimpanySalaryMonthlyForm => f !== null);
}

function parseSalaryItems(v: unknown): SimpanySalaryDeclarationItem[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter(isObj)
    .map((it) => ({ name: str(it.name)?.trim() ?? "", type: str(it.type) ?? "", amount: num(it.amount) }))
    .filter((it) => it.name !== "");
}

/**
 * 解析 GET form?year&month。只挑白名單欄位組新物件 —— personalId / address / nationality
 * 永遠不會被讀進來。
 */
export function parseSalaryForm(data: unknown, year: number, month: number): SimpanySalaryForm | null {
  if (!isObj(data)) return null;
  const employees: SimpanySalaryFormEmployee[] = Array.isArray(data.employees)
    ? data.employees.filter(isObj).flatMap((e): SimpanySalaryFormEmployee[] => {
        const id = numOrNull(e.id);
        const name = str(e.name)?.trim() ?? "";
        if (id == null || !name) return [];
        const d = isObj(e.salaryDeclaration) ? e.salaryDeclaration : null;
        return [
          {
            id,
            name,
            employeeType: str(e.employeeType),
            payslipSentAt: str(e.payslipSentAt),
            hasMissingEmployeeData: bool(e.hasMissingEmployeeData),
            hasMissingSalaryData: bool(e.hasMissingSalaryData),
            declaration: d
              ? {
                  id: numOrNull(d.id),
                  isCompanyOwner: d.isCompanyOwner === true,
                  payday: dateStr(d.payday),
                  yearMonth: str(d.yearMonth),
                  payStartDate: dateStr(d.payStartDate),
                  payEndDate: dateStr(d.payEndDate),
                  laborInsuranceStartDate: dateStr(d.laborInsuranceStartDate),
                  laborInsuranceEndDate: dateStr(d.laborInsuranceEndDate),
                  items: parseSalaryItems(d.salaryDeclarationItems),
                }
              : null,
          },
        ];
      })
    : [];
  return {
    id: numOrNull(data.id),
    year,
    month,
    payday: dateStr(data.payday),
    isSettled: data.isSettled === true,
    canSettle: bool(data.canSettle),
    monthSequenceRestriction: parseMonthSequenceRestriction(data.monthSequenceRestriction),
    employees,
  };
}

/** missingMonths 的每一格可能是 "2026-06"、數字或 {year, month}；都轉成 "YYYY-MM"（認不得的丟掉）。 */
function missingMonthLabel(v: unknown): string | null {
  if (typeof v === "string") return v.trim() || null;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (isObj(v)) {
    const y = numOrNull(v.year);
    const m = numOrNull(v.month);
    if (y != null && m != null) return `${y}-${String(m).padStart(2, "0")}`;
    return str(v.yearMonth);
  }
  return null;
}

export function parseMonthSequenceRestriction(v: unknown): SimpanyMonthSequenceRestriction | null {
  if (!isObj(v)) return null;
  const missingMonths = Array.isArray(v.missingMonths)
    ? v.missingMonths.map(missingMonthLabel).filter((x): x is string => x !== null)
    : [];
  return { reason: str(v.reason) ?? "UNKNOWN", missingMonths };
}

function parsePayloadItems(v: unknown): SimpanySalaryPayloadItem[] {
  if (!Array.isArray(v)) return [];
  return v.filter(isObj).flatMap((it): SimpanySalaryPayloadItem[] => {
    const itemId = numOrNull(it.itemId);
    if (itemId == null) return [];
    return [
      {
        itemId,
        amount: num(it.amount),
        note: str(it.note),
        name: str(it.name)?.trim() ?? "",
        type: str(it.type) ?? "",
      },
    ];
  });
}

function parseSubtotal(v: unknown): SimpanySalarySubtotal | null {
  if (!isObj(v)) return null;
  return {
    allowance: numOrNull(v.allowance),
    deduction: numOrNull(v.deduction),
    personalBurden: numOrNull(v.personalBurden),
    withholdingTax: numOrNull(v.withholdingTax),
  };
}

/** 解析單一申報明細：只挑白名單欄位組新物件。 */
export function parseSalaryDeclarationDetail(v: unknown): SimpanySalaryDeclarationDetail | null {
  if (!isObj(v)) return null;
  const id = numOrNull(v.id);
  if (id == null) return null;
  return {
    id,
    isCompanyOwner: v.isCompanyOwner === true,
    payday: dateStr(v.payday),
    yearMonth: str(v.yearMonth),
    payStartDate: dateStr(v.payStartDate),
    payEndDate: dateStr(v.payEndDate),
    laborInsuranceStartDate: dateStr(v.laborInsuranceStartDate),
    laborInsuranceEndDate: dateStr(v.laborInsuranceEndDate),
    laborPensionStartDate: dateStr(v.laborPensionStartDate),
    laborPensionEndDate: dateStr(v.laborPensionEndDate),
    shouldAskIfTerminated: bool(v.shouldAskIfTerminated),
    hasPensionPreparationFundByCompany: v.hasPensionPreparationFundByCompany === true,
    pensionPreparationFundByCompanyRate: str(v.pensionPreparationFundByCompanyRate) ?? "0.00",
    pensionPreparationFundBySelfRate: str(v.pensionPreparationFundBySelfRate) ?? "0.00",
    withholdingTaxDependents: num(v.withholdingTaxDependents),
    healthInsuranceDependents: num(v.healthInsuranceDependents),
    hasOrdinaryAccidentInsurance: v.hasOrdinaryAccidentInsurance === true,
    hasEmploymentInsurance: v.hasEmploymentInsurance === true,
    hasOccupationalAccidentInsurance: v.hasOccupationalAccidentInsurance === true,
    items: parsePayloadItems(v.salaryDeclarationItems),
    subtotal: parseSubtotal(v.subtotal),
  };
}

const PII_KEY = /personal|address|nationality|birth|passport|resident|email|phone|bank|account/i;

/**
 * 形狀未知的回應（調整建議等）：遞迴複製，丟掉看起來像個資的欄位、只留基本型別，限制深度與長度。
 * 用在回傳給使用者看的「Simpany 自動調整了什麼」。
 */
export function stripSalaryPii(v: unknown, depth = 0): unknown {
  if (v === null || typeof v === "boolean" || typeof v === "number") return v;
  if (typeof v === "string") return v.length > 200 ? `${v.slice(0, 199)}…` : v;
  if (depth >= 4) return null;
  if (Array.isArray(v)) return v.slice(0, 50).map((x) => stripSalaryPii(x, depth + 1));
  if (isObj(v)) {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) {
      if (PII_KEY.test(k)) continue;
      out[k] = stripSalaryPii(x, depth + 1);
    }
    return out;
  }
  return null;
}

export function parseSalaryCalculation(v: unknown): SimpanySalaryCalculation | null {
  if (!isObj(v)) return null;
  if (!Array.isArray(v.calculatedSalaryDeclarationItems)) return null;
  return {
    calculatedItems: parsePayloadItems(v.calculatedSalaryDeclarationItems),
    subtotal: parseSubtotal(v.subtotal),
    suggestedInsuranceRange:
      v.suggestedInsuranceRange === undefined ? null : stripSalaryPii(v.suggestedInsuranceRange),
  };
}

function parseOptions(v: unknown): SimpanySalaryOption[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter(isObj)
    .map((o) => ({ id: numOrNull(o.id), name: str(o.name)?.trim() ?? "" }))
    .filter((o): o is SimpanySalaryOption => o.id != null && o.name !== "");
}

export function parseSalarySetting(v: unknown): SimpanySalarySetting | null {
  if (!isObj(v)) return null;
  return {
    minimumSalary: numOrNull(v.salaryMonthMinimumSalary),
    allowanceOptions: parseOptions(v.salaryBasicItemAllowanceOptions),
    deductionOptions: parseOptions(v.salaryBasicItemDeductionOptions),
  };
}

/** `{ data: {...} }` 或直接是物件，兩種都接受。 */
function unwrapData(body: unknown): unknown {
  return isObj(body) && "data" in body ? body.data : body;
}

// ---------------------------------------------------------------------------
// Raw HTTP (no DB side effects) — shared by testConnection and the client
// ---------------------------------------------------------------------------

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function safeFetch(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (e) {
    // 網路層錯誤的訊息不會含 headers，但保險起見只取 message。
    const msg = e instanceof Error ? e.message : String(e);
    throw new SimpanyError("network", `無法連線到 Simpany：${msg}`);
  }
}

/** 登入換 JWT。帳密錯誤丟 kind = "auth"。 */
async function login(creds: IntegrationCredentials): Promise<TokenCache> {
  const account = creds.account?.trim();
  const password = creds.password;
  if (!account || !password) {
    throw new SimpanyError("auth", "Simpany 帳號或密碼未設定");
  }
  const res = await safeFetch(`${AUTH_BASE}/login`, {
    method: "POST",
    headers: { ...BASE_HEADERS, "Content-Type": "application/json" },
    body: JSON.stringify({ account, password }),
  });
  const body = await readBody(res);
  const token = isObj(body) && isObj(body.data) ? str(body.data.token) : null;
  if (res.ok && token && isObj(body) && (body.status === "ok" || body.status === undefined)) {
    const expiresAt = jwtExpiry(token) ?? new Date(Date.now() + FALLBACK_TOKEN_TTL_MS);
    return { value: token, expiresAt };
  }
  const code =
    isObj(body) && isObj(body.error) ? numOrNull(body.error.code) : null;
  if (res.status === 401 || code === 401 || code === 404) {
    throw new SimpanyError("auth", "Simpany 帳號或密碼錯誤", 401);
  }
  if (res.status >= 500) {
    throw new SimpanyError("http", `Simpany 登入失敗（HTTP ${res.status}）`, res.status);
  }
  const reason = simpanyErrorMessage(body) ?? `HTTP ${res.status}`;
  throw new SimpanyError("http", `Simpany 登入失敗：${reason}`, res.status);
}

async function fetchCompanies(token: string): Promise<SimpanyCompany[]> {
  const res = await safeFetch(`${AUTH_BASE}/me`, {
    headers: { ...BASE_HEADERS, Authorization: `Bearer ${token}` },
  });
  const body = await readBody(res);
  if (res.status === 401) throw new SimpanyError("auth", "Simpany 登入已失效", 401);
  if (!res.ok) {
    const reason = simpanyErrorMessage(body) ?? `HTTP ${res.status}`;
    throw new SimpanyError("http", `讀取 Simpany 公司清單失敗：${reason}`, res.status);
  }
  const data = unwrapData(body);
  const companies = isObj(data) && Array.isArray(data.companies) ? data.companies : [];
  return companies.map(parseCompany).filter((c): c is SimpanyCompany => c !== null);
}

/**
 * 決定要用哪一家公司。有指定 companyId 就驗證它在清單內；只有一家就自動選；
 * 多家且沒指定就要求使用者填。
 */
function resolveCompany(
  companies: SimpanyCompany[],
  wanted: unknown,
): { ok: true; company: SimpanyCompany } | { ok: false; error: string } {
  if (companies.length === 0) {
    return { ok: false, error: "這個 Simpany 帳號底下沒有任何公司" };
  }
  const wantedId = numOrNull(typeof wanted === "string" ? wanted.trim() : wanted);
  if (wantedId != null) {
    const hit = companies.find((c) => c.id === wantedId);
    if (hit) return { ok: true, company: hit };
    return {
      ok: false,
      error: `找不到公司 ID ${wantedId}。這個帳號可用的公司：${companies
        .map((c) => `${c.name}（${c.id}）`)
        .join("、")}`,
    };
  }
  if (companies.length === 1) return { ok: true, company: companies[0] };
  return {
    ok: false,
    error: `這個 Simpany 帳號有多家公司，請在「公司 ID」欄位填入要使用的那一家：${companies
      .map((c) => `${c.name}（${c.id}）`)
      .join("、")}`,
  };
}

// ---------------------------------------------------------------------------
// Provider (settings › integrations: connect / reconnect)
// ---------------------------------------------------------------------------

export const simpanyProvider: IntegrationProvider = {
  id: "simpany",
  async testConnection(creds, config) {
    let token: TokenCache;
    try {
      token = await login(creds);
    } catch (e) {
      if (e instanceof SimpanyError && e.kind === "auth") return { ok: false, error: e.message };
      throw e;
    }
    const companies = await fetchCompanies(token.value);
    const resolved = resolveCompany(companies, config.companyId);
    if (!resolved.ok) return { ok: false, error: resolved.error };
    return {
      ok: true,
      config: { companyId: resolved.company.id, companyName: resolved.company.name },
      tokenCache: token,
    };
  },
};

// ---------------------------------------------------------------------------
// Runtime client (business code)
// ---------------------------------------------------------------------------

/**
 * 用帳密重新登入並把新 token 加密存回快取。帳密被拒 → markNeedsReauth 並丟清楚的中文錯誤；
 * 其他失敗 → recordSyncFailure 後原樣丟出。
 */
async function loginAndCache(orgId: string, credentials: IntegrationCredentials): Promise<string> {
  try {
    const fresh = await login(credentials);
    await saveTokenCache(orgId, "simpany", fresh.value, fresh.expiresAt);
    return fresh.value;
  } catch (e) {
    if (e instanceof SimpanyError && e.kind === "auth") {
      await markNeedsReauth(orgId, "simpany", "Simpany 帳號或密碼已失效");
      throw new SimpanyError(
        "auth",
        "Simpany 拒絕了儲存的帳號密碼（可能改過密碼）。請 owner 或 admin 到 設定 › 整合 重新連接 Simpany。",
        401,
      );
    }
    const msg = e instanceof Error ? e.message : String(e);
    await recordSyncFailure(orgId, "simpany", msg.slice(0, 500));
    throw e;
  }
}

type RequestOptions = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  query?: Record<string, string | number | undefined>;
  body?: unknown;
};

/**
 * einvoice = member2 的電子發票；salary = api 的薪資申報唯讀端點（assertSalaryReadOnly）；
 * salaryWrite = 同一個 host 的薪資申報寫入端點（assertSalaryWrite）。
 */
type ApiBase = "einvoice" | "salary" | "salaryWrite";

/**
 * 已登入、已選定公司的 Simpany client。用 getSimpanyClient(orgId) 取得。
 *
 * Token 流程：先用快取的 JWT；收到 401 就丟掉快取、用帳密重新登入、重試一次；
 * 重新登入本身被拒（帳密錯）→ markNeedsReauth，整合轉為「需要重新連接」。
 * 網路錯 / 5xx → recordSyncFailure（狀態不變）。成功 → recordSyncSuccess（每個 client 只記一次）。
 */
export class SimpanyClient {
  private token: string | null;
  private successRecorded = false;

  constructor(
    private readonly orgId: string,
    private readonly credentials: IntegrationCredentials,
    readonly companyId: number,
    readonly companyName: string | null,
    cached: TokenCache | null,
  ) {
    this.token = cached?.value ?? null;
  }

  // ---- token ----

  private async relogin(): Promise<string> {
    this.token = await loginAndCache(this.orgId, this.credentials);
    return this.token;
  }

  private async failure(e: unknown): Promise<void> {
    const msg = e instanceof Error ? e.message : String(e);
    await recordSyncFailure(this.orgId, "simpany", msg.slice(0, 500));
  }

  private async success(): Promise<void> {
    if (this.successRecorded) return;
    this.successRecorded = true;
    await recordSyncSuccess(this.orgId, "simpany");
  }

  // ---- HTTP ----

  private url(base: ApiBase, path: string, query?: RequestOptions["query"]): string {
    const u = new URL(
      base === "einvoice"
        ? `${EINVOICE_BASE}/${this.companyId}/${path}`
        : `${SALARY_BASE}/${this.companyId}/salary-declaration/${path}`,
    );
    for (const [k, v] of Object.entries(query ?? {})) {
      if (v !== undefined && v !== "") u.searchParams.set(k, String(v));
    }
    return u.toString();
  }

  private async send(
    token: string,
    base: ApiBase,
    path: string,
    opts: RequestOptions,
  ): Promise<Response> {
    if (base === "salary") assertSalaryReadOnly(opts.method ?? "GET", path, opts.query);
    if (base === "salaryWrite") assertSalaryWrite(opts.method ?? "GET", path, opts.query);
    const headers: Record<string, string> = { ...BASE_HEADERS, Authorization: `Bearer ${token}` };
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";
    return safeFetch(this.url(base, path, opts.query), {
      method: opts.method ?? "GET",
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
  }

  /** 發一個 e-invoice API 請求，回傳解析後的 body。錯誤一律丟 SimpanyError。 */
  async request(path: string, opts: RequestOptions = {}): Promise<unknown> {
    return this.requestAt("einvoice", path, opts);
  }

  /** 薪資申報（唯讀）：method 寫死 GET，路徑 / query 過 assertSalaryReadOnly 白名單。 */
  private async salaryGet(path: string, query?: RequestOptions["query"]): Promise<unknown> {
    assertSalaryReadOnly("GET", path, query);
    return this.requestAt("salary", path, { method: "GET", query });
  }

  private async requestAt(base: ApiBase, path: string, opts: RequestOptions): Promise<unknown> {
    let res: Response;
    try {
      const token = this.token ?? (await this.relogin());
      res = await this.send(token, base, path, opts);
      if (res.status === 401) {
        // 快取的 token 過期或被撤銷：重新登入、重試一次。
        await clearTokenCache(this.orgId, "simpany");
        this.token = null;
        const fresh = await this.relogin();
        res = await this.send(fresh, base, path, opts);
        if (res.status === 401) {
          await markNeedsReauth(this.orgId, "simpany", "Simpany 拒絕了新登入的 token");
          throw new SimpanyError(
            "auth",
            "Simpany 重新登入後仍拒絕存取。請 owner 或 admin 到 設定 › 整合 重新連接 Simpany。",
            401,
          );
        }
      }
    } catch (e) {
      if (e instanceof SimpanyError && e.kind === "network") await this.failure(e);
      throw e;
    }

    const body = await readBody(res);
    // 薪資申報的回應可能含個資：錯誤訊息只取結構化的 message，不附 body 片段。
    const errorText = (b: unknown) =>
      base === "einvoice" ? simpanyErrorMessage(b) : salaryErrorMessage(b);
    if (res.ok) {
      // 業務錯誤有時仍是 2xx：{ status: "error", error: {...} }
      if (isObj(body) && body.status === "error") {
        throw new SimpanyError(
          "business",
          `Simpany 回應錯誤：${errorText(body) ?? "未知錯誤"}`,
          res.status,
        );
      }
      await this.success();
      return body;
    }
    if (res.status >= 500 || res.status === 429) {
      const err = new SimpanyError(
        "http",
        `Simpany 暫時無法處理（HTTP ${res.status}）：${errorText(body) ?? "無訊息"}`,
        res.status,
      );
      await this.failure(err);
      throw err;
    }
    const kind: SimpanyErrorKind = res.status === 422 || (isObj(body) && isObj(body.errors))
      ? "validation"
      : "business";
    throw new SimpanyError(
      kind,
      `Simpany 拒絕了這個請求（HTTP ${res.status}）：${errorText(body) ?? "無訊息"}`,
      res.status,
    );
  }

  // ---- salary declarations（唯讀）----

  /** GET form/monthly-forms/{year}：一年 12 格，id null = 那個月沒建表單。 */
  async listSalaryMonthlyForms(year: number): Promise<SimpanySalaryMonthlyForm[]> {
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      throw new SimpanyError("config", `不合法的年份：${year}`);
    }
    const body = await this.salaryGet(`form/monthly-forms/${year}`);
    const data = unwrapData(body);
    if (!Array.isArray(data)) {
      // 不附 body 片段：薪資回應可能含個資。
      throw new SimpanyError("business", "Simpany 回傳的薪資申報月份清單格式無法辨識");
    }
    return parseSalaryMonthlyForms(data, year);
  }

  /** GET form?year&month：那個月的表單與每位員工的申報明細（已去識別化）。 */
  async getSalaryForm(year: number, month: number): Promise<SimpanySalaryForm> {
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      throw new SimpanyError("config", `不合法的年份：${year}`);
    }
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      throw new SimpanyError("config", `不合法的月份：${month}`);
    }
    const body = await this.salaryGet("form", { year, month });
    const form = parseSalaryForm(unwrapData(body), year, month);
    if (!form) throw new SimpanyError("business", "Simpany 回傳的薪資申報表單格式無法辨識");
    return form;
  }

  // ---- salary declarations（寫入；只由 src/lib/simpany-payroll.ts 呼叫）----
  //
  // 全部走 salaryWrite → assertSalaryWrite（method + 路徑白名單）。請求 / 回應 body 不寫 log；
  // 錯誤訊息只取 Simpany 的結構化 message（salaryErrorMessage），不附 body 片段。

  private async salaryWrite(
    method: "GET" | "POST" | "PUT" | "PATCH",
    path: string,
    body?: unknown,
  ): Promise<unknown> {
    assertSalaryWrite(method, path);
    return this.requestAt("salaryWrite", path, { method, body });
  }

  /** GET form/{formId}/salary-declaration/{declId}：單一申報明細（寫入時的模板）。 */
  async getSalaryDeclaration(formId: number, declId: number): Promise<SimpanySalaryDeclarationDetail> {
    const body = await this.salaryWrite(
      "GET",
      `form/${positiveId(formId, "formId")}/salary-declaration/${positiveId(declId, "declarationId")}`,
    );
    const detail = parseSalaryDeclarationDetail(unwrapData(body));
    if (!detail) throw new SimpanyError("business", "Simpany 回傳的薪資申報明細格式無法辨識");
    return detail;
  }

  /** GET form/{formId}/setting：加項 / 減項選項、基本工資。 */
  async getSalarySetting(formId: number): Promise<SimpanySalarySetting> {
    const body = await this.salaryWrite("GET", `form/${positiveId(formId, "formId")}/setting`);
    const setting = parseSalarySetting(unwrapData(body));
    if (!setting) throw new SimpanyError("business", "Simpany 回傳的薪資申報設定格式無法辨識");
    return setting;
  }

  /**
   * POST …/calculate：Simpany 會員網頁的即時試算（不存檔）。只在「準備申報」時呼叫。
   */
  async calculateSalaryDeclaration(
    formId: number,
    declId: number,
    payload: SimpanySalaryDeclarationPayload,
  ): Promise<SimpanySalaryCalculation> {
    const body = await this.salaryWrite(
      "POST",
      `form/${positiveId(formId, "formId")}/salary-declaration/${positiveId(declId, "declarationId")}/calculate`,
      payload,
    );
    const calc = parseSalaryCalculation(unwrapData(body));
    if (!calc) throw new SimpanyError("business", "Simpany 回傳的薪資試算結果格式無法辨識");
    return calc;
  }

  /** PUT …/salary-declaration/{declId}：存檔申報明細（整份覆寫，重送同一份結果相同）。 */
  async updateSalaryDeclaration(
    formId: number,
    declId: number,
    payload: SimpanySalaryDeclarationPayload,
  ): Promise<void> {
    await this.salaryWrite(
      "PUT",
      `form/${positiveId(formId, "formId")}/salary-declaration/${positiveId(declId, "declarationId")}`,
      payload,
    );
  }

  /** POST form/{formId}/copy：把來源表單的員工與申報明細複製進來。回傳 Simpany 的級距調整（去個資）。 */
  async copySalaryForm(formId: number, sourceFormId: number, employeeIds: number[]): Promise<unknown> {
    const ids = employeeIds.map((id) => positiveId(id, "employeeId"));
    if (ids.length === 0) throw new SimpanyError("config", "複製薪資申報至少要指定一位員工");
    const body = await this.salaryWrite("POST", `form/${positiveId(formId, "formId")}/copy`, {
      sourceFormId: positiveId(sourceFormId, "sourceFormId"),
      employeeIds: ids,
    });
    const data = unwrapData(body);
    return isObj(data) && data.rangeAdjustments !== undefined ? stripSalaryPii(data.rangeAdjustments) : null;
  }

  /** PATCH form/{formId}/payday。回傳 Simpany 依發薪日做的健保級距調整（去個資）。 */
  async setSalaryPayday(formId: number, payday: string): Promise<unknown> {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(payday)) throw new SimpanyError("config", `不合法的發薪日：${payday}`);
    const body = await this.salaryWrite("PATCH", `form/${positiveId(formId, "formId")}/payday`, { payday });
    const data = unwrapData(body);
    return isObj(data) && data.healthInsuranceRangeByPayDateAdjustments !== undefined
      ? stripSalaryPii(data.healthInsuranceRangeByPayDateAdjustments)
      : null;
  }

  /** PUT …/salary-declaration/{declId}/company-owner。 */
  async setSalaryCompanyOwner(formId: number, declId: number, isCompanyOwner: boolean): Promise<void> {
    await this.salaryWrite(
      "PUT",
      `form/${positiveId(formId, "formId")}/salary-declaration/${positiveId(declId, "declarationId")}/company-owner`,
      { isCompanyOwner },
    );
  }

  /** POST form/{formId}/settle：把這個月送給記帳士。**送出後無法從這裡撤回。** */
  async settleSalaryForm(formId: number, resignedEmployeeIds: number[] = []): Promise<void> {
    await this.salaryWrite("POST", `form/${positiveId(formId, "formId")}/settle`, {
      resignedEmployeeIds: resignedEmployeeIds.map((id) => positiveId(id, "employeeId")),
    });
  }

  /** POST form/{formId}/payslip/send：寄薪資單給員工（Simpany 寄信）。 */
  async sendSalaryPayslips(formId: number, body: SimpanyPayslipSendBody): Promise<void> {
    await this.salaryWrite("POST", `form/${positiveId(formId, "formId")}/payslip/send`, body);
  }

  // ---- receipts ----

  async listReceipts(params: SimpanyListParams): Promise<SimpanyPage<SimpanyReceiptListItem>> {
    const body = await this.request("receipts", {
      query: {
        status: params.status,
        startDate: params.startDate,
        endDate: params.endDate,
        page: params.page ?? 1,
        limit: params.limit ?? 25,
        query: params.query,
      },
    });
    const data = isObj(body) && Array.isArray(body.data) ? body.data : [];
    const meta = isObj(body) && isObj(body.meta) ? body.meta : {};
    return {
      data: data.map(parseListItem).filter((r): r is SimpanyReceiptListItem => r !== null),
      currentPage: num(meta.current_page) || params.page || 1,
      lastPage: num(meta.last_page) || 1,
      total: num(meta.total),
    };
  }

  /** 走完所有分頁。maxPages 是保險絲（Workers 的 subrequest 上限）。 */
  async listAllReceipts(
    params: Omit<SimpanyListParams, "page" | "limit">,
    maxPages = 20,
  ): Promise<{ items: SimpanyReceiptListItem[]; truncated: boolean }> {
    const items: SimpanyReceiptListItem[] = [];
    let page = 1;
    for (;;) {
      const res = await this.listReceipts({ ...params, page, limit: 100 });
      items.push(...res.data);
      if (page >= res.lastPage || res.data.length === 0) return { items, truncated: false };
      if (page >= maxPages) return { items, truncated: true };
      page++;
    }
  }

  async getReceipt(id: string): Promise<SimpanyReceiptDetail> {
    if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new SimpanyError("config", `不合法的 Simpany 發票 id：${id}`);
    const body = await this.request(`receipts/${encodeURIComponent(id)}`);
    const detail = parseDetail(unwrapData(body));
    if (!detail) {
      throw new SimpanyError("business", `Simpany 回傳的發票明細格式無法辨識：${snippet(body)}`);
    }
    return detail;
  }

  /**
   * 開立發票（POST receipts/{b2b|b2c}）。**會產生正式的電子發票並上傳財政部、寄信給買受人。**
   * 只能由 simpany-issue.ts 以使用者確認過的草稿呼叫。
   * 回傳 Simpany 的回應 data（形狀未經實測，呼叫端應再以 getReceipt 取完整明細）。
   */
  async createReceipt(type: SimpanyReceiptType, payload: SimpanyCreateBody): Promise<unknown> {
    const body = await this.request(`receipts/${type.toLowerCase()}`, {
      method: "POST",
      body: payload,
    });
    return unwrapData(body);
  }

  /** 作廢（DELETE receipts/{id}）。不可復原，Simpany 會通知買受人。 */
  async invalidateReceipt(id: string, reason: string): Promise<unknown> {
    if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new SimpanyError("config", `不合法的 Simpany 發票 id：${id}`);
    const body = await this.request(`receipts/${encodeURIComponent(id)}`, {
      method: "DELETE",
      body: { reason, emails: [] },
    });
    return body;
  }

  async getZeroTaxReasons(): Promise<SimpanyZeroTaxReason[]> {
    const body = await this.request("receipts/zero-tax-rate-reasons");
    const data = unwrapData(body);
    const list = Array.isArray(data) ? data : [];
    return list
      .filter(isObj)
      .map((r) => ({ code: str(r.code) ?? "", name: str(r.name) ?? "" }))
      .filter((r) => r.code !== "");
  }

  /**
   * 今年（民國年）字軌剩餘號碼數。回應形狀未經驗證 —— 解析不出來就回 null，
   * 呼叫端只能拿來提示，不可據此擋開立。
   */
  async getRemainingTrackNumbers(date = new Date()): Promise<number | null> {
    const rocYear = Number(
      new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Taipei", year: "numeric" }).format(date),
    ) - 1911;
    try {
      const body = await this.request("track-numbers", { query: { year: rocYear } });
      return sumRemaining(unwrapData(body));
    } catch {
      return null;
    }
  }
}

/** 路徑裡的 id：必須是正整數（擋掉路徑注入）。 */
function positiveId(v: number, what: string): number {
  if (!Number.isSafeInteger(v) || v <= 0) throw new SimpanyError("config", `不合法的 ${what}：${v}`);
  return v;
}

/** 在未知形狀裡找「剩餘」類欄位加總；找不到回 null。 */
function sumRemaining(data: unknown): number | null {
  const KEYS = ["remaining", "remainingCount", "remaining_count", "availableCount", "available", "unusedCount", "remain"];
  let found = false;
  let total = 0;
  const visit = (v: unknown, depth: number) => {
    if (depth > 4) return;
    if (Array.isArray(v)) {
      for (const x of v) visit(x, depth + 1);
      return;
    }
    if (!isObj(v)) return;
    for (const k of KEYS) {
      const n = numOrNull(v[k]);
      if (n != null) {
        found = true;
        total += n;
        return;
      }
    }
    for (const x of Object.values(v)) if (typeof x === "object") visit(x, depth + 1);
  };
  visit(data, 0);
  return found ? total : null;
}

/**
 * 業務程式碼的入口：確認整合可用、決定公司、帶上快取 token。
 * 整合沒連接 / 沒開 / 需要重新連接時丟 IntegrationUnavailableError（訊息告訴使用者怎麼修）。
 */
export async function getSimpanyClient(orgId: string): Promise<SimpanyClient> {
  const { row, credentials } = await requireEnabledIntegration(orgId, "simpany");
  let cached = await loadTokenCache(orgId, "simpany");
  const config: IntegrationConfig = row.config ?? {};
  const companyId = numOrNull(config.companyId);
  const companyName = typeof config.companyName === "string" ? config.companyName : null;
  if (companyId != null) {
    return new SimpanyClient(orgId, credentials, companyId, companyName, cached);
  }

  // 舊連接沒存公司：查一次 /me 並寫回 config。
  let companies: SimpanyCompany[];
  try {
    const token = cached?.value ?? (await loginAndCache(orgId, credentials));
    companies = await fetchCompanies(token);
  } catch (e) {
    if (!(e instanceof SimpanyError && e.kind === "auth" && cached)) throw e;
    await clearTokenCache(orgId, "simpany");
    cached = null;
    companies = await fetchCompanies(await loginAndCache(orgId, credentials));
  }
  const resolved = resolveCompany(companies, config.companyId);
  if (!resolved.ok) throw new SimpanyError("config", resolved.error);
  await updateConfig(orgId, "simpany", {
    companyId: resolved.company.id,
    companyName: resolved.company.name,
  });
  return new SimpanyClient(
    orgId,
    credentials,
    resolved.company.id,
    resolved.company.name,
    cached ?? (await loadTokenCache(orgId, "simpany")),
  );
}

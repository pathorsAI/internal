import { and, desc, eq, gt, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { employees, simpanySalaryDeclarations, simpanySalaryDrafts } from "@/db/schema";
import {
  getSimpanyClient,
  SimpanyError,
  type SimpanyClient,
  type SimpanyMonthSequenceRestriction,
  type SimpanyPayslipSendBody,
  type SimpanySalaryDeclarationDetail,
  type SimpanySalaryDeclarationPayload,
  type SimpanySalaryForm,
  type SimpanySalaryFormEmployee,
  type SimpanySalaryOption,
  type SimpanySalaryPayloadItem,
  type SimpanySalarySubtotal,
} from "@/lib/integrations/simpany";
import { summarizeDeclaration, syncSalaryDeclarations } from "@/lib/simpany-salary";
import { taipeiDate } from "@/lib/simpany-sync";

/**
 * 在 Simpany 填寫每月薪資申報（migrations/0029）。MCP（tools-simpany.ts）與 web 的 server
 * actions（dashboard/payroll/simpany-salary-actions.ts）共用這一支。
 *
 * 流程（每一步都要使用者明確動作）：
 *   1. prepareSalaryFiling —— 讀表單與每位員工的申報明細當模板，只換日期與金額，呼叫 Simpany
 *      的試算（calculate，不存檔），把要 PUT 的 body 原樣存成草稿，回傳每人的應發 / 個人負擔 /
 *      公司負擔 / 扣繳 / 實發。表單缺人時規劃從最近一個已結算的月份複製（複製是寫入，只有
 *      allowCopy 才做）。
 *   2. applySalaryFiling(draftId) —— 只收 draftId：負責人旗標 → 發薪日 → 逐一 PUT 申報明細，
 *      讀回來比對實發，再同步回本地。
 *   3. settleSalaryFiling —— 三個確認（發薪日、負責人、薪資）都為 true 才送出結算（給記帳士）。
 *   4. sendPayslips —— 已結算的月份才能寄薪資單。
 *
 * 不做的事：建立 / 修改 / 刪除 Simpany 員工（需要身分證字號）—— 表單上找不到的人一律回報，
 * 請使用者到 Simpany 的介面新增。股東往來還款不是薪資，永遠不寫進 Simpany。
 *
 * ⚠️ 個資：只碰姓名、Simpany 員工 / 申報 id、金額、日期、旗標。請求 / 回應 body 不寫 log。
 */

export class SalaryFilingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SalaryFilingError";
  }
}

const DRAFT_TTL_MS = 2 * 60 * 60 * 1000;
/** 往前找模板 / 複製來源時，最多讀幾張表單（每張一個 GET）。 */
const MAX_FORM_LOOKUPS = 6;

/** Simpany 的項目 id（從會員網頁 bundle 與實際 GET 確認）。 */
export const SALARY_ITEM_ID = { BASE: 24, BONUS: 11, REIMBURSEMENT: 49 } as const;

/** 每月固定的加項：沒有另外指定時沿用模板（本薪、免稅伙食津貼、經常性獎金）。其餘視為一次性，不沿用。 */
const RECURRING_ALLOWANCE_IDS: ReadonlySet<number> = new Set([24, 1, 36]);

/** Simpany 拿不到設定時的後備選項（form/{id}/setting 的 salaryBasicItem*Options）。 */
export const DEFAULT_ALLOWANCE_OPTIONS: SimpanySalaryOption[] = [
  { id: 1, name: "免稅伙食津貼" },
  { id: 5, name: "應稅其他加項" },
  { id: 6, name: "特休未休代金" },
  { id: 8, name: "免稅加班費" },
  { id: 10, name: "年終獎金" },
  { id: 11, name: "非經常性獎金" },
  { id: 36, name: "經常性獎金" },
  { id: 49, name: "員工代墊款" },
  { id: 51, name: "免稅資遣費" },
];
export const DEFAULT_DEDUCTION_OPTIONS: SimpanySalaryOption[] = [
  { id: 44, name: "應稅其他減項" },
  { id: 50, name: "公司代墊款" },
];

const pad2 = (n: number) => String(n).padStart(2, "0");
const norm = (s: string) => s.replaceAll(/\s+/g, "");
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function assertYearMonth(year: number, month: number): void {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new SalaryFilingError(`不合法的年份：${year}`);
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new SalaryFilingError(`不合法的月份：${month}`);
  }
}

/** 薪資所屬月份的第一天與最後一天。 */
export function monthRange(year: number, month: number): { start: string; end: string } {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { start: `${year}-${pad2(month)}-01`, end: `${year}-${pad2(month)}-${pad2(last)}` };
}

/** 慣例：M 月的薪資在 M+1 月 5 日發。 */
export function defaultSalaryPayday(year: number, month: number): string {
  return month === 12 ? `${year + 1}-01-05` : `${year}-${pad2(month + 1)}-05`;
}

/** 「2026 年 10 月 5 日」 */
function zhDate(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return `${y} 年 ${m} 月 ${d} 日`;
}

/** Simpany 會員網頁寄薪資單的預設信件內容。 */
export function defaultPayslipMail(year: number, month: number, payday: string): string {
  return [
    "您好，",
    `${year} 年 ${month} 月的薪資已於 ${zhDate(payday)} 發放。附件為薪資明細，密碼為您的身分證件號碼或統一證號（居留證號碼），英文字母須大寫。若有疑問請聯繫相關人員。`,
    "此為系統通知請勿直接回覆。",
  ].join("\n\n");
}

// ---------------------------------------------------------------------------
// Payload builder（純函式，可單獨測）
// ---------------------------------------------------------------------------

export type SalaryItemInput = { itemId: number; amount: number; note?: string | null };

export type SalaryAmounts = {
  baseSalary: number;
  /** 非經常性獎金（itemId 11）。 */
  bonus?: number;
  /** 員工代墊款（itemId 49）。 */
  reimbursement?: number;
  /** 給了就整組取代模板裡本薪以外的其他加項（不能含 11 / 49，那兩個用 bonus / reimbursement）。 */
  otherAllowances?: SalaryItemInput[];
  /** 給了就整組取代模板裡可編輯的減項（應稅其他減項 44、公司代墊款 50）。 */
  otherDeductions?: SalaryItemInput[];
  /** 印在這次新增的獎金 / 代墊款項目上的備註。 */
  note?: string | null;
};

export type SalaryOptions = {
  allowanceOptions: SimpanySalaryOption[];
  deductionOptions: SimpanySalaryOption[];
};

export type BuiltDeclaration = {
  payload: SimpanySalaryDeclarationPayload;
  /** 模板裡有、這次沒有沿用的項目（一次性的獎金、代墊款、減項…）。 */
  dropped: SimpanySalaryPayloadItem[];
};

function assertAmount(n: number | undefined, what: string, opts: { positive?: boolean } = {}): void {
  if (n === undefined) return;
  if (!Number.isInteger(n) || n < 0) throw new SalaryFilingError(`${what}必須是 0 以上的整數台幣（收到 ${n}）`);
  if (opts.positive && n === 0) throw new SalaryFilingError(`${what}必須大於 0`);
}

const typeOf = (it: SimpanySalaryPayloadItem) => it.type.toUpperCase();

/** 使用者可編輯的項目（送進 salaryDeclarationItems）；其他都是 Simpany 算出來的。 */
export function isEditableItem(it: SimpanySalaryPayloadItem, deductionIds: ReadonlySet<number>): boolean {
  const t = typeOf(it);
  return t === "ALLOWANCE" || t === "INSURANCE_RANGE" || (t === "DEDUCTION" && deductionIds.has(it.itemId));
}

function isBaseItem(it: SimpanySalaryPayloadItem): boolean {
  return typeOf(it) === "ALLOWANCE" && (it.itemId === SALARY_ITEM_ID.BASE || norm(it.name) === "本薪");
}

function optionItems(
  inputs: SalaryItemInput[],
  options: Map<number, string>,
  kind: "ALLOWANCE" | "DEDUCTION",
  forbidden: ReadonlySet<number>,
): SimpanySalaryPayloadItem[] {
  const seen = new Set<number>();
  return inputs.map((x) => {
    if (!Number.isInteger(x.itemId) || !options.has(x.itemId) || forbidden.has(x.itemId)) {
      const allowed = [...options].filter(([id]) => !forbidden.has(id)).map(([id, n]) => `${id} ${n}`);
      throw new SalaryFilingError(`${kind === "ALLOWANCE" ? "加項" : "減項"} itemId ${x.itemId} 不能用；可用：${allowed.join("、")}`);
    }
    if (seen.has(x.itemId)) throw new SalaryFilingError(`itemId ${x.itemId} 重複`);
    seen.add(x.itemId);
    assertAmount(x.amount, `項目 ${x.itemId} 的金額`);
    return { itemId: x.itemId, amount: x.amount, note: x.note?.trim() || null, name: options.get(x.itemId) ?? "", type: kind };
  });
}

/** 本薪以外、不能用 otherAllowances 帶的加項（獎金 / 代墊款有自己的欄位）。 */
const RESERVED_ALLOWANCE_IDS: ReadonlySet<number> = new Set<number>([
  SALARY_ITEM_ID.BONUS,
  SALARY_ITEM_ID.REIMBURSEMENT,
  SALARY_ITEM_ID.BASE,
]);

type ItemSplit = { items: SimpanySalaryPayloadItem[]; dropped: SimpanySalaryPayloadItem[] };

/** 本薪項目：沿用模板的 itemId / 名稱 / 備註，只換金額。 */
function baseItem(baseTpl: SimpanySalaryPayloadItem | undefined, amount: number): SimpanySalaryPayloadItem {
  return {
    itemId: baseTpl?.itemId ?? SALARY_ITEM_ID.BASE,
    amount,
    note: baseTpl?.note ?? null,
    name: baseTpl?.name || "本薪",
    type: "ALLOWANCE",
  };
}

/** 其他加項：有指定就整組取代；沒指定只沿用每月固定的，其餘列為 dropped。 */
function otherAllowanceItems(
  otherTpl: SimpanySalaryPayloadItem[],
  given: SalaryItemInput[] | undefined,
  allowNames: Map<number, string>,
): ItemSplit {
  if (given) {
    const items = optionItems(given, allowNames, "ALLOWANCE", RESERVED_ALLOWANCE_IDS);
    return { items, dropped: otherTpl.filter((it) => !items.some((g) => g.itemId === it.itemId)) };
  }
  return {
    items: otherTpl.filter((it) => RECURRING_ALLOWANCE_IDS.has(it.itemId)).map((it) => ({ ...it })),
    dropped: otherTpl.filter((it) => !RECURRING_ALLOWANCE_IDS.has(it.itemId)),
  };
}

/** 這個月才有的一次性加項（獎金 / 代墊款）；金額是 0 或沒給就不放。 */
function oneOffItem(
  itemId: number,
  amount: number | undefined,
  note: string | null,
  allowNames: Map<number, string>,
  fallbackName: string,
): SimpanySalaryPayloadItem[] {
  if (!amount || amount <= 0) return [];
  return [{ itemId, amount, note, name: allowNames.get(itemId) ?? fallbackName, type: "ALLOWANCE" }];
}

/** 可編輯的減項：一律一次性，有指定才放；模板裡的列為 dropped。 */
function deductionItems(
  dedTpl: SimpanySalaryPayloadItem[],
  given: SalaryItemInput[] | undefined,
  dedNames: Map<number, string>,
): ItemSplit {
  const items = given ? optionItems(given, dedNames, "DEDUCTION", new Set()) : [];
  return { items, dropped: dedTpl.filter((it) => !items.some((d) => d.itemId === it.itemId)) };
}

/** 模板有勞保 / 勞退期間才改成整個月，沒有就維持 null。 */
function periodDates(
  decl: SimpanySalaryDeclarationDetail,
  range: { start: string; end: string },
): Pick<
  SimpanySalaryDeclarationPayload,
  "laborInsuranceStartDate" | "laborInsuranceEndDate" | "laborPensionStartDate" | "laborPensionEndDate"
> {
  const hasLabor = decl.laborInsuranceStartDate != null || decl.laborInsuranceEndDate != null;
  const hasPension = decl.laborPensionStartDate != null || decl.laborPensionEndDate != null;
  return {
    laborInsuranceStartDate: hasLabor ? range.start : null,
    laborInsuranceEndDate: hasLabor ? range.end : null,
    laborPensionStartDate: hasPension ? range.start : null,
    laborPensionEndDate: hasPension ? range.end : null,
  };
}

/**
 * 以 Simpany 的申報明細為模板，組出這個月要試算 / 存檔的 body。
 * 只改：薪資期間與勞保 / 勞退期間（模板有值才改成整個月）、本薪、獎金、代墊款、其他加減項。
 * 投保級距（INSURANCE_RANGE）、投保旗標、扶養人數、勞退自提 / 雇主提繳率一律沿用模板。
 */
export function buildDeclarationPayload(
  decl: SimpanySalaryDeclarationDetail,
  year: number,
  month: number,
  amounts: SalaryAmounts,
  opts: SalaryOptions,
): BuiltDeclaration {
  assertYearMonth(year, month);
  assertAmount(amounts.baseSalary, "本薪", { positive: true });
  assertAmount(amounts.bonus, "非經常性獎金");
  assertAmount(amounts.reimbursement, "員工代墊款");
  const allowNames = new Map(opts.allowanceOptions.map((o) => [o.id, o.name]));
  const dedNames = new Map(opts.deductionOptions.map((o) => [o.id, o.name]));
  const dedIds = new Set(dedNames.keys());
  const range = monthRange(year, month);

  const editable = decl.items.filter((it) => isEditableItem(it, dedIds));
  const calculated = decl.items.filter((it) => !isEditableItem(it, dedIds)).map((it) => ({ ...it }));

  const baseTpl = editable.find(isBaseItem);
  const others = otherAllowanceItems(
    editable.filter((it) => typeOf(it) === "ALLOWANCE" && it !== baseTpl),
    amounts.otherAllowances,
    allowNames,
  );
  const note = amounts.note?.trim() || null;
  const allowances: SimpanySalaryPayloadItem[] = [
    baseItem(baseTpl, amounts.baseSalary),
    ...others.items,
    ...oneOffItem(SALARY_ITEM_ID.BONUS, amounts.bonus, note, allowNames, "非經常性獎金"),
    ...oneOffItem(SALARY_ITEM_ID.REIMBURSEMENT, amounts.reimbursement, note, allowNames, "員工代墊款"),
  ];
  const deductions = deductionItems(
    editable.filter((it) => typeOf(it) === "DEDUCTION"),
    amounts.otherDeductions,
    dedNames,
  );
  // 投保級距：原樣沿用
  const ranges = editable.filter((it) => typeOf(it) === "INSURANCE_RANGE").map((it) => ({ ...it }));
  const dates = periodDates(decl, range);

  const payload: SimpanySalaryDeclarationPayload = {
    payStartDate: range.start,
    payEndDate: range.end,
    hasEmploymentInsurance: decl.hasEmploymentInsurance,
    hasOrdinaryAccidentInsurance: decl.hasOrdinaryAccidentInsurance,
    hasPensionPreparationFundByCompany: decl.hasPensionPreparationFundByCompany,
    healthInsuranceDependents: decl.healthInsuranceDependents,
    pensionPreparationFundByCompanyRate: decl.pensionPreparationFundByCompanyRate,
    pensionPreparationFundBySelfRate: decl.pensionPreparationFundBySelfRate,
    withholdingTaxDependents: decl.withholdingTaxDependents,
    salaryDeclarationItems: [...allowances, ...deductions.items, ...ranges],
    calculatedSalaryDeclarationItems: calculated,
    laborInsuranceStartDate: dates.laborInsuranceStartDate,
    laborInsuranceEndDate: dates.laborInsuranceEndDate,
    laborPensionStartDate: dates.laborPensionStartDate,
    laborPensionEndDate: dates.laborPensionEndDate,
    hasOccupationalAccidentInsurance: decl.hasOccupationalAccidentInsurance,
  };
  const dropped = [...others.dropped, ...deductions.dropped];
  return {
    payload,
    dropped: dropped.filter(
      (it) => !allowances.some((a) => a.itemId === it.itemId) && !deductions.items.some((d) => d.itemId === it.itemId),
    ),
  };
}

// ---------------------------------------------------------------------------
// Figures（從 Simpany 算好的項目抽出給人看的數字）
// ---------------------------------------------------------------------------

export type SalaryFigures = {
  /** 應發（加項合計）。 */
  gross: number;
  /** 個人負擔（勞健保自付）。 */
  personalBurden: number;
  /** 公司負擔（勞健保、就業保險、勞退提繳…）。 */
  companyInsurance: number;
  /** 薪資扣繳。 */
  withholding: number;
  /** 實際發薪（實發）。 */
  net: number | null;
  /** 實際申報薪資。 */
  declared: number | null;
  insuredRanges: { name: string; amount: number }[];
};

export function salaryFigures(
  items: SimpanySalaryPayloadItem[],
  subtotal: SimpanySalarySubtotal | null,
): SalaryFigures {
  const plain = items.map((it) => ({ name: it.name, type: it.type, amount: it.amount }));
  const s = summarizeDeclaration(plain);
  const isAmount = (it: SimpanySalaryPayloadItem) => {
    const t = typeOf(it);
    return t !== "INSURANCE_RANGE" && t !== "PAYSLIP_SUMMARY";
  };
  const allowanceSum = items.filter((it) => typeOf(it) === "ALLOWANCE").reduce((a, it) => a + it.amount, 0);
  const withholdingItem = items.find((it) => typeOf(it) === "DEDUCTION" && norm(it.name) === "薪資扣繳");
  const companyInsurance = items
    .filter((it) => isAmount(it) && !norm(it.name).includes("代墊"))
    .filter((it) => norm(it.name).includes("公司負擔") || norm(it.name).includes("公司提繳"))
    .reduce((a, it) => a + it.amount, 0);
  return {
    gross: subtotal?.allowance ?? allowanceSum,
    personalBurden: subtotal?.personalBurden ?? (s.laborInsPersonal ?? 0) + (s.healthInsPersonal ?? 0),
    companyInsurance,
    withholding: subtotal?.withholdingTax ?? withholdingItem?.amount ?? 0,
    net: s.netPay,
    declared: s.grossDeclared,
    insuredRanges: items
      .filter((it) => typeOf(it) === "INSURANCE_RANGE")
      .map((it) => ({ name: it.name, amount: it.amount })),
  };
}

/** 形狀未知的建議級距裡所有的數字。 */
function numericLeaves(v: unknown, out: number[] = [], depth = 0): number[] {
  if (depth > 4) return out;
  if (typeof v === "number" && Number.isFinite(v)) out.push(v);
  else if (Array.isArray(v)) for (const x of v) numericLeaves(x, out, depth + 1);
  else if (v && typeof v === "object") for (const x of Object.values(v)) numericLeaves(x, out, depth + 1);
  return out;
}

// ---------------------------------------------------------------------------
// Internal data
// ---------------------------------------------------------------------------

type InternalEmployee = {
  id: number;
  name: string;
  baseSalary: string | null;
  startDate: string | null;
  endDate: string | null;
  isActive: boolean;
  employmentType: string;
};

async function loadInternalEmployees(orgId: string): Promise<InternalEmployee[]> {
  return getDb()
    .select({
      id: employees.id,
      name: employees.name,
      baseSalary: employees.baseSalary,
      startDate: employees.startDate,
      endDate: employees.endDate,
      isActive: employees.isActive,
      employmentType: employees.employmentType,
    })
    .from(employees)
    .where(and(eq(employees.organizationId, orgId), isNull(employees.deletedAt)));
}

/** 姓名 → 員工；重名的不綁（回 null）。 */
function byUniqueName(list: InternalEmployee[]): Map<string, InternalEmployee | null> {
  const m = new Map<string, InternalEmployee | null>();
  for (const e of list) {
    const k = e.name.trim();
    m.set(k, m.has(k) ? null : e);
  }
  return m;
}

function positiveNumber(v: string | null | undefined): number | null {
  const n = Number(v);
  return v != null && Number.isFinite(n) && n > 0 ? n : null;
}

// ---------------------------------------------------------------------------
// Simpany lookups
// ---------------------------------------------------------------------------

type FoundForm = { form: SimpanySalaryForm; year: number; month: number };

/**
 * 往前找最近一個已結算的表單（本年早於 month 的月份，再往前一年）。wantNames 有給時只看
 * 表單上有其中任何一人的月份。最多讀 MAX_FORM_LOOKUPS 張表單。
 */
async function findLatestSettledForm(
  client: SimpanyClient,
  year: number,
  month: number,
  wantNames: ReadonlySet<string> | null,
): Promise<FoundForm | null> {
  let lookups = 0;
  for (const y of [year, year - 1]) {
    const monthly = await client.listSalaryMonthlyForms(y);
    const candidates = monthly
      .filter((m) => m.id != null && (y < year || m.month < month))
      .filter((m) => !wantNames || m.employees.some((e) => wantNames.has(e.name)))
      .sort((a, b) => b.month - a.month);
    for (const m of candidates) {
      if (lookups >= MAX_FORM_LOOKUPS) return null;
      lookups++;
      const form = await client.getSalaryForm(y, m.month);
      if (form.isSettled) return { form, year: y, month: m.month };
    }
  }
  return null;
}

/** sourceFormId → 它是哪一年哪一月（查本年與前一年的 monthly-forms）。 */
async function findFormById(client: SimpanyClient, year: number, formId: number): Promise<FoundForm | null> {
  for (const y of [year, year - 1]) {
    const monthly = await client.listSalaryMonthlyForms(y);
    const hit = monthly.find((m) => m.id === formId);
    if (hit) return { form: await client.getSalaryForm(y, hit.month), year: y, month: hit.month };
  }
  return null;
}

function ownerOf(form: SimpanySalaryForm | null | undefined): string | null {
  return form?.employees.find((e) => e.declaration?.isCompanyOwner)?.name ?? null;
}

function baseFromForm(emp: SimpanySalaryFormEmployee | undefined): number | null {
  const items = emp?.declaration?.items ?? [];
  const s = summarizeDeclaration(items);
  return s.baseSalary != null && s.baseSalary > 0 ? s.baseSalary : null;
}

function restrictionText(r: SimpanyMonthSequenceRestriction): string {
  const months = r.missingMonths.length ? `：${r.missingMonths.join("、")}` : "";
  const why = r.reason === "EXISTING_OUT_OF_SEQUENCE_RECORDS" ? "前面還有沒結算的月份" : r.reason;
  return `Simpany 要求依序結算（${why}${months}）。要先把這些月份結算，這個月才能送出。`;
}

// ---------------------------------------------------------------------------
// Prepare
// ---------------------------------------------------------------------------

export type SalaryFilingEmployeeInput = {
  /** 本系統員工 id（或用 name）。 */
  employeeId?: number;
  /** 姓名，要和 Simpany 上的一模一樣。 */
  name?: string;
  baseSalary?: number;
  bonus?: number;
  reimbursement?: number;
  otherAllowances?: SalaryItemInput[];
  otherDeductions?: SalaryItemInput[];
  note?: string;
};

export type PrepareSalaryInput = {
  year: number;
  month: number;
  /** YYYY-MM-DD，預設次月 5 日。 */
  payday?: string;
  /** 沒給 = 這個月表單上的人 + 最近一個已結算月份的人（排除本系統已離職的）。 */
  employees?: SalaryFilingEmployeeInput[];
  /** 表單缺人時從哪張表單複製；預設最近一個有這些人的已結算表單。 */
  sourceFormId?: number;
  /** 表單缺人時真的執行複製（寫入 Simpany）。預設 false：只回傳計畫。 */
  allowCopy?: boolean;
  /** 負責人姓名；預設沿用最近一個已結算月份（沒有就這個月）標記的負責人。 */
  companyOwner?: string;
};

export type SalaryFilingEmployeePreview = {
  name: string;
  employeeId: number | null;
  simpanyEmployeeId: number;
  declarationId: number;
  isCompanyOwner: boolean;
  /** 寫入時會修正 Simpany 上的負責人旗標。 */
  ownerFlagChange: boolean;
  baseSalary: number;
  baseSource: "input" | "employee" | "last_filed";
  bonus: number;
  reimbursement: number;
  otherItems: { itemId: number; name: string; type: string; amount: number }[];
  droppedItems: { itemId: number; name: string; amount: number }[];
  suggestedInsuranceRange: unknown;
} & SalaryFigures;

export type SalaryCopyPlan = {
  required: boolean;
  performed: boolean;
  sourceFormId: number | null;
  sourceYear: number | null;
  sourceMonth: number | null;
  employees: string[];
  adjustments: unknown;
};

export type SalaryFilingPreview = {
  draftId: number | null;
  expiresAt: string | null;
  year: number;
  month: number;
  formId: number;
  payday: string;
  currentPayday: string | null;
  canSettle: boolean | null;
  sequenceRestriction: SimpanyMonthSequenceRestriction | null;
  companyOwner: { name: string; source: "input" | "last_settled" | "current_form" } | null;
  copy: SalaryCopyPlan | null;
  /** 在 Simpany 找不到（也沒有可複製的來源）的人：請到 Simpany 的介面新增員工。 */
  notInSimpany: string[];
  /** 算不出來的人（Simpany 拒絕試算、表單上沒有申報明細…）；有問題就不會產生草稿。 */
  problems: { name: string; message: string }[];
  employees: SalaryFilingEmployeePreview[];
  totals: { gross: number; personalBurden: number; companyInsurance: number; withholding: number; net: number };
  warnings: string[];
  summary: string;
};

type Target = { name: string; internal: InternalEmployee | null; input: SalaryFilingEmployeeInput | null };

function explicitTargets(inputs: SalaryFilingEmployeeInput[], internal: InternalEmployee[]): Target[] {
  const byId = new Map(internal.map((e) => [e.id, e]));
  const byName = byUniqueName(internal);
  const seen = new Set<string>();
  return inputs.map((x, i) => {
    let name: string;
    let emp: InternalEmployee | null;
    if (x.employeeId != null) {
      emp = byId.get(x.employeeId) ?? null;
      if (!emp) throw new SalaryFilingError(`找不到員工 #${x.employeeId}`);
      name = emp.name.trim();
    } else if (x.name?.trim()) {
      name = x.name.trim();
      emp = byName.get(name) ?? null;
    } else {
      throw new SalaryFilingError(`第 ${i + 1} 位員工要給 employeeId 或 name`);
    }
    if (seen.has(name)) throw new SalaryFilingError(`${name} 重複出現`);
    seen.add(name);
    return { name, internal: emp, input: x };
  });
}

/** 預設對象：這個月表單上的人 + 模板月份的人，排除本系統記錄在這個月之前就離職的。 */
function defaultTargets(
  form: SimpanySalaryForm,
  template: SimpanySalaryForm | null,
  internal: InternalEmployee[],
  monthStart: string,
): Target[] {
  const byName = byUniqueName(internal);
  const names = new Set<string>([
    ...form.employees.map((e) => e.name),
    ...(template?.employees.filter((e) => e.declaration?.items.length).map((e) => e.name) ?? []),
  ]);
  const out: Target[] = [];
  for (const name of names) {
    const emp = byName.get(name) ?? null;
    if (emp?.endDate && emp.endDate < monthStart) continue;
    out.push({ name, internal: emp, input: null });
  }
  return out;
}

type Resolved = { base: number; source: SalaryFilingEmployeePreview["baseSource"] } | null;

function resolveBase(t: Target, decl: SimpanySalaryDeclarationDetail, templateEmp: SimpanySalaryFormEmployee | undefined): Resolved {
  if (t.input?.baseSalary != null) return { base: t.input.baseSalary, source: "input" };
  const fromEmployee = positiveNumber(t.internal?.baseSalary);
  if (fromEmployee != null) return { base: Math.round(fromEmployee), source: "employee" };
  const inForm = decl.items.find(isBaseItem)?.amount;
  const last = inForm && inForm > 0 ? inForm : baseFromForm(templateEmp);
  return last == null ? null : { base: last, source: "last_filed" };
}

type CopyContext = {
  client: SimpanyClient;
  input: PrepareSalaryInput;
  form: SimpanySalaryForm;
  template: FoundForm | null;
  missing: string[];
  warnings: string[];
};

/** 表單缺人：找來源、規劃複製；allowCopy 才真的寫入。回傳（可能已更新的）表單與計畫。 */
async function planCopy(ctx: CopyContext): Promise<{
  form: SimpanySalaryForm;
  plan: SalaryCopyPlan;
  notInSimpany: string[];
}> {
  const { client, input, missing } = ctx;
  const want = new Set(missing);
  let source: FoundForm | null = null;
  if (input.sourceFormId != null) {
    source = await findFormById(client, input.year, input.sourceFormId);
    if (!source) throw new SalaryFilingError(`在 ${input.year - 1}～${input.year} 年找不到 Simpany 表單 #${input.sourceFormId}`);
    if (!source.form.isSettled) ctx.warnings.push(`複製來源 ${source.year}-${pad2(source.month)} 還沒結算`);
  } else if (ctx.template?.form.employees.some((e) => want.has(e.name))) {
    source = ctx.template;
  } else {
    source = await findLatestSettledForm(client, input.year, input.month, want);
  }
  const srcEmps = source?.form.employees.filter((e) => want.has(e.name)) ?? [];
  const copyNames = srcEmps.map((e) => e.name);
  const notInSimpany = missing.filter((n) => !copyNames.includes(n));
  const plan: SalaryCopyPlan = {
    required: srcEmps.length > 0,
    performed: false,
    sourceFormId: source?.form.id ?? null,
    sourceYear: source?.year ?? null,
    sourceMonth: source?.month ?? null,
    employees: copyNames,
    adjustments: null,
  };
  if (!plan.required || !input.allowCopy || source?.form.id == null || ctx.form.id == null) {
    return { form: ctx.form, plan, notInSimpany };
  }
  plan.adjustments = await client.copySalaryForm(ctx.form.id, source.form.id, srcEmps.map((e) => e.id));
  plan.performed = true;
  return { form: await client.getSalaryForm(input.year, input.month), plan, notInSimpany };
}

function sum(xs: number[]): number {
  return Math.round(xs.reduce((a, x) => a + x, 0) * 100) / 100;
}

type EmployeeCalc = { preview: SalaryFilingEmployeePreview; body: SimpanySalaryDeclarationPayload };

type CalcContext = {
  client: SimpanyClient;
  formId: number;
  year: number;
  month: number;
  options: SalaryOptions;
  minimumSalary: number | null;
  templateByName: Map<string, SimpanySalaryFormEmployee>;
  ownerName: string | null;
  monthStart: string;
  monthEnd: string;
  warnings: string[];
};

async function calculateEmployee(t: Target, emp: SimpanySalaryFormEmployee, ctx: CalcContext): Promise<EmployeeCalc> {
  const declId = emp.declaration?.id;
  if (declId == null) {
    throw new SalaryFilingError("表單上有這個人但沒有申報明細，請到 Simpany 確認");
  }
  const decl = await ctx.client.getSalaryDeclaration(ctx.formId, declId);
  const base = resolveBase(t, decl, ctx.templateByName.get(t.name));
  if (!base) throw new SalaryFilingError("沒有本薪：請提供 baseSalary，或在員工資料填本薪");
  const x = t.input;
  const built = buildDeclarationPayload(
    decl,
    ctx.year,
    ctx.month,
    {
      baseSalary: base.base,
      bonus: x?.bonus,
      reimbursement: x?.reimbursement,
      otherAllowances: x?.otherAllowances,
      otherDeductions: x?.otherDeductions,
      note: x?.note,
    },
    ctx.options,
  );
  const calc = await ctx.client.calculateSalaryDeclaration(ctx.formId, declId, built.payload);
  const body: SimpanySalaryDeclarationPayload = {
    ...built.payload,
    calculatedSalaryDeclarationItems: calc.calculatedItems,
  };
  const figures = salaryFigures([...body.salaryDeclarationItems, ...calc.calculatedItems], calc.subtotal);
  const isOwner = ctx.ownerName ? t.name === ctx.ownerName : decl.isCompanyOwner;

  // ---- warnings ----
  const w = ctx.warnings;
  if (!figures.insuredRanges.length) w.push(`${t.name}：申報明細沒有投保級距，請在 Simpany 確認`);
  const maxRange = Math.max(0, ...figures.insuredRanges.map((r) => r.amount));
  if (figures.insuredRanges.length && base.base > maxRange) {
    w.push(`${t.name}：本薪 ${base.base} 高於目前的投保級距 ${maxRange}，可能要在 Simpany 調高級距（這裡不會自動改）`);
  }
  const suggested = numericLeaves(calc.suggestedInsuranceRange);
  const current = new Set(figures.insuredRanges.map((r) => r.amount));
  if (suggested.some((n) => n > 0 && !current.has(n))) {
    w.push(`${t.name}：Simpany 建議的投保級距與目前不同（${suggested.join("、")}），這裡沿用目前級距`);
  }
  if (ctx.minimumSalary && base.base < ctx.minimumSalary && t.internal?.employmentType === "full_time") {
    w.push(`${t.name}：本薪 ${base.base} 低於基本工資 ${ctx.minimumSalary}`);
  }
  if (t.internal?.startDate && t.internal.startDate > ctx.monthStart && t.internal.startDate <= ctx.monthEnd) {
    w.push(`${t.name}：${t.internal.startDate} 到職（月中），薪資期間仍以整月計，請確認`);
  }
  if (t.internal?.endDate && t.internal.endDate >= ctx.monthStart && t.internal.endDate < ctx.monthEnd) {
    w.push(`${t.name}：${t.internal.endDate} 離職（月中），薪資期間仍以整月計，請確認`);
  }
  if (built.dropped.length) {
    const droppedText = built.dropped.map((d) => d.name + " " + String(d.amount)).join("、");
    w.push(`${t.name}：模板裡的 ${droppedText} 是一次性項目，這個月沒有沿用`);
  }

  const bonus = body.salaryDeclarationItems.find((it) => it.itemId === SALARY_ITEM_ID.BONUS)?.amount ?? 0;
  const reimbursement =
    body.salaryDeclarationItems.find((it) => it.itemId === SALARY_ITEM_ID.REIMBURSEMENT)?.amount ?? 0;
  const baseIds = new Set<number>([SALARY_ITEM_ID.BASE, SALARY_ITEM_ID.BONUS, SALARY_ITEM_ID.REIMBURSEMENT]);
  return {
    body,
    preview: {
      name: t.name,
      employeeId: t.internal?.id ?? null,
      simpanyEmployeeId: emp.id,
      declarationId: declId,
      isCompanyOwner: isOwner,
      ownerFlagChange: isOwner !== decl.isCompanyOwner,
      baseSalary: base.base,
      baseSource: base.source,
      bonus,
      reimbursement,
      otherItems: body.salaryDeclarationItems
        .filter((it) => typeOf(it) !== "INSURANCE_RANGE" && !baseIds.has(it.itemId))
        .map((it) => ({ itemId: it.itemId, name: it.name, type: it.type, amount: it.amount })),
      droppedItems: built.dropped.map((d) => ({ itemId: d.itemId, name: d.name, amount: d.amount })),
      suggestedInsuranceRange: calc.suggestedInsuranceRange,
      ...figures,
    },
  };
}

function resolvePayday(input: PrepareSalaryInput, warnings: string[]): string {
  const conventional = defaultSalaryPayday(input.year, input.month);
  const payday = input.payday?.trim() || conventional;
  if (!DATE_RE.test(payday) || Number.isNaN(Date.parse(payday))) {
    throw new SalaryFilingError(`發薪日「${payday}」不是 YYYY-MM-DD`);
  }
  if (payday < monthRange(input.year, input.month).start) {
    throw new SalaryFilingError(`發薪日 ${payday} 早於薪資月份`);
  }
  if (payday !== conventional) {
    warnings.push(`發薪日 ${payday} 不是慣例的次月 5 日（${conventional}）`);
  }
  return payday;
}

async function loadOptions(client: SimpanyClient, formId: number, warnings: string[]) {
  try {
    const s = await client.getSalarySetting(formId);
    return {
      options: {
        allowanceOptions: s.allowanceOptions.length ? s.allowanceOptions : DEFAULT_ALLOWANCE_OPTIONS,
        deductionOptions: s.deductionOptions.length ? s.deductionOptions : DEFAULT_DEDUCTION_OPTIONS,
      },
      minimumSalary: s.minimumSalary,
    };
  } catch (e) {
    warnings.push(`讀不到 Simpany 的薪資設定，改用已知的加減項清單：${e instanceof Error ? e.message : String(e)}`);
    return {
      options: { allowanceOptions: DEFAULT_ALLOWANCE_OPTIONS, deductionOptions: DEFAULT_DEDUCTION_OPTIONS },
      minimumSalary: null,
    };
  }
}

function resolveOwner(
  input: PrepareSalaryInput,
  template: FoundForm | null,
  form: SimpanySalaryForm,
): SalaryFilingPreview["companyOwner"] {
  const given = input.companyOwner?.trim();
  if (given) return { name: given, source: "input" };
  const fromTemplate = ownerOf(template?.form);
  if (fromTemplate) return { name: fromTemplate, source: "last_settled" };
  const fromForm = ownerOf(form);
  return fromForm ? { name: fromForm, source: "current_form" } : null;
}

function summaryLine(p: Pick<SalaryFilingPreview, "year" | "month" | "payday" | "employees" | "totals">): string {
  return [
    `${p.year}-${pad2(p.month)} 薪資`,
    `發薪日 ${p.payday}`,
    `${p.employees.length} 人`,
    `應發 ${p.totals.gross}`,
    `個人負擔 ${p.totals.personalBurden}`,
    `扣繳 ${p.totals.withholding}`,
    `實發 ${p.totals.net}`,
    `公司負擔 ${p.totals.companyInsurance}`,
  ].join("｜");
}

/** 讀這個月的表單；沒有表單或已結算就拒絕。 */
async function loadOpenForm(client: SimpanyClient, year: number, month: number): Promise<SimpanySalaryForm> {
  const form = await client.getSalaryForm(year, month);
  if (form.id == null) throw new SalaryFilingError(`Simpany 沒有 ${year}-${pad2(month)} 的薪資申報表單`);
  if (form.isSettled) {
    throw new SalaryFilingError(`${year}-${pad2(month)} 在 Simpany 已經結算，不能再修改`);
  }
  return form;
}

/** 對象裡有表單上沒有的人：規劃（allowCopy 時執行）複製。沒有缺人就原樣回傳表單。 */
async function resolveMissing(
  client: SimpanyClient,
  input: PrepareSalaryInput,
  form: SimpanySalaryForm,
  template: FoundForm | null,
  targets: Target[],
  warnings: string[],
): Promise<{ form: SimpanySalaryForm; copy: SalaryCopyPlan | null; notInSimpany: string[] }> {
  const missing = targets.map((t) => t.name).filter((n) => !form.employees.some((e) => e.name === n));
  if (missing.length === 0) return { form, copy: null, notInSimpany: [] };
  const res = await planCopy({ client, input, form, template, missing, warnings });
  return { form: res.form, copy: res.plan, notInSimpany: res.notInSimpany };
}

/** 逐一試算表單上的對象；Simpany 拒絕或資料不足的人收進 problems（不中斷其他人）。 */
async function calculateTargets(
  targets: Target[],
  form: SimpanySalaryForm,
  ctx: CalcContext,
): Promise<{ results: EmployeeCalc[]; problems: SalaryFilingPreview["problems"] }> {
  const results: EmployeeCalc[] = [];
  const problems: SalaryFilingPreview["problems"] = [];
  for (const t of targets) {
    const emp = form.employees.find((e) => e.name === t.name);
    if (!emp) continue; // 已列在 copy / notInSimpany
    try {
      results.push(await calculateEmployee(t, emp, ctx));
    } catch (e) {
      if (!(e instanceof SalaryFilingError || e instanceof SimpanyError)) throw e;
      problems.push({ name: t.name, message: e.message });
    }
  }
  return { results, problems };
}

/** 寫入時才會生效的變更（負責人旗標、發薪日）先警示。 */
function pushApplyWarnings(
  warnings: string[],
  results: EmployeeCalc[],
  owner: SalaryFilingPreview["companyOwner"],
  currentPayday: string | null,
  payday: string,
): void {
  if (results.some((r) => r.preview.ownerFlagChange)) {
    warnings.push(
      `負責人旗標會在寫入時修正（負責人：${owner?.name}）。預覽金額是以 Simpany 目前的旗標試算的；寫入後會讀回來比對實發。`,
    );
  }
  if (currentPayday && currentPayday !== payday) {
    warnings.push(`Simpany 目前的發薪日是 ${currentPayday}，寫入時會改成 ${payday}（Simpany 可能依發薪日調整健保級距，寫入後會比對實發）`);
  }
}

function sumTotals(emps: SalaryFilingEmployeePreview[]): SalaryFilingPreview["totals"] {
  return {
    gross: sum(emps.map((e) => e.gross)),
    personalBurden: sum(emps.map((e) => e.personalBurden)),
    companyInsurance: sum(emps.map((e) => e.companyInsurance)),
    withholding: sum(emps.map((e) => e.withholding)),
    net: sum(emps.map((e) => e.net ?? 0)),
  };
}

/** 存草稿：每份要 PUT 的 body 原樣 + 預覽，2 小時過期。 */
async function saveDraft(d: {
  orgId: string;
  userId: string | null;
  formId: number;
  payday: string;
  owner: SalaryFilingPreview["companyOwner"];
  results: EmployeeCalc[];
  base: Omit<SalaryFilingPreview, "draftId" | "expiresAt">;
}): Promise<{ draftId: number; expiresAt: string }> {
  const expiresAt = new Date(Date.now() + DRAFT_TTL_MS).toISOString();
  const [draft] = await getDb()
    .insert(simpanySalaryDrafts)
    .values({
      organizationId: d.orgId,
      year: d.base.year,
      month: d.base.month,
      simpanyFormId: d.formId,
      payday: d.payday,
      payload: {
        companyOwner: d.owner?.name ?? null,
        declarations: d.results.map((r) => ({
          declarationId: r.preview.declarationId,
          simpanyEmployeeId: r.preview.simpanyEmployeeId,
          name: r.preview.name,
          isCompanyOwner: r.preview.isCompanyOwner,
          ownerFlagChange: r.preview.ownerFlagChange,
          expectedNet: r.preview.net,
          body: r.body,
        })),
      },
      summary: { expiresAt, ...d.base } as unknown as Record<string, unknown>,
      status: "pending",
      createdByUserId: d.userId,
      expiresAt,
    })
    .returning({ id: simpanySalaryDrafts.id });
  return { draftId: draft.id, expiresAt };
}

/**
 * 準備某個月的薪資申報：讀 Simpany、試算、存草稿，回傳預覽。
 * 會對 Simpany 發：GET（表單、明細、設定）與 POST calculate（試算，不存檔）；
 * allowCopy 時另外 POST copy（寫入）。**不會存檔申報明細、不會結算。**
 * 注意：GET form?year&month 對還沒建立的月份會由 Simpany 自動建立空白表單（它的介面也是這樣）。
 */
export async function prepareSalaryFiling(
  orgId: string,
  userId: string | null,
  input: PrepareSalaryInput,
  clientArg?: SimpanyClient,
): Promise<SalaryFilingPreview> {
  assertYearMonth(input.year, input.month);
  const warnings: string[] = [];
  const payday = resolvePayday(input, warnings);
  const { start: monthStart, end: monthEnd } = monthRange(input.year, input.month);
  const client = clientArg ?? (await getSimpanyClient(orgId));

  const openForm = await loadOpenForm(client, input.year, input.month);
  const restriction = openForm.monthSequenceRestriction;
  if (restriction) warnings.push(restrictionText(restriction));

  const internal = await loadInternalEmployees(orgId);
  const template = await findLatestSettledForm(client, input.year, input.month, null);
  const targets = input.employees?.length
    ? explicitTargets(input.employees, internal)
    : defaultTargets(openForm, template?.form ?? null, internal, monthStart);
  if (targets.length === 0) throw new SalaryFilingError("沒有要申報的員工");

  // 表單缺人 → 複製計畫（複製計畫與找不到的人放在 copy / notInSimpany 欄位，不重複塞進 warnings）
  const { form, copy, notInSimpany } = await resolveMissing(client, input, openForm, template, targets, warnings);
  const formId = form.id as number;

  const { options, minimumSalary } = await loadOptions(client, formId, warnings);
  const owner = resolveOwner(input, template, form);
  if (!owner) warnings.push("找不到負責人：Simpany 上沒有任何人被標為負責人，請確認");
  const ctx: CalcContext = {
    client,
    formId,
    year: input.year,
    month: input.month,
    options,
    minimumSalary,
    templateByName: new Map(template?.form.employees.map((e) => [e.name, e]) ?? []),
    ownerName: owner?.name ?? null,
    monthStart,
    monthEnd,
    warnings,
  };

  const { results, problems } = await calculateTargets(targets, form, ctx);
  pushApplyWarnings(warnings, results, owner, form.payday, payday);

  const emps = results.map((r) => r.preview);
  const totals = sumTotals(emps);
  const base = {
    year: input.year,
    month: input.month,
    formId,
    payday,
    currentPayday: form.payday,
    canSettle: form.canSettle,
    sequenceRestriction: restriction,
    companyOwner: owner,
    copy,
    notInSimpany,
    problems,
    employees: emps,
    totals,
    warnings,
    summary: summaryLine({ year: input.year, month: input.month, payday, employees: emps, totals }),
  };

  const blocked = problems.length > 0 || (copy?.required && !copy.performed) || results.length === 0;
  if (blocked) return { draftId: null, expiresAt: null, ...base };

  const saved = await saveDraft({ orgId, userId, formId, payday, owner, results, base });
  return { draftId: saved.draftId, expiresAt: saved.expiresAt, ...base };
}

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------

type DraftDeclaration = {
  declarationId: number;
  simpanyEmployeeId: number;
  name: string;
  isCompanyOwner: boolean;
  ownerFlagChange: boolean;
  expectedNet: number | null;
  body: SimpanySalaryDeclarationPayload;
};

function parseDraftDeclarations(payload: Record<string, unknown>): DraftDeclaration[] | null {
  const list = payload.declarations;
  if (!Array.isArray(list) || list.length === 0) return null;
  const out: DraftDeclaration[] = [];
  for (const d of list) {
    if (!d || typeof d !== "object") return null;
    const x = d as Record<string, unknown>;
    if (typeof x.declarationId !== "number" || typeof x.name !== "string") return null;
    if (!x.body || typeof x.body !== "object") return null;
    out.push({
      declarationId: x.declarationId,
      simpanyEmployeeId: Number(x.simpanyEmployeeId),
      name: x.name,
      isCompanyOwner: x.isCompanyOwner === true,
      ownerFlagChange: x.ownerFlagChange === true,
      expectedNet: typeof x.expectedNet === "number" ? x.expectedNet : null,
      body: x.body as SimpanySalaryDeclarationPayload,
    });
  }
  return out;
}

async function explainUnavailableDraft(orgId: string, draftId: number): Promise<never> {
  const [d] = await getDb()
    .select({ status: simpanySalaryDrafts.status, expiresAt: simpanySalaryDrafts.expiresAt })
    .from(simpanySalaryDrafts)
    .where(and(eq(simpanySalaryDrafts.organizationId, orgId), eq(simpanySalaryDrafts.id, draftId)))
    .limit(1);
  if (!d) throw new SalaryFilingError(`找不到薪資申報草稿 #${draftId}`);
  if (d.status === "applied") {
    throw new SalaryFilingError(`草稿 #${draftId} 已經寫入 Simpany 了；要改內容請重新準備，確認無誤就可以送出結算`);
  }
  if (d.status === "settled") throw new SalaryFilingError(`草稿 #${draftId} 的月份已經結算`);
  if (d.status === "cancelled") throw new SalaryFilingError(`草稿 #${draftId} 已取消，請重新準備`);
  if (d.status === "pending" && new Date(d.expiresAt).getTime() <= Date.now()) {
    await getDb()
      .update(simpanySalaryDrafts)
      .set({ status: "expired" })
      .where(and(eq(simpanySalaryDrafts.id, draftId), eq(simpanySalaryDrafts.status, "pending")));
  }
  throw new SalaryFilingError(`草稿 #${draftId} 已過期（2 小時），請重新準備`);
}

async function setDraft(draftId: number, set: Partial<typeof simpanySalaryDrafts.$inferInsert>): Promise<void> {
  await getDb().update(simpanySalaryDrafts).set(set).where(eq(simpanySalaryDrafts.id, draftId));
}

export type SalaryApplyResult = {
  draftId: number;
  year: number;
  month: number;
  formId: number;
  payday: string;
  written: string[];
  ownerFlagsChanged: { name: string; isCompanyOwner: boolean }[];
  paydayChanged: boolean;
  paydayAdjustments: unknown;
  verification: { name: string; expectedNet: number | null; actualNet: number | null; ok: boolean }[];
  verified: boolean;
  canSettle: boolean | null;
  sequenceRestriction: SimpanyMonthSequenceRestriction | null;
  sync: { ok: true; declarationsUpserted: number } | { ok: false; error: string };
};

type ApplyProgress = {
  step: "precheck" | "owner" | "payday" | "declarations";
  written: string[];
  ownerFlagsChanged: SalaryApplyResult["ownerFlagsChanged"];
  paydayChanged: boolean;
  paydayAdjustments: unknown;
};

/** 草稿已經不適用的原因（表單已結算、換了表單、申報明細不見）；還能寫入回 null。 */
function staleFormReason(form: SimpanySalaryForm, formId: number, decls: DraftDeclaration[]): string | null {
  if (form.isSettled) return "這個月在 Simpany 已經結算";
  if (form.id !== formId) return "Simpany 上這個月的表單已經換了";
  const gone = decls.filter((d) => !form.employees.some((e) => e.declaration?.id === d.declarationId));
  return gone.length ? `表單上已經沒有 ${gone.map((d) => d.name).join("、")} 的申報明細` : null;
}

/** 寫入前再確認一次：表單沒被結算、沒換表單、每份申報明細都還在。不符就取消草稿。 */
async function precheckForm(
  client: SimpanyClient,
  draftId: number,
  row: { year: number; month: number; simpanyFormId: number },
  decls: DraftDeclaration[],
): Promise<SimpanySalaryForm> {
  const form = await client.getSalaryForm(row.year, row.month);
  const reason = staleFormReason(form, row.simpanyFormId, decls);
  if (reason) {
    await setDraft(draftId, { status: "cancelled", appliedAt: null, applyResult: { error: reason } });
    throw new SalaryFilingError(`${reason}，草稿 #${draftId} 已取消，請重新準備`);
  }
  return form;
}

async function writeDraft(
  client: SimpanyClient,
  form: SimpanySalaryForm,
  payday: string,
  decls: DraftDeclaration[],
  p: ApplyProgress,
): Promise<void> {
  const formId = form.id as number;
  // 負責人旗標與發薪日是 Simpany 試算的輸入，先設好再寫申報明細。
  p.step = "owner";
  for (const d of decls) {
    const current = form.employees.find((e) => e.declaration?.id === d.declarationId)?.declaration?.isCompanyOwner;
    if (current === d.isCompanyOwner) continue;
    await client.setSalaryCompanyOwner(formId, d.declarationId, d.isCompanyOwner);
    p.ownerFlagsChanged.push({ name: d.name, isCompanyOwner: d.isCompanyOwner });
  }
  p.step = "payday";
  if (form.payday !== payday) {
    p.paydayAdjustments = await client.setSalaryPayday(formId, payday);
    p.paydayChanged = true;
  }
  p.step = "declarations";
  for (const d of decls) {
    await client.updateSalaryDeclaration(formId, d.declarationId, d.body);
    p.written.push(d.name);
  }
}

const STEP_LABEL: Record<ApplyProgress["step"], string> = {
  precheck: "寫入前檢查",
  owner: "設定負責人",
  payday: "設定發薪日",
  declarations: "寫入申報明細",
};

/** 先搶下草稿（pending → applied）：按兩次，第二次搶不到（回 undefined）。 */
async function claimDraft(orgId: string, draftId: number) {
  const [row] = await getDb()
    .update(simpanySalaryDrafts)
    .set({ status: "applied", appliedAt: sql`now()` })
    .where(
      and(
        eq(simpanySalaryDrafts.organizationId, orgId),
        eq(simpanySalaryDrafts.id, draftId),
        eq(simpanySalaryDrafts.status, "pending"),
        gt(simpanySalaryDrafts.expiresAt, sql`now()`),
      ),
    )
    .returning();
  return row;
}

/** 取 Simpany client；拿不到（整合不可用）就把草稿放回 pending 再丟錯。 */
async function clientOrRelease(orgId: string, draftId: number): Promise<SimpanyClient> {
  try {
    return await getSimpanyClient(orgId);
  } catch (e) {
    await setDraft(draftId, { status: "pending", appliedAt: null });
    throw e;
  }
}

/** 寫入中途失敗：草稿退回 pending、記下進度，回傳列出已寫入 / 未寫入的錯誤。 */
async function recordApplyFailure(
  draftId: number,
  payday: string,
  decls: DraftDeclaration[],
  p: ApplyProgress,
  e: unknown,
): Promise<SalaryFilingError> {
  const msg = e instanceof Error ? e.message : String(e);
  const notWritten = decls.map((d) => d.name).filter((n) => !p.written.includes(n));
  await setDraft(draftId, {
    status: "pending",
    appliedAt: null,
    applyResult: {
      failedStep: p.step,
      error: msg.slice(0, 500),
      written: p.written,
      ownerFlagsChanged: p.ownerFlagsChanged,
      paydayChanged: p.paydayChanged,
    },
  });
  const ownerNames = p.ownerFlagsChanged.map((o) => o.name).join("、");
  return new SalaryFilingError(
    [
      `在「${STEP_LABEL[p.step]}」失敗：${msg}`,
      p.ownerFlagsChanged.length ? `已修正負責人旗標：${ownerNames}` : null,
      p.paydayChanged ? `已把發薪日改成 ${payday}` : null,
      `已寫入申報明細：${p.written.length ? p.written.join("、") : "（無）"}`,
      `尚未寫入：${notWritten.join("、") || "（無）"}`,
      `每一步都是覆寫式，確認原因後可以用同一份草稿 #${draftId} 重試（已退回可寫入），或重新準備。`,
    ]
      .filter(Boolean)
      .join("。"),
  );
}

/** 讀回來的每人實發 vs 預覽。 */
function verifyNets(after: SimpanySalaryForm, decls: DraftDeclaration[]): SalaryApplyResult["verification"] {
  return decls.map((d) => {
    const emp = after.employees.find((e) => e.declaration?.id === d.declarationId);
    const actualNet = emp ? summarizeDeclaration(emp.declaration?.items ?? []).netPay : null;
    const ok = actualNet != null && d.expectedNet != null && Math.abs(actualNet - d.expectedNet) < 0.5;
    return { name: d.name, expectedNet: d.expectedNet, actualNet, ok };
  });
}

/** 寫入 / 結算後重新同步這一年；失敗不影響主流程，只回報。 */
async function syncYear(orgId: string, year: number): Promise<SalaryApplyResult["sync"]> {
  try {
    const res = await syncSalaryDeclarations(orgId, year);
    return { ok: true, declarationsUpserted: res.declarationsUpserted };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * 把預覽過的草稿寫進 Simpany。**會修改 Simpany 上的薪資申報（尚未結算，仍可再改）。**
 * 只在使用者明確確認預覽之後呼叫。順序：負責人旗標 → 發薪日 → 逐一 PUT 申報明細 →
 * 讀回來比對實發 → 同步回本地。每一步都是覆寫式：失敗時草稿退回 pending，可用同一份重試。
 */
export async function applySalaryFiling(orgId: string, draftId: number): Promise<SalaryApplyResult> {
  const row = await claimDraft(orgId, draftId);
  if (!row) return explainUnavailableDraft(orgId, draftId);

  const decls = parseDraftDeclarations(row.payload);
  if (!decls) {
    await setDraft(draftId, { status: "cancelled", appliedAt: null });
    throw new SalaryFilingError(`草稿 #${draftId} 內容損毀，請重新準備`);
  }

  const client = await clientOrRelease(orgId, draftId);
  const p: ApplyProgress = {
    step: "precheck",
    written: [],
    ownerFlagsChanged: [],
    paydayChanged: false,
    paydayAdjustments: null,
  };
  let form: SimpanySalaryForm;
  try {
    form = await precheckForm(client, draftId, row, decls);
  } catch (e) {
    if (!(e instanceof SalaryFilingError)) await setDraft(draftId, { status: "pending", appliedAt: null });
    throw e;
  }
  try {
    await writeDraft(client, form, row.payday, decls, p);
  } catch (e) {
    throw await recordApplyFailure(draftId, row.payday, decls, p, e);
  }

  // ---- 讀回來比對實發 ----
  const after = await client.getSalaryForm(row.year, row.month);
  const verification = verifyNets(after, decls);
  const sync = await syncYear(orgId, row.year);
  const result: SalaryApplyResult = {
    draftId,
    year: row.year,
    month: row.month,
    formId: row.simpanyFormId,
    payday: row.payday,
    written: p.written,
    ownerFlagsChanged: p.ownerFlagsChanged,
    paydayChanged: p.paydayChanged,
    paydayAdjustments: p.paydayAdjustments,
    verification,
    verified: verification.every((v) => v.ok),
    canSettle: after.canSettle,
    sequenceRestriction: after.monthSequenceRestriction,
    sync,
  };
  await setDraft(draftId, {
    applyResult: {
      written: p.written,
      ownerFlagsChanged: p.ownerFlagsChanged,
      paydayChanged: p.paydayChanged,
      verification,
      verified: result.verified,
    },
  });
  return result;
}

/** 取消還沒寫入的草稿。 */
export async function cancelSalaryDraft(orgId: string, draftId: number): Promise<boolean> {
  const rows = await getDb()
    .update(simpanySalaryDrafts)
    .set({ status: "cancelled" })
    .where(
      and(
        eq(simpanySalaryDrafts.organizationId, orgId),
        eq(simpanySalaryDrafts.id, draftId),
        eq(simpanySalaryDrafts.status, "pending"),
      ),
    )
    .returning({ id: simpanySalaryDrafts.id });
  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// Settle
// ---------------------------------------------------------------------------

export type SettleInput = {
  year: number;
  month: number;
  confirmPayday: boolean;
  confirmOwner: boolean;
  confirmSalary: boolean;
};

export type SettleResult = {
  year: number;
  month: number;
  formId: number;
  payday: string | null;
  settled: boolean;
  employees: { name: string; isCompanyOwner: boolean; net: number | null }[];
  sync: SalaryApplyResult["sync"];
};

function isDefiniteRejection(e: unknown): e is SimpanyError {
  return (
    e instanceof SimpanyError &&
    (e.kind === "validation" || e.kind === "business" || e.kind === "auth" || e.kind === "config")
  );
}

/** 結算前的檢查：三個確認、表單狀態、順序限制、缺資料。 */
function assertSettleable(input: SettleInput, form: SimpanySalaryForm): number {
  const missing = [
    input.confirmPayday === true ? null : "發薪日正確",
    input.confirmOwner === true ? null : "負責人正確",
    input.confirmSalary === true ? null : "薪資正確",
  ].filter(Boolean);
  if (missing.length) {
    throw new SalaryFilingError(`送出結算前要確認三件事，還沒確認：${missing.join("、")}`);
  }
  const label = `${input.year}-${pad2(input.month)}`;
  if (form.id == null) throw new SalaryFilingError(`Simpany 沒有 ${label} 的薪資申報表單`);
  if (form.isSettled) throw new SalaryFilingError(`${label} 已經結算過了`);
  const filed = form.employees.filter((e) => e.declaration?.items.length);
  if (filed.length === 0) throw new SalaryFilingError(`${label} 的表單上沒有任何申報明細，不能結算`);
  const incomplete = form.employees.filter((e) => e.hasMissingSalaryData || e.hasMissingEmployeeData);
  if (incomplete.length) {
    throw new SalaryFilingError(
      `Simpany 表示這些人的資料不完整：${incomplete.map((e) => e.name).join("、")}，請先在 Simpany 補齊`,
    );
  }
  if (form.canSettle === false) {
    throw new SalaryFilingError(
      form.monthSequenceRestriction
        ? restrictionText(form.monthSequenceRestriction)
        : `Simpany 表示 ${label} 目前不能結算（canSettle = false）`,
    );
  }
  return form.id;
}

/**
 * 結算（送給記帳士）。**送出後無法從這裡撤回。** 三個確認（發薪日、負責人、薪資）都必須為 true。
 * Simpany 表示不能結算（canSettle = false，例如前面月份還沒結算）就拒絕，並回傳它給的原因。
 */
export async function settleSalaryFiling(orgId: string, input: SettleInput): Promise<SettleResult> {
  assertYearMonth(input.year, input.month);
  const client = await getSimpanyClient(orgId);
  const form = await client.getSalaryForm(input.year, input.month);
  const formId = assertSettleable(input, form);

  try {
    await client.settleSalaryForm(formId, []);
  } catch (e) {
    if (isDefiniteRejection(e)) throw e;
    const msg = e instanceof Error ? e.message : String(e);
    throw new SimpanyError(
      "http",
      `送出結算後沒有收到明確結果（${msg}）。可能已經送出：請先「從 Simpany 同步」或到 Simpany 確認這個月是否已結算，不要直接重送。`,
    );
  }

  const after = await client.getSalaryForm(input.year, input.month);
  if (after.isSettled) {
    await getDb()
      .update(simpanySalaryDrafts)
      .set({ status: "settled", settledAt: sql`now()` })
      .where(
        and(
          eq(simpanySalaryDrafts.organizationId, orgId),
          eq(simpanySalaryDrafts.year, input.year),
          eq(simpanySalaryDrafts.month, input.month),
          eq(simpanySalaryDrafts.status, "applied"),
        ),
      );
  }
  const sync = await syncYear(orgId, input.year);
  if (!after.isSettled) {
    throw new SimpanyError(
      "business",
      "Simpany 接受了結算請求，但讀回來仍顯示未結算。請到 Simpany 確認，不要直接重送。",
    );
  }
  return {
    year: input.year,
    month: input.month,
    formId,
    payday: after.payday,
    settled: after.isSettled,
    employees: after.employees
      .filter((e) => e.declaration?.items.length)
      .map((e) => ({
        name: e.name,
        isCompanyOwner: e.declaration?.isCompanyOwner ?? false,
        net: summarizeDeclaration(e.declaration?.items ?? []).netPay,
      })),
    sync,
  };
}

// ---------------------------------------------------------------------------
// Payslips
// ---------------------------------------------------------------------------

export type SendPayslipsInput = {
  year: number;
  month: number;
  /** 只寄給這些人（姓名要和 Simpany 上的一樣）；沒給 = 整張表單。 */
  employeeNames?: string[];
  /** 信件內容；預設 Simpany 的預設文字。 */
  mailContent?: string;
};

export type SendPayslipsResult = {
  year: number;
  month: number;
  mode: "COMPANY_SALARY_DECLARATION_FORM" | "SALARY_DECLARATIONS";
  recipients: { name: string; payslipSentAt: string | null }[];
};

/** 寄薪資單的 body 與收件人：有指定姓名就只寄那些人的申報明細，否則整張表單。 */
function payslipRequest(
  form: SimpanySalaryForm,
  names: string[],
  label: string,
  mailContent: string,
): { body: SimpanyPayslipSendBody; recipients: string[] } {
  if (names.length === 0) {
    return {
      body: { mode: "COMPANY_SALARY_DECLARATION_FORM", mailContent },
      recipients: form.employees.filter((e) => e.declaration?.items.length).map((e) => e.name),
    };
  }
  const ids: number[] = [];
  const unknown: string[] = [];
  for (const n of names) {
    const id = form.employees.find((e) => e.name === n)?.declaration?.id;
    if (id == null) unknown.push(n);
    else ids.push(id);
  }
  if (unknown.length) throw new SalaryFilingError(`${label} 的表單上沒有這些人的申報明細：${unknown.join("、")}`);
  return { body: { mode: "SALARY_DECLARATIONS", salaryDeclarationIds: ids, mailContent }, recipients: names };
}

/** 讀表單；失敗回 null（只用來補充結果，不影響主流程）。 */
async function formOrNull(client: SimpanyClient, year: number, month: number): Promise<SimpanySalaryForm | null> {
  try {
    return await client.getSalaryForm(year, month);
  } catch {
    return null;
  }
}

/** 寄薪資單給員工（Simpany 寄信，附加密 PDF）。只能寄已結算的月份。 */
export async function sendPayslips(orgId: string, input: SendPayslipsInput): Promise<SendPayslipsResult> {
  assertYearMonth(input.year, input.month);
  const label = `${input.year}-${pad2(input.month)}`;
  const client = await getSimpanyClient(orgId);
  const form = await client.getSalaryForm(input.year, input.month);
  if (form.id == null) throw new SalaryFilingError(`Simpany 沒有 ${label} 的薪資申報表單`);
  if (!form.isSettled) throw new SalaryFilingError(`${label} 還沒結算，結算後才能寄薪資單`);
  const payday = form.payday ?? defaultSalaryPayday(input.year, input.month);
  const mailContent = input.mailContent?.trim() || defaultPayslipMail(input.year, input.month, payday);

  const names = (input.employeeNames ?? []).map((n) => n.trim()).filter(Boolean);
  const req = payslipRequest(form, names, label, mailContent);
  try {
    await client.sendSalaryPayslips(form.id, req.body);
  } catch (e) {
    if (e instanceof SimpanyError && e.status === 404) {
      throw new SalaryFilingError("Simpany 的薪資單還在產生中（結算後需要一點時間），請稍後再寄");
    }
    throw e;
  }

  const after = await formOrNull(client, input.year, input.month);
  return {
    year: input.year,
    month: input.month,
    mode: req.body.mode,
    recipients: req.recipients.map((n) => ({
      name: n,
      payslipSentAt: after?.employees.find((e) => e.name === n)?.payslipSentAt ?? null,
    })),
  };
}

// ---------------------------------------------------------------------------
// Web defaults（只讀本地表，不打 Simpany）
// ---------------------------------------------------------------------------

export type SalaryFilingDefaults = {
  year: number;
  month: number;
  payday: string;
  lastFiled: { year: number; month: number } | null;
  employees: {
    name: string;
    employeeId: number | null;
    baseSalary: number | null;
    baseSource: "employee" | "last_filed" | null;
    isCompanyOwner: boolean;
  }[];
  latestDraft: {
    id: number;
    status: string;
    createdAt: string;
    expiresAt: string;
    appliedAt: string | null;
    summary: Record<string, unknown>;
    applyResult: Record<string, unknown>;
  } | null;
};

/** 本系統員工是否在這個月在職、而且是要申報薪資的類型（正職 / 兼職）。 */
function employedInMonth(e: InternalEmployee, start: string, end: string): boolean {
  if (!e.isActive && !e.endDate) return false;
  if (e.employmentType !== "full_time" && e.employmentType !== "part_time") return false;
  if (e.startDate && e.startDate > end) return false;
  return !(e.endDate && e.endDate < start);
}

/** 本地同步表裡、這個月（含）以前有申報的列，新的在前。 */
async function loadFiledRows(orgId: string, year: number, month: number) {
  return getDb()
    .select({
      year: simpanySalaryDeclarations.year,
      month: simpanySalaryDeclarations.month,
      name: simpanySalaryDeclarations.employeeName,
      employeeId: simpanySalaryDeclarations.employeeId,
      baseSalary: simpanySalaryDeclarations.baseSalary,
      isCompanyOwner: simpanySalaryDeclarations.isCompanyOwner,
    })
    .from(simpanySalaryDeclarations)
    .where(
      and(
        eq(simpanySalaryDeclarations.organizationId, orgId),
        eq(simpanySalaryDeclarations.filed, true),
        or(
          sql`${simpanySalaryDeclarations.year} < ${year}`,
          and(eq(simpanySalaryDeclarations.year, year), lte(simpanySalaryDeclarations.month, month)),
        ),
      ),
    )
    .orderBy(desc(simpanySalaryDeclarations.year), desc(simpanySalaryDeclarations.month));
}

type FiledRow = Awaited<ReturnType<typeof loadFiledRows>>[number];
type DefaultEmployee = SalaryFilingDefaults["employees"][number];

function baseSourceOf(fromEmp: number | null, last: number | null): DefaultEmployee["baseSource"] {
  if (fromEmp != null) return "employee";
  return last == null ? null : "last_filed";
}

/** 上次申報的人（排除已離職）+ 這個月在職、有本薪的正職 / 兼職。 */
function defaultEmployees(
  lastRows: FiledRow[],
  internal: InternalEmployee[],
  start: string,
  end: string,
): DefaultEmployee[] {
  const byName = byUniqueName(internal);
  const out: DefaultEmployee[] = [];
  const seen = new Set<string>();
  for (const r of lastRows) {
    const byId = r.employeeId == null ? null : internal.find((e) => e.id === r.employeeId);
    const emp = byId ?? byName.get(r.name) ?? null;
    if (emp?.endDate && emp.endDate < start) continue;
    const fromEmp = positiveNumber(emp?.baseSalary);
    const last = positiveNumber(r.baseSalary);
    out.push({
      name: r.name,
      employeeId: emp?.id ?? null,
      baseSalary: fromEmp ?? last,
      baseSource: baseSourceOf(fromEmp, last),
      isCompanyOwner: r.isCompanyOwner,
    });
    seen.add(r.name.trim());
  }
  for (const e of internal) {
    if (seen.has(e.name.trim()) || !employedInMonth(e, start, end)) continue;
    const base = positiveNumber(e.baseSalary);
    if (base == null) continue;
    out.push({ name: e.name.trim(), employeeId: e.id, baseSalary: base, baseSource: "employee", isCompanyOwner: false });
  }
  return out;
}

/** 這個月最新一份還有效的草稿（過期的 pending 不算）。 */
async function latestLiveDraft(orgId: string, year: number, month: number): Promise<SalaryFilingDefaults["latestDraft"]> {
  const [draft] = await getDb()
    .select({
      id: simpanySalaryDrafts.id,
      status: simpanySalaryDrafts.status,
      createdAt: simpanySalaryDrafts.createdAt,
      expiresAt: simpanySalaryDrafts.expiresAt,
      appliedAt: simpanySalaryDrafts.appliedAt,
      summary: simpanySalaryDrafts.summary,
      applyResult: simpanySalaryDrafts.applyResult,
    })
    .from(simpanySalaryDrafts)
    .where(
      and(
        eq(simpanySalaryDrafts.organizationId, orgId),
        eq(simpanySalaryDrafts.year, year),
        eq(simpanySalaryDrafts.month, month),
        inArray(simpanySalaryDrafts.status, ["pending", "applied", "settled"]),
      ),
    )
    .orderBy(desc(simpanySalaryDrafts.createdAt))
    .limit(1);
  if (!draft) return null;
  const expiredPending = draft.status === "pending" && new Date(draft.expiresAt).getTime() <= Date.now();
  return expiredPending ? null : draft;
}

/**
 * 「準備申報」表單的預設值：最近一個有申報的月份（本地同步表）的人 + 這個月在職的正職 / 兼職，
 * 本薪 = 員工資料的本薪，沒有就用上次申報的本薪。另附這個月最新的一份草稿（可以接著寫入 / 結算）。
 */
export async function salaryFilingDefaults(orgId: string, year: number, month: number): Promise<SalaryFilingDefaults> {
  assertYearMonth(year, month);
  const { start, end } = monthRange(year, month);
  const [internal, filedRows] = await Promise.all([
    loadInternalEmployees(orgId),
    loadFiledRows(orgId, year, month),
  ]);
  const top = filedRows[0];
  const lastFiled = top ? { year: top.year, month: top.month } : null;
  const lastRows = top ? filedRows.filter((r) => r.year === top.year && r.month === top.month) : [];

  return {
    year,
    month,
    payday: defaultSalaryPayday(year, month),
    lastFiled,
    employees: defaultEmployees(lastRows, internal, start, end),
    latestDraft: await latestLiveDraft(orgId, year, month),
  };
}

/** 今天（台北）所在的年月 —— 預設只讓人準備「本月以前」的薪資。 */
export function currentYearMonth(): { year: number; month: number } {
  const t = taipeiDate();
  return { year: Number(t.slice(0, 4)), month: Number(t.slice(5, 7)) };
}

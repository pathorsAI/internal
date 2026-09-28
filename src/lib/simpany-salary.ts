import { and, eq, gte, inArray, isNull, lte, notInArray, or, sql } from "drizzle-orm";
import { getDb } from "@/db";
import {
  bankAccounts,
  categories,
  employees,
  parties,
  payrollRuns,
  payslips,
  simpanySalaryDeclarations,
  simpanySalaryForms,
  transactions,
  type SimpanySalaryItem,
} from "@/db/schema";
import {
  getSimpanyClient,
  type SimpanySalaryDeclarationItem,
  type SimpanySalaryForm,
  type SimpanySalaryMonthlyForm,
} from "@/lib/integrations/simpany";
import { taipeiDate } from "@/lib/simpany-sync";

/**
 * Simpany 薪資申報（migrations/0027）：唯讀同步 + 欠薪對帳。
 *
 * - 同步：GET monthly-forms/{year} 拿 12 格，有表單的月份再 GET form?year&month，
 *   寫進 simpany_salary_forms（月份層級）與 simpany_salary_declarations（員工 × 月）。
 *   冪等：以唯一鍵 upsert，Simpany 上已不存在的員工 / 表單會從本地刪掉。
 * - 對帳：申報的「實際發薪」= 應發；本系統記的薪資（payslips + 薪資費用交易）= 已發；
 *   已發先對到它明確所屬的月份（payslip 的期別），其餘依日期先進先出補最舊的欠款。
 *
 * ⚠️ 個資：Simpany 的回應在 src/lib/integrations/simpany.ts 解析時就丟掉身分證字號、地址、國籍，
 * 這裡碰得到的只有姓名、Simpany 員工 id、金額、日期、旗標。
 */

export const SALARY_CATEGORY_NAME = "薪資費用";

// ---------------------------------------------------------------------------
// Declaration items → fields
// ---------------------------------------------------------------------------

export type DeclarationSummary = {
  baseSalary: number | null;
  bonus: number | null;
  grossDeclared: number | null;
  netPay: number | null;
  laborInsPersonal: number | null;
  healthInsPersonal: number | null;
  laborInsCompany: number | null;
  healthInsCompany: number | null;
  employmentInsCompany: number | null;
};

const norm = (s: string) => s.replaceAll(/\s+/g, "");

function pick(
  items: SimpanySalaryDeclarationItem[],
  pred: (name: string, type: string) => boolean,
): number | null {
  const hit = items.find((it) => pred(norm(it.name), it.type.toUpperCase()));
  return hit ? hit.amount : null;
}

/** 從 Simpany 的 salaryDeclarationItems 抽出我們要的金額；找不到的欄位是 null。 */
export function summarizeDeclaration(items: SimpanySalaryDeclarationItem[]): DeclarationSummary {
  const notRange = (type: string) => type !== "INSURANCE_RANGE" && type !== "PAYSLIP_SUMMARY";
  const bonusSummary = pick(items, (n, t) => t === "PAYSLIP_SUMMARY" && n === "非經常性薪資給付總額");
  const bonusItems = items.filter(
    (it) => it.type.toUpperCase() === "ALLOWANCE" && /非經常性|獎金/.test(norm(it.name)),
  );
  return {
    baseSalary:
      pick(items, (n, t) => t === "ALLOWANCE" && n === "本薪") ??
      pick(items, (n, t) => t === "PAYSLIP_SUMMARY" && n === "本薪小計"),
    bonus:
      bonusSummary ??
      (bonusItems.length ? bonusItems.reduce((s, it) => s + it.amount, 0) : null),
    grossDeclared: pick(items, (n, t) => t === "PAYSLIP_SUMMARY" && n === "實際申報薪資"),
    netPay: pick(items, (n, t) => t === "PAYSLIP_SUMMARY" && n === "實際發薪"),
    laborInsPersonal: pick(items, (n, t) => notRange(t) && n.includes("勞保") && n.includes("個人")),
    healthInsPersonal: pick(items, (n, t) => notRange(t) && n.includes("健保") && n.includes("個人")),
    laborInsCompany: pick(
      items,
      (n, t) => notRange(t) && n.includes("勞保") && n.includes("公司") && !n.includes("就業"),
    ),
    healthInsCompany: pick(items, (n, t) => notRange(t) && n.includes("健保") && n.includes("公司")),
    employmentInsCompany: pick(
      items,
      (n, t) => notRange(t) && n.includes("就業保險") && n.includes("公司"),
    ),
  };
}

export type SalaryMonthStatus = "not_synced" | "missing" | "empty" | "draft" | "settled";

function monthStatus(formId: number | null, filedCount: number, isSettled: boolean): SalaryMonthStatus {
  if (formId == null) return "missing";
  if (filedCount === 0) return "empty";
  return isSettled ? "settled" : "draft";
}

// ---------------------------------------------------------------------------
// Live read (MCP simpany_list_salary_declarations)
// ---------------------------------------------------------------------------

export type LiveSalaryEmployee = {
  simpanyEmployeeId: number;
  name: string;
  isCompanyOwner: boolean;
  filed: boolean;
  payslipSentAt: string | null;
  hasMissingSalaryData: boolean | null;
  payStartDate: string | null;
  payEndDate: string | null;
  laborInsuranceStartDate: string | null;
  laborInsuranceEndDate: string | null;
  items: SimpanySalaryItem[];
} & DeclarationSummary;

export type LiveSalaryMonth = {
  month: number;
  status: SalaryMonthStatus;
  formId: number | null;
  payday: string | null;
  isSettled: boolean | null;
  employeeCount: number;
  employees: LiveSalaryEmployee[] | null;
  employeeNames: string[];
};

function liveEmployees(form: SimpanySalaryForm): LiveSalaryEmployee[] {
  return form.employees.map((e) => {
    const d = e.declaration;
    const items = d?.items ?? [];
    return {
      simpanyEmployeeId: e.id,
      name: e.name,
      isCompanyOwner: d?.isCompanyOwner ?? false,
      filed: items.length > 0,
      payslipSentAt: e.payslipSentAt,
      hasMissingSalaryData: e.hasMissingSalaryData,
      payStartDate: d?.payStartDate ?? null,
      payEndDate: d?.payEndDate ?? null,
      laborInsuranceStartDate: d?.laborInsuranceStartDate ?? null,
      laborInsuranceEndDate: d?.laborInsuranceEndDate ?? null,
      items: items.map((it) => ({ name: it.name, type: it.type, amount: it.amount })),
      ...summarizeDeclaration(items),
    };
  });
}

/**
 * 直接向 Simpany 讀（不寫 DB）。沒給 month：整年 12 格，有表單的月份附明細；
 * 給 month：只讀那個月。明細都已去識別化（沒有身分證字號 / 地址 / 國籍）。
 */
export async function listSalaryDeclarationsLive(
  orgId: string,
  year: number,
  month?: number,
): Promise<{ year: number; months: LiveSalaryMonth[] }> {
  const client = await getSimpanyClient(orgId);
  const monthly = await client.listSalaryMonthlyForms(year);
  const targets = month ? monthly.filter((m) => m.month === month) : monthly;
  const months: LiveSalaryMonth[] = [];
  for (const m of targets) {
    if (m.id == null) {
      months.push({
        month: m.month,
        status: "missing",
        formId: null,
        payday: null,
        isSettled: null,
        employeeCount: m.employees.length,
        employees: null,
        employeeNames: m.employees.map((e) => e.name),
      });
      continue;
    }
    const form = await client.getSalaryForm(year, m.month);
    const emps = liveEmployees(form);
    months.push({
      month: m.month,
      status: monthStatus(form.id ?? m.id, emps.filter((e) => e.filed).length, form.isSettled),
      formId: form.id ?? m.id,
      payday: form.payday,
      isSettled: form.isSettled,
      employeeCount: emps.length,
      employees: emps,
      employeeNames: emps.map((e) => e.name),
    });
  }
  if (month && months.length === 0) {
    months.push({
      month,
      status: "missing",
      formId: null,
      payday: null,
      isSettled: null,
      employeeCount: 0,
      employees: null,
      employeeNames: [],
    });
  }
  return { year, months };
}

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

export type SalarySyncResult = {
  year: number;
  months: {
    month: number;
    status: SalaryMonthStatus;
    formId: number | null;
    payday: string | null;
    employeeCount: number;
    filedCount: number;
  }[];
  declarationsUpserted: number;
  declarationsRemoved: number;
  /** Simpany 上的員工姓名在本系統員工名冊裡找不到（或重名）的 —— 對帳仍會用姓名比對對象。 */
  unmatchedNames: string[];
};

const money = (n: number | null) => (n == null ? null : String(n));

/**
 * 把一整年的 Simpany 薪資申報拉進本地表。冪等：同一年跑幾次結果都一樣；Simpany 上刪掉的
 * 表單 / 員工會在本地一併刪掉。只寫本組織的 simpany_salary_* 表，不會寫 Simpany。
 */
export async function syncSalaryDeclarations(orgId: string, year: number): Promise<SalarySyncResult> {
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new Error(`不合法的年份：${year}`);
  const db = getDb();
  const client = await getSimpanyClient(orgId);
  const monthly = await client.listSalaryMonthlyForms(year);
  const byMonth = new Map<number, SimpanySalaryMonthlyForm>(monthly.map((m) => [m.month, m]));

  const forms = new Map<number, SimpanySalaryForm>();
  for (const m of monthly) {
    if (m.id != null) forms.set(m.month, await client.getSalaryForm(year, m.month));
  }

  // 本系統員工：同組織、姓名完全相同才綁；重名就不綁。
  const emps = await db
    .select({ id: employees.id, name: employees.name })
    .from(employees)
    .where(and(eq(employees.organizationId, orgId), isNull(employees.deletedAt)));
  const nameToId = new Map<string, number | null>();
  for (const e of emps) {
    const k = e.name.trim();
    nameToId.set(k, nameToId.has(k) ? null : e.id);
  }

  const now = new Date().toISOString();
  const result: SalarySyncResult = {
    year,
    months: [],
    declarationsUpserted: 0,
    declarationsRemoved: 0,
    unmatchedNames: [],
  };
  const unmatched = new Set<string>();

  for (let month = 1; month <= 12; month++) {
    const entry = byMonth.get(month);
    const form = forms.get(month);
    const formId = form?.id ?? entry?.id ?? null;
    const rows = (form?.employees ?? []).map((e) => {
      const items = e.declaration?.items ?? [];
      const s = summarizeDeclaration(items);
      const employeeId = nameToId.get(e.name) ?? null;
      if (employeeId == null) unmatched.add(e.name);
      return {
        organizationId: orgId,
        year,
        month,
        simpanyFormId: formId,
        payday: form?.payday ?? e.declaration?.payday ?? null,
        isSettled: form?.isSettled ?? false,
        simpanyEmployeeId: e.id,
        employeeName: e.name,
        employeeId,
        isCompanyOwner: e.declaration?.isCompanyOwner ?? false,
        baseSalary: money(s.baseSalary),
        bonus: money(s.bonus),
        grossDeclared: money(s.grossDeclared),
        netPay: money(s.netPay),
        laborInsPersonal: money(s.laborInsPersonal),
        healthInsPersonal: money(s.healthInsPersonal),
        laborInsCompany: money(s.laborInsCompany),
        healthInsCompany: money(s.healthInsCompany),
        employmentInsCompany: money(s.employmentInsCompany),
        items: items.map((it) => ({ name: it.name, type: it.type, amount: it.amount })),
        filed: items.length > 0,
        syncedAt: now,
      };
    });
    const filedCount = rows.filter((r) => r.filed).length;
    const employeeCount = form ? rows.length : (entry?.employees.length ?? 0);
    const isSettled = form?.isSettled ?? false;
    const payday = form?.payday ?? null;

    await db
      .insert(simpanySalaryForms)
      .values({
        organizationId: orgId,
        year,
        month,
        simpanyFormId: formId,
        payday,
        isSettled,
        employeeCount,
        filedCount,
        syncedAt: now,
      })
      .onConflictDoUpdate({
        target: [simpanySalaryForms.organizationId, simpanySalaryForms.year, simpanySalaryForms.month],
        set: { simpanyFormId: formId, payday, isSettled, employeeCount, filedCount, syncedAt: now },
      });

    if (rows.length > 0) {
      await db
        .insert(simpanySalaryDeclarations)
        .values(rows)
        .onConflictDoUpdate({
          target: [
            simpanySalaryDeclarations.organizationId,
            simpanySalaryDeclarations.year,
            simpanySalaryDeclarations.month,
            simpanySalaryDeclarations.simpanyEmployeeId,
          ],
          set: {
            simpanyFormId: sql`excluded.simpany_form_id`,
            payday: sql`excluded.payday`,
            isSettled: sql`excluded.is_settled`,
            employeeName: sql`excluded.employee_name`,
            employeeId: sql`excluded.employee_id`,
            isCompanyOwner: sql`excluded.is_company_owner`,
            baseSalary: sql`excluded.base_salary`,
            bonus: sql`excluded.bonus`,
            grossDeclared: sql`excluded.gross_declared`,
            netPay: sql`excluded.net_pay`,
            laborInsPersonal: sql`excluded.labor_ins_personal`,
            healthInsPersonal: sql`excluded.health_ins_personal`,
            laborInsCompany: sql`excluded.labor_ins_company`,
            healthInsCompany: sql`excluded.health_ins_company`,
            employmentInsCompany: sql`excluded.employment_ins_company`,
            items: sql`excluded.items`,
            filed: sql`excluded.filed`,
            syncedAt: sql`excluded.synced_at`,
          },
        });
      result.declarationsUpserted += rows.length;
    }

    // Simpany 上已不存在的（整張表單沒了、或員工被移出表單）→ 本地刪掉。
    const keep = rows.map((r) => r.simpanyEmployeeId);
    const removed = await db
      .delete(simpanySalaryDeclarations)
      .where(
        and(
          eq(simpanySalaryDeclarations.organizationId, orgId),
          eq(simpanySalaryDeclarations.year, year),
          eq(simpanySalaryDeclarations.month, month),
          keep.length ? notInArray(simpanySalaryDeclarations.simpanyEmployeeId, keep) : undefined,
        ),
      )
      .returning({ id: simpanySalaryDeclarations.id });
    result.declarationsRemoved += removed.length;

    result.months.push({
      month,
      status: monthStatus(formId, filedCount, isSettled),
      formId,
      payday,
      employeeCount,
      filedCount,
    });
  }

  result.unmatchedNames = [...unmatched].sort((a, b) => a.localeCompare(b, "zh-Hant"));
  return result;
}

// ---------------------------------------------------------------------------
// Reconciliation (reads our tables only)
// ---------------------------------------------------------------------------

export type ReconMonth = {
  month: number;
  /** 這個月 Simpany 表單的狀態（整家公司的，不是這位員工的）。 */
  formStatus: SalaryMonthStatus;
  /** 這位員工這個月有申報明細。 */
  filed: boolean;
  /** 申報的實際發薪；未申報為 null。 */
  declaredNet: number | null;
  /** true = 沒申報，應發是用 expectedMonthlyNet 估的。 */
  estimated: boolean;
  /** 應發（申報值或估計值；兩者皆無為 0）。 */
  owed: number;
  allocatedPaid: number;
  outstanding: number;
  /** 發薪日（表單的 payday，沒有就假設次月 5 日）是否已過 asOf。 */
  due: boolean;
  payday: string;
};

export type ReconPayment = {
  source: "transaction" | "payslip";
  transactionId: number | null;
  payslipId: number | null;
  date: string;
  amount: number;
  /** payslip 的期別月份（明確指定屬於哪個月）；一般交易為 null，走先進先出。 */
  periodMonth: number | null;
  accountName: string | null;
  description: string | null;
  allocations: { month: number; amount: number }[];
  /** 沒有可對的欠款，剩下的金額（預付 / 溢付）。 */
  unapplied: number;
};

export type ReconEmployee = {
  key: string;
  employeeId: number | null;
  simpanyEmployeeId: number | null;
  name: string;
  isCompanyOwner: boolean;
  expectedMonthlyNet: number | null;
  expectedSource: "override" | "latest_filed" | null;
  totalDeclaredNet: number;
  totalEstimatedNet: number;
  totalPaid: number;
  /** 已到期、已申報月份還沒付的（真正的欠薪）。 */
  arrears: number;
  /** 已到期、未申報（估計）月份還沒付的。 */
  estimatedArrears: number;
  /** 還沒到發薪日的月份未付金額。 */
  notYetDue: number;
  /** 付了但沒有欠款可對的金額。 */
  credit: number;
  months: ReconMonth[];
  payments: ReconPayment[];
};

export type UnallocatedPayment = {
  transactionId: number;
  date: string;
  amount: number;
  currency: string;
  description: string | null;
  partyName: string | null;
  accountName: string | null;
};

export type SalaryReconciliation = {
  year: number;
  throughMonth: number;
  asOf: string;
  paidFrom: string;
  paidTo: string;
  lastSyncedAt: string | null;
  months: {
    month: number;
    status: SalaryMonthStatus;
    payday: string | null;
    employeeCount: number;
    filedCount: number;
  }[];
  employees: ReconEmployee[];
  unallocatedPayments: UnallocatedPayment[];
  totals: {
    declaredNet: number;
    estimatedNet: number;
    paid: number;
    arrears: number;
    estimatedArrears: number;
    notYetDue: number;
    credit: number;
    unallocated: number;
  };
};

export type ReconOptions = {
  year: number;
  /** 對到哪個月（含）。預設：今年 = 本月；過去的年份 = 12。 */
  throughMonth?: number;
  /** 一般（沒指定期別的）薪資交易的日期範圍。預設 year-01-01 起。 */
  paidFrom?: string;
  /** 預設：今年 = 今天；過去的年份 = 隔年 1/31（涵蓋 12 月薪次月 5 日發）。 */
  paidTo?: string;
  /** 未申報的月份用 expectedMonthlyNet 估應發（標 estimated）。預設 true。 */
  estimateUnfiled?: boolean;
  /** 覆寫某位員工的每月預估實發，key = 員工姓名。 */
  expectedMonthlyNet?: Record<string, number>;
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const pad2 = (n: number) => String(n).padStart(2, "0");

function defaultPayday(year: number, month: number): string {
  return month === 12 ? `${year + 1}-01-05` : `${year}-${pad2(month + 1)}-05`;
}

/**
 * 把付款分配到各月（就地更新 months 的 allocatedPaid / outstanding 與 payments 的
 * allocations / unapplied），回傳依日期排序後的付款。
 * 1) 有明確期別（payslip）的先補那個月；2) 其餘金額（含 1 超付的部分）依付款日期先進先出，
 *    從最舊的欠款月份開始補；3) 再有剩就是 unapplied。
 */
export function allocatePayments(months: ReconMonth[], input: ReconPayment[]): ReconPayment[] {
  const payments = [...input].sort(
    (a, b) => a.date.localeCompare(b.date) || (a.transactionId ?? 0) - (b.transactionId ?? 0),
  );
  const rows = [...months].sort((a, b) => a.month - b.month);
  const remaining = new Map<ReconPayment, number>(payments.map((x) => [x, x.amount]));
  const apply = (pay: ReconPayment, row: ReconMonth) => {
    const left = remaining.get(pay) ?? 0;
    const amt = round2(Math.min(left, row.outstanding));
    if (amt <= 0) return;
    row.allocatedPaid = round2(row.allocatedPaid + amt);
    row.outstanding = round2(row.outstanding - amt);
    remaining.set(pay, round2(left - amt));
    const existing = pay.allocations.find((a) => a.month === row.month);
    if (existing) existing.amount = round2(existing.amount + amt);
    else pay.allocations.push({ month: row.month, amount: amt });
  };
  for (const pay of payments) {
    if (pay.periodMonth == null) continue;
    const row = rows.find((r) => r.month === pay.periodMonth);
    if (row) apply(pay, row);
  }
  for (const pay of payments) {
    for (const row of rows) {
      if ((remaining.get(pay) ?? 0) <= 0) break;
      apply(pay, row);
    }
  }
  for (const pay of payments) {
    pay.unapplied = round2(remaining.get(pay) ?? 0);
    pay.allocations.sort((a, b) => a.month - b.month);
  }
  return payments;
}

type DeclRow = typeof simpanySalaryDeclarations.$inferSelect;

type Person = {
  key: string;
  employeeId: number | null;
  simpanyEmployeeId: number | null;
  name: string;
  isCompanyOwner: boolean;
  startDate: string | null;
  endDate: string | null;
  decl: Map<number, DeclRow>;
  payments: ReconPayment[];
};

/**
 * 每位員工：申報的應發（實際發薪）vs 本系統記錄的已發，按月列出欠多少。
 *
 * 已發 = (1) payslips（有 paid_transaction_id 的以那筆交易為準；沒有交易、但所屬薪資批次
 *       status = paid 的以 net_pay 計）+ (2) 薪資費用分類的支出交易，對象是這位員工
 *       （settle_employee_id = 員工，或對象 party 名稱 = 員工姓名）。
 * 分配：payslip 有明確期別 → 先補那個月；其餘（含超付的部分）依日期先進先出補最舊的欠款；
 *       再有剩就是 credit。薪資費用交易對不到任何員工的 → unallocatedPayments 讓人指派。
 */
export async function salaryReconciliation(
  orgId: string,
  opts: ReconOptions,
): Promise<SalaryReconciliation> {
  const db = getDb();
  const { year } = opts;
  const today = taipeiDate();
  const thisYear = Number(today.slice(0, 4));
  const thisMonth = Number(today.slice(5, 7));
  let defaultThrough = 12;
  if (year === thisYear) defaultThrough = thisMonth;
  else if (year > thisYear) defaultThrough = 0;
  const throughMonth = Math.max(0, Math.min(12, opts.throughMonth ?? defaultThrough));
  const paidFrom = opts.paidFrom ?? `${year}-01-01`;
  const paidTo = opts.paidTo ?? (year < thisYear ? `${year + 1}-01-31` : today);
  const asOf = paidTo < today ? paidTo : today;
  const estimateUnfiled = opts.estimateUnfiled ?? true;

  // ---- load ----
  const [formRows, declRows, empRows, salaryCats] = await Promise.all([
    db
      .select()
      .from(simpanySalaryForms)
      .where(and(eq(simpanySalaryForms.organizationId, orgId), eq(simpanySalaryForms.year, year))),
    db
      .select()
      .from(simpanySalaryDeclarations)
      .where(
        and(
          eq(simpanySalaryDeclarations.organizationId, orgId),
          eq(simpanySalaryDeclarations.year, year),
        ),
      ),
    db
      .select({
        id: employees.id,
        name: employees.name,
        startDate: employees.startDate,
        endDate: employees.endDate,
        isActive: employees.isActive,
      })
      .from(employees)
      .where(and(eq(employees.organizationId, orgId), isNull(employees.deletedAt))),
    db
      .select({ id: categories.id })
      .from(categories)
      .where(
        and(
          eq(categories.organizationId, orgId),
          eq(categories.name, SALARY_CATEGORY_NAME),
          isNull(categories.deletedAt),
        ),
      ),
  ]);
  const salaryCatIds = salaryCats.map((c) => c.id);

  // 所有 payslip（跨年份，才能把「屬於別年」的交易排除掉）
  const slipRows = await db
    .select({
      id: payslips.id,
      employeeId: payslips.employeeId,
      netPay: payslips.netPay,
      paidTransactionId: payslips.paidTransactionId,
      periodYear: payrollRuns.periodYear,
      periodMonth: payrollRuns.periodMonth,
      payDate: payrollRuns.payDate,
      runStatus: payrollRuns.status,
    })
    .from(payslips)
    .innerJoin(payrollRuns, eq(payslips.payrollRunId, payrollRuns.id))
    .where(
      and(
        eq(payrollRuns.organizationId, orgId),
        isNull(payrollRuns.deletedAt),
        isNull(payslips.deletedAt),
      ),
    );
  const slipByTxn = new Map<number, (typeof slipRows)[number]>();
  for (const s of slipRows) if (s.paidTransactionId != null) slipByTxn.set(s.paidTransactionId, s);
  const thisYearSlipTxnIds = slipRows
    .filter((s) => s.periodYear === year && s.paidTransactionId != null)
    .map((s) => s.paidTransactionId as number);

  const txnSelect = {
    id: transactions.id,
    txnDate: transactions.txnDate,
    amount: transactions.amount,
    amountTwd: transactions.amountTwd,
    currency: transactions.currency,
    description: transactions.description,
    categoryId: transactions.categoryId,
    settleEmployeeId: transactions.settleEmployeeId,
    partyName: parties.name,
    accountName: bankAccounts.name,
  };
  const txnConds = [];
  if (salaryCatIds.length) {
    txnConds.push(
      and(
        inArray(transactions.categoryId, salaryCatIds),
        gte(transactions.txnDate, paidFrom),
        lte(transactions.txnDate, paidTo),
      ),
    );
  }
  if (thisYearSlipTxnIds.length) txnConds.push(inArray(transactions.id, thisYearSlipTxnIds));
  const txnRows = txnConds.length
    ? await db
        .select(txnSelect)
        .from(transactions)
        .leftJoin(parties, eq(transactions.partyId, parties.id))
        .leftJoin(bankAccounts, eq(transactions.fromAccountId, bankAccounts.id))
        .where(
          and(
            eq(transactions.organizationId, orgId),
            isNull(transactions.deletedAt),
            eq(transactions.type, "expense"),
            or(...txnConds),
          ),
        )
        .orderBy(transactions.txnDate, transactions.id)
    : [];

  // ---- people ----
  const people = new Map<string, Person>();
  const nameToKey = new Map<string, string>();
  const empById = new Map(empRows.map((e) => [e.id, e]));
  const personForEmployee = (id: number): Person => {
    const key = `e:${id}`;
    let p = people.get(key);
    if (!p) {
      const e = empById.get(id);
      p = {
        key,
        employeeId: id,
        simpanyEmployeeId: null,
        name: e?.name ?? `#${id}`,
        isCompanyOwner: false,
        startDate: e?.startDate ?? null,
        endDate: e?.endDate ?? null,
        decl: new Map(),
        payments: [],
      };
      people.set(key, p);
      if (e) nameToKey.set(e.name.trim(), key);
    }
    return p;
  };

  // 同步之後才建的員工：這裡再用姓名補綁一次（重名不綁）。
  const empNameToId = new Map<string, number | null>();
  for (const e of empRows) {
    const k = e.name.trim();
    empNameToId.set(k, empNameToId.has(k) ? null : e.id);
  }
  for (const d of declRows) {
    let p: Person;
    const employeeId = d.employeeId ?? empNameToId.get(d.employeeName.trim()) ?? null;
    if (employeeId != null) {
      p = personForEmployee(employeeId);
    } else {
      const key = `s:${d.simpanyEmployeeId}`;
      p = people.get(key) ?? {
        key,
        employeeId: null,
        simpanyEmployeeId: d.simpanyEmployeeId,
        name: d.employeeName,
        isCompanyOwner: false,
        startDate: null,
        endDate: null,
        decl: new Map(),
        payments: [],
      };
      people.set(key, p);
    }
    p.simpanyEmployeeId ??= d.simpanyEmployeeId;
    if (d.isCompanyOwner) p.isCompanyOwner = true;
    p.decl.set(d.month, d);
    if (!nameToKey.has(d.employeeName.trim())) nameToKey.set(d.employeeName.trim(), p.key);
  }
  // 本系統員工的姓名也能對上 party 名稱（即使他沒有申報）
  for (const e of empRows) {
    const k = e.name.trim();
    if (!nameToKey.has(k)) nameToKey.set(k, `e:${e.id}`);
  }
  const personByKey = (key: string): Person => {
    if (key.startsWith("e:")) return personForEmployee(Number(key.slice(2)));
    const p = people.get(key);
    if (!p) throw new Error(`unknown person ${key}`);
    return p;
  };

  // ---- payments ----
  const unallocatedPayments: UnallocatedPayment[] = [];
  for (const t of txnRows) {
    const amount = Number(t.amountTwd ?? t.amount);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const slip = slipByTxn.get(t.id);
    if (slip && slip.periodYear !== year) continue; // 別年的薪資
    let person: Person | null = null;
    if (slip) person = personForEmployee(slip.employeeId);
    else if (t.settleEmployeeId != null) person = personForEmployee(t.settleEmployeeId);
    else if (t.partyName && nameToKey.has(t.partyName.trim())) {
      person = personByKey(nameToKey.get(t.partyName.trim()) as string);
    }
    if (!person) {
      unallocatedPayments.push({
        transactionId: t.id,
        date: t.txnDate,
        amount: round2(amount),
        currency: t.amountTwd != null ? "TWD" : t.currency,
        description: t.description,
        partyName: t.partyName,
        accountName: t.accountName,
      });
      continue;
    }
    person.payments.push({
      source: "transaction",
      transactionId: t.id,
      payslipId: slip?.id ?? null,
      date: t.txnDate,
      amount: round2(amount),
      periodMonth: slip ? slip.periodMonth : null,
      accountName: t.accountName,
      description: t.description,
      allocations: [],
      unapplied: 0,
    });
  }
  // 沒有交易、但批次已標為 paid 的 payslip
  for (const s of slipRows) {
    if (s.periodYear !== year || s.paidTransactionId != null || s.runStatus !== "paid") continue;
    const amount = Number(s.netPay);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    personForEmployee(s.employeeId).payments.push({
      source: "payslip",
      transactionId: null,
      payslipId: s.id,
      date: s.payDate ?? defaultPayday(year, s.periodMonth),
      amount: round2(amount),
      periodMonth: s.periodMonth,
      accountName: null,
      description: null,
      allocations: [],
      unapplied: 0,
    });
  }

  // ---- months grid ----
  const formByMonth = new Map(formRows.map((f) => [f.month, f]));
  const monthsGrid = Array.from({ length: 12 }, (_, i) => {
    const f = formByMonth.get(i + 1);
    return {
      month: i + 1,
      status: f ? monthStatus(f.simpanyFormId, f.filedCount, f.isSettled) : ("not_synced" as const),
      payday: f?.payday ?? null,
      employeeCount: f?.employeeCount ?? 0,
      filedCount: f?.filedCount ?? 0,
    };
  });
  const lastSyncedAt = formRows.reduce<string | null>(
    (acc, f) => (acc == null || f.syncedAt > acc ? f.syncedAt : acc),
    null,
  );

  // ---- per person ----
  const result: ReconEmployee[] = [];
  for (const p of people.values()) {
    const filedMonths = [...p.decl.values()]
      .filter((d) => d.filed && d.netPay != null)
      .sort((a, b) => a.month - b.month);

    // 預估每月實發
    let expected: number | null = null;
    let expectedSource: ReconEmployee["expectedSource"] = null;
    const override = opts.expectedMonthlyNet?.[p.name];
    if (override != null && Number.isFinite(override)) {
      expected = override;
      expectedSource = "override";
    } else {
      const within = filedMonths.filter((d) => d.month <= Math.max(throughMonth, 1));
      const latest = (within.length ? within : filedMonths).at(-1);
      if (latest) {
        const net = Number(latest.netPay);
        const bonus = Number(latest.bonus ?? 0);
        expected = bonus > 0 && net - bonus > 0 ? net - bonus : net;
        expectedSource = "latest_filed";
      }
    }

    // 估計的範圍：到職月（或第一個有申報的月份）起，到離職月為止
    let firstMonth: number | null = filedMonths[0]?.month ?? null;
    if (p.startDate) {
      const sy = Number(p.startDate.slice(0, 4));
      const sm = Number(p.startDate.slice(5, 7));
      if (sy < year) firstMonth = 1;
      else if (sy === year) firstMonth = sm;
      else firstMonth = null;
    }
    let lastMonth = 12;
    if (p.endDate) {
      const ey = Number(p.endDate.slice(0, 4));
      if (ey < year) lastMonth = 0;
      else if (ey === year) lastMonth = Number(p.endDate.slice(5, 7));
    }

    const months: ReconMonth[] = [];
    for (let m = 1; m <= throughMonth; m++) {
      const d = p.decl.get(m);
      const form = formByMonth.get(m);
      const filed = Boolean(d?.filed && d.netPay != null);
      const payday = form?.payday ?? d?.payday ?? defaultPayday(year, m);
      const due = payday <= asOf;
      const declaredNet = filed ? Number(d?.netPay) : null;
      const inRange = firstMonth != null && m >= firstMonth && m <= lastMonth;
      const estimated =
        !filed && estimateUnfiled && expected != null && inRange && due;
      const owed = declaredNet ?? (estimated ? (expected as number) : 0);
      // 沒申報、也不估計，而且不在任職期間的月份就不列出來（避免一整排 0）
      if (!filed && !estimated && !inRange) continue;
      months.push({
        month: m,
        formStatus: form
          ? monthStatus(form.simpanyFormId, form.filedCount, form.isSettled)
          : "not_synced",
        filed,
        declaredNet,
        estimated,
        owed: round2(owed),
        allocatedPaid: 0,
        outstanding: round2(owed),
        due,
        payday,
      });
    }

    const payments = allocatePayments(months, p.payments);

    const sum = (xs: number[]) => round2(xs.reduce((s, x) => s + x, 0));
    const emp: ReconEmployee = {
      key: p.key,
      employeeId: p.employeeId,
      simpanyEmployeeId: p.simpanyEmployeeId,
      name: p.name,
      isCompanyOwner: p.isCompanyOwner,
      expectedMonthlyNet: expected,
      expectedSource,
      totalDeclaredNet: sum(months.map((r) => r.declaredNet ?? 0)),
      totalEstimatedNet: sum(months.filter((r) => r.estimated).map((r) => r.owed)),
      totalPaid: sum(payments.map((x) => x.amount)),
      arrears: sum(months.filter((r) => r.due && !r.estimated).map((r) => r.outstanding)),
      estimatedArrears: sum(months.filter((r) => r.estimated).map((r) => r.outstanding)),
      notYetDue: sum(months.filter((r) => !r.due).map((r) => r.outstanding)),
      credit: sum(payments.map((x) => x.unapplied)),
      months,
      payments,
    };
    // 沒有申報、沒估計、也沒有任何付款的員工不列（例如名冊上的外包）
    if (emp.months.length === 0 && emp.payments.length === 0) continue;
    result.push(emp);
  }
  result.sort(
    (a, b) =>
      b.arrears + b.estimatedArrears - (a.arrears + a.estimatedArrears) ||
      a.name.localeCompare(b.name, "zh-Hant"),
  );

  const total = (f: (e: ReconEmployee) => number) =>
    round2(result.reduce((s, e) => s + f(e), 0));
  return {
    year,
    throughMonth,
    asOf,
    paidFrom,
    paidTo,
    lastSyncedAt,
    months: monthsGrid,
    employees: result,
    unallocatedPayments,
    totals: {
      declaredNet: total((e) => e.totalDeclaredNet),
      estimatedNet: total((e) => e.totalEstimatedNet),
      paid: total((e) => e.totalPaid),
      arrears: total((e) => e.arrears),
      estimatedArrears: total((e) => e.estimatedArrears),
      notYetDue: total((e) => e.notYetDue),
      credit: total((e) => e.credit),
      unallocated: round2(unallocatedPayments.reduce((s, x) => s + x.amount, 0)),
    },
  };
}

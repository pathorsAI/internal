import { addMonths, format, isAfter, parseISO } from "date-fns";
import { sql, eq, desc, and, or, lte, inArray, isNull, aliasedTable } from "drizzle-orm";
import { getDb } from "./index";
import { nextChargeDate, todayStr } from "@/lib/mcp/shared";
import {
  transactions,
  categories,
  bankAccounts,
  invoices,
  employees,
  payrollRuns,
  payslips,
  payrollItemTypes,
  parties,
  accountReconciliations,
  documents,
  projects,
  subscriptions,
  subscriptionPeriods,
  contracts,
  activityLog,
} from "./schema";
import { oauthApplication, oauthAccessToken, member, organization } from "./auth-schema";

export type Book = "internal" | "external" | "both";

export async function getOverview(orgId: string) {
  const db = getDb();

  // 依幣別分組（不同幣別不能混加）：收入=type income，支出=type expense+advance
  const rows = await db
    .select({
      currency: transactions.currency,
      income: sql<string>`coalesce(sum(${transactions.amount}) filter (where ${transactions.type} = 'income'), 0)`,
      expense: sql<string>`coalesce(sum(${transactions.amount}) filter (where ${transactions.type} in ('expense','advance')), 0)`,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.organizationId, orgId),
        sql`${transactions.type} in ('income','expense','advance')`,
        isNull(transactions.deletedAt),
      ),
    )
    .groupBy(transactions.currency)
    .orderBy(transactions.currency);

  return rows.map((r) => {
    const income = Number(r.income);
    const expense = Number(r.expense);
    return { currency: r.currency, income, expense, net: income - expense };
  });
}

export type TxnFilters = {
  book?: Book;
  categoryId?: number;
  accountId?: number;
  projectId?: number;
  period?: string; // YYYY-MM
};

// 內外帳列表與筆數共用的 where（篩選條件的 single source of truth）
function txnWhere(orgId: string, filters: TxnFilters) {
  const { book, categoryId, accountId, projectId, period } = filters;
  return and(
    eq(transactions.organizationId, orgId),
    book ? eq(transactions.book, book) : undefined,
    categoryId ? eq(transactions.categoryId, categoryId) : undefined,
    accountId
      ? or(
          eq(transactions.fromAccountId, accountId),
          eq(transactions.toAccountId, accountId),
        )
      : undefined,
    projectId ? eq(transactions.projectId, projectId) : undefined,
    period ? sql`to_char(${transactions.txnDate}, 'YYYY-MM') = ${period}` : undefined,
    isNull(transactions.deletedAt),
  );
}

// 符合篩選條件的交易總筆數（分頁用）
export async function countTransactions(
  orgId: string,
  filters: TxnFilters = {},
): Promise<number> {
  const db = getDb();
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(transactions)
    .where(txnWhere(orgId, filters));
  return row?.count ?? 0;
}

export async function listTransactions(
  orgId: string,
  filters: TxnFilters = {},
  limit = 50,
  offset = 0,
) {
  const db = getDb();
  const fromAcct = aliasedTable(bankAccounts, "from_acct");
  const toAcct = aliasedTable(bankAccounts, "to_acct");

  const rows = await db
    .select({
      id: transactions.id,
      txnDate: transactions.txnDate,
      description: transactions.description,
      amount: transactions.amount,
      currency: transactions.currency,
      amountTwd: transactions.amountTwd,
      book: transactions.book,
      type: transactions.type,
      categoryId: transactions.categoryId,
      billedToCompanyTaxId: transactions.billedToCompanyTaxId,
      categoryName: categories.name,
      categoryKind: categories.kind,
      fromAccountId: transactions.fromAccountId,
      toAccountId: transactions.toAccountId,
      partyId: transactions.partyId,
      settleEmployeeId: transactions.settleEmployeeId,
      projectId: transactions.projectId,
      projectName: projects.name,
      contractId: transactions.contractId,
      fromAccount: fromAcct.name,
      toAccount: toAcct.name,
      partyName: parties.name,
      settleName: employees.name,
    })
    .from(transactions)
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .leftJoin(fromAcct, eq(fromAcct.id, transactions.fromAccountId))
    .leftJoin(toAcct, eq(toAcct.id, transactions.toAccountId))
    .leftJoin(parties, eq(parties.id, transactions.partyId))
    .leftJoin(employees, eq(employees.id, transactions.settleEmployeeId))
    .leftJoin(projects, eq(projects.id, transactions.projectId))
    .where(txnWhere(orgId, filters))
    .orderBy(desc(transactions.txnDate), desc(transactions.id))
    .limit(limit)
    .offset(offset);

  return rows;
}

// 有交易的年月清單（新到舊），給篩選下拉用
export async function listTransactionMonths(orgId: string): Promise<string[]> {
  const db = getDb();
  const rows = await db
    .selectDistinct({ ym: sql<string>`to_char(${transactions.txnDate}, 'YYYY-MM')`.as("ym") })
    .from(transactions)
    .where(and(eq(transactions.organizationId, orgId), isNull(transactions.deletedAt)));
  return rows
    .map((r) => r.ym)
    .filter((ym): ym is string => !!ym)
    .sort()
    .reverse();
}

// ---- 總覽頁趨勢圖表：近 N 個月的收支與各帳戶餘額走勢 ----

export type MonthlyTrends = {
  /** 視窗內的月份（YYYY-MM，由舊到新），含當月 */
  months: string[];
  /** 各幣別每月收支（全組織，口徑同 getOverview：收入=income，支出=expense+advance） */
  totals: { month: string; currency: string; income: number; expense: number }[];
  /** 各帳戶每月收支與淨流量（淨流量含轉帳，供餘額走勢累加用） */
  accountFlows: {
    month: string;
    accountId: number;
    income: number;
    expense: number;
    net: number;
  }[];
  /** 各帳戶在視窗起點前的餘額（期初餘額 + 起點前所有交易淨額） */
  startBalances: { accountId: number; balance: number }[];
};

export async function getMonthlyTrends(
  orgId: string,
  monthsBack = 12,
): Promise<MonthlyTrends> {
  const db = getDb();
  const now = new Date();
  const months = Array.from({ length: monthsBack }, (_, i) =>
    format(addMonths(now, i - (monthsBack - 1)), "yyyy-MM"),
  );
  const windowStart = `${months[0]}-01`;
  const txnMonth = sql<string>`to_char(${transactions.txnDate}, 'YYYY-MM')`;

  const [totals, accountFlows, startBalances] = await Promise.all([
    db
      .select({
        month: txnMonth.as("month"),
        currency: transactions.currency,
        income: sql<string>`coalesce(sum(${transactions.amount}) filter (where ${transactions.type} = 'income'), 0)`,
        expense: sql<string>`coalesce(sum(${transactions.amount}) filter (where ${transactions.type} in ('expense','advance')), 0)`,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.organizationId, orgId),
          sql`${transactions.txnDate} >= ${windowStart}`,
          sql`${transactions.type} in ('income','expense','advance')`,
          isNull(transactions.deletedAt),
        ),
      )
      .groupBy(sql`1`, transactions.currency),
    db
      .select({
        month: txnMonth.as("month"),
        accountId: bankAccounts.id,
        income: sql<string>`coalesce(sum(${transactions.amount}) filter (where ${transactions.toAccountId} = ${bankAccounts.id} and ${transactions.type} = 'income'), 0)`,
        expense: sql<string>`coalesce(sum(${transactions.amount}) filter (where ${transactions.fromAccountId} = ${bankAccounts.id} and ${transactions.type} in ('expense','advance')), 0)`,
        net: sql<string>`(
          coalesce(sum(${transactions.amount}) filter (where ${transactions.toAccountId} = ${bankAccounts.id}), 0)
          - coalesce(sum(${transactions.amount}) filter (where ${transactions.fromAccountId} = ${bankAccounts.id}), 0)
        )`,
      })
      .from(bankAccounts)
      .innerJoin(
        transactions,
        and(
          or(
            eq(transactions.fromAccountId, bankAccounts.id),
            eq(transactions.toAccountId, bankAccounts.id),
          ),
          isNull(transactions.deletedAt),
        ),
      )
      .where(
        and(
          eq(bankAccounts.organizationId, orgId),
          isNull(bankAccounts.deletedAt),
          sql`${transactions.txnDate} >= ${windowStart}`,
        ),
      )
      .groupBy(sql`1`, bankAccounts.id),
    db
      .select({
        accountId: bankAccounts.id,
        balance: sql<string>`(
          ${bankAccounts.openingBalance}
          + coalesce(sum(${transactions.amount}) filter (where ${transactions.toAccountId} = ${bankAccounts.id}), 0)
          - coalesce(sum(${transactions.amount}) filter (where ${transactions.fromAccountId} = ${bankAccounts.id}), 0)
        )`,
      })
      .from(bankAccounts)
      .leftJoin(
        transactions,
        and(
          or(
            eq(transactions.fromAccountId, bankAccounts.id),
            eq(transactions.toAccountId, bankAccounts.id),
          ),
          isNull(transactions.deletedAt),
          sql`${transactions.txnDate} < ${windowStart}`,
        ),
      )
      .where(and(eq(bankAccounts.organizationId, orgId), isNull(bankAccounts.deletedAt)))
      .groupBy(bankAccounts.id),
  ]);

  return {
    months,
    totals: totals.map((r) => ({
      month: r.month,
      currency: r.currency,
      income: Number(r.income),
      expense: Number(r.expense),
    })),
    accountFlows: accountFlows.map((r) => ({
      month: r.month,
      accountId: r.accountId,
      income: Number(r.income),
      expense: Number(r.expense),
      net: Number(r.net),
    })),
    startBalances: startBalances.map((r) => ({
      accountId: r.accountId,
      balance: Number(r.balance),
    })),
  };
}

export type TxnDocument = {
  id: number;
  docType: string;
  invoiceKind: string | null;
  fileName: string | null;
  contentType: string | null;
  r2Key: string;
  uploadedAt: string;
};

// 一批交易的憑證 / 相關證明，回傳以 transactionId 分組的 Map
export async function listDocumentsForTransactions(
  orgId: string,
  ids: number[],
): Promise<Map<number, TxnDocument[]>> {
  const map = new Map<number, TxnDocument[]>();
  if (ids.length === 0) return map;
  const db = getDb();
  const rows = await db
    .select({
      id: documents.id,
      transactionId: documents.transactionId,
      docType: documents.docType,
      invoiceKind: documents.invoiceKind,
      fileName: documents.fileName,
      contentType: documents.contentType,
      r2Key: documents.r2Key,
      uploadedAt: documents.uploadedAt,
    })
    .from(documents)
    .where(
      and(
        eq(documents.organizationId, orgId),
        inArray(documents.transactionId, ids),
        isNull(documents.deletedAt),
      ),
    )
    .orderBy(desc(documents.uploadedAt));
  for (const r of rows) {
    if (r.transactionId == null) continue;
    const { transactionId, ...doc } = r;
    const arr = map.get(transactionId) ?? [];
    arr.push(doc);
    map.set(transactionId, arr);
  }
  return map;
}

// 待通知 / 已通知會計師的「其他發票（三聯式等）」
export async function listAccountantNotices(orgId: string) {
  const db = getDb();
  return db
    .select({
      id: documents.id,
      fileName: documents.fileName,
      r2Key: documents.r2Key,
      notifiedAt: documents.accountantNotifiedAt,
      uploadedAt: documents.uploadedAt,
      txnId: transactions.id,
      txnDate: transactions.txnDate,
      amount: transactions.amount,
      currency: transactions.currency,
      description: transactions.description,
      partyName: parties.name,
      categoryName: categories.name,
    })
    .from(documents)
    .innerJoin(transactions, eq(transactions.id, documents.transactionId))
    .leftJoin(parties, eq(parties.id, transactions.partyId))
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .where(
      and(
        eq(documents.organizationId, orgId),
        eq(documents.invoiceKind, "paper"),
        isNull(documents.deletedAt),
        isNull(transactions.deletedAt),
      ),
    )
    .orderBy(desc(transactions.txnDate), desc(documents.id));
}

// 代墊未還：type=advance 且還沒有任何 reimbursement 連回它
export async function listOutstandingAdvances(orgId: string) {
  const db = getDb();
  const vendor = aliasedTable(parties, "adv_vendor");
  return db
    .select({
      id: transactions.id,
      txnDate: transactions.txnDate,
      amount: transactions.amount,
      amountTwd: transactions.amountTwd,
      currency: transactions.currency,
      description: transactions.description,
      vendorName: vendor.name,
      settleName: employees.name,
      categoryName: categories.name,
    })
    .from(transactions)
    .leftJoin(vendor, eq(vendor.id, transactions.partyId))
    .leftJoin(employees, eq(employees.id, transactions.settleEmployeeId))
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .where(
      and(
        eq(transactions.organizationId, orgId),
        eq(transactions.type, "advance"),
        sql`NOT EXISTS (SELECT 1 FROM ${transactions} r WHERE r.related_to_id = ${transactions.id} AND r.deleted_at IS NULL)`,
        isNull(transactions.deletedAt),
      ),
    )
    .orderBy(desc(transactions.txnDate));
}

export async function listInvoices(orgId: string, limit = 100) {
  const db = getDb();
  return db
    .select()
    .from(invoices)
    .where(and(eq(invoices.organizationId, orgId), isNull(invoices.deletedAt)))
    .orderBy(desc(invoices.invoiceDate), desc(invoices.id))
    .limit(limit);
}

export async function listBankAccounts(orgId: string) {
  const db = getDb();
  return db
    .select()
    .from(bankAccounts)
    .where(and(eq(bankAccounts.organizationId, orgId), isNull(bankAccounts.deletedAt)))
    .orderBy(desc(bankAccounts.isActive), bankAccounts.name);
}

export async function listEmployees(orgId: string, limit = 200) {
  const db = getDb();
  return db
    .select()
    .from(employees)
    .where(and(eq(employees.organizationId, orgId), isNull(employees.deletedAt)))
    .orderBy(desc(employees.isActive), employees.name)
    .limit(limit);
}

/** 單一對象的往來累計：依幣別分開（不同幣別不能混加，本系統不做匯率換算）。 */
export type PartyTotal = { currency: string; received: number; paid: number };

export async function listParties(orgId: string) {
  const db = getDb();
  const rows = await db
    .select({
      id: parties.id,
      name: parties.name,
      label: parties.label,
      taxId: parties.taxId,
      defaultCurrency: parties.defaultCurrency,
      defaultAccountId: parties.defaultAccountId,
      typicalAmount: parties.typicalAmount,
      contact: parties.contact,
      note: parties.note,
      isActive: parties.isActive,
      accountName: bankAccounts.name,
      txnCount: sql<number>`(select count(*)::int from ${transactions} t where t.party_id = ${parties.id} and t.deleted_at is null)`,
    })
    .from(parties)
    .leftJoin(bankAccounts, eq(bankAccounts.id, parties.defaultAccountId))
    .where(and(eq(parties.organizationId, orgId), isNull(parties.deletedAt)))
    .orderBy(desc(parties.isActive), parties.name);

  // 往來金額依「對象 × 幣別」分組（不同幣別不能混加）：
  // received = 對方付我們（type income）、paid = 我們付對方（type expense/advance）。
  const totalRows = await db
    .select({
      partyId: transactions.partyId,
      currency: transactions.currency,
      received: sql<string>`coalesce(sum(${transactions.amount}) filter (where ${transactions.type} = 'income'), 0)`,
      paid: sql<string>`coalesce(sum(${transactions.amount}) filter (where ${transactions.type} in ('expense','advance')), 0)`,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.organizationId, orgId),
        isNull(transactions.deletedAt),
        sql`${transactions.partyId} is not null`,
        sql`${transactions.type} in ('income','expense','advance')`,
      ),
    )
    .groupBy(transactions.partyId, transactions.currency)
    .orderBy(transactions.currency);

  const byParty = new Map<number, PartyTotal[]>();
  for (const t of totalRows) {
    if (t.partyId == null) continue;
    const received = Number(t.received);
    const paid = Number(t.paid);
    if (received === 0 && paid === 0) continue;
    const list = byParty.get(t.partyId) ?? [];
    list.push({ currency: t.currency, received, paid });
    byParty.set(t.partyId, list);
  }

  return rows.map((r) => ({ ...r, totals: byParty.get(r.id) ?? [] }));
}

export async function getParty(orgId: string, id: number) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(parties)
    .where(and(eq(parties.organizationId, orgId), eq(parties.id, id), isNull(parties.deletedAt)))
    .limit(1);
  return row ?? null;
}

export async function getBankAccount(orgId: string, id: number) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(bankAccounts)
    .where(and(eq(bankAccounts.organizationId, orgId), eq(bankAccounts.id, id), isNull(bankAccounts.deletedAt)))
    .limit(1);
  return row ?? null;
}

export async function getEmployee(orgId: string, id: number) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(employees)
    .where(and(eq(employees.organizationId, orgId), eq(employees.id, id), isNull(employees.deletedAt)))
    .limit(1);
  return row ?? null;
}

export async function getInvoice(orgId: string, id: number) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.organizationId, orgId), eq(invoices.id, id), isNull(invoices.deletedAt)))
    .limit(1);
  return row ?? null;
}

export async function getDocument(orgId: string, id: number) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(documents)
    .where(and(eq(documents.organizationId, orgId), eq(documents.id, id), isNull(documents.deletedAt)))
    .limit(1);
  return row ?? null;
}

export async function getReconciliation(orgId: string, id: number) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(accountReconciliations)
    .where(
      and(
        eq(accountReconciliations.organizationId, orgId),
        eq(accountReconciliations.id, id),
        isNull(accountReconciliations.deletedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function getTransaction(orgId: string, id: number) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(transactions)
    .where(and(eq(transactions.organizationId, orgId), eq(transactions.id, id), isNull(transactions.deletedAt)))
    .limit(1);
  return row ?? null;
}

export async function getPayrollRun(orgId: string, id: number) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(payrollRuns)
    .where(and(eq(payrollRuns.organizationId, orgId), eq(payrollRuns.id, id), isNull(payrollRuns.deletedAt)))
    .limit(1);
  return row ?? null;
}

export async function listCategories(orgId: string) {
  const db = getDb();
  return db
    .select({ id: categories.id, name: categories.name, kind: categories.kind })
    .from(categories)
    .where(and(eq(categories.organizationId, orgId), eq(categories.isActive, true), isNull(categories.deletedAt)))
    .orderBy(categories.kind, categories.name);
}

// 帳面餘額 = 期初 + 流入 − 流出。用 left join + filter 聚合（相關子查詢在 drizzle sql 模板會關聯失效）。
export async function listAccountBalances(
  orgId: string,
  opts: { includeInactive?: boolean } = {},
) {
  const db = getDb();
  const balances = await db
    .select({
      id: bankAccounts.id,
      name: bankAccounts.name,
      currency: bankAccounts.currency,
      kind: bankAccounts.kind,
      isActive: bankAccounts.isActive,
      openingBalance: bankAccounts.openingBalance,
      bookBalance: sql<string>`(
        ${bankAccounts.openingBalance}
        + coalesce(sum(${transactions.amount}) filter (where ${transactions.toAccountId} = ${bankAccounts.id}), 0)
        - coalesce(sum(${transactions.amount}) filter (where ${transactions.fromAccountId} = ${bankAccounts.id}), 0)
      )`,
    })
    .from(bankAccounts)
    .leftJoin(
      transactions,
      and(
        or(
          eq(transactions.fromAccountId, bankAccounts.id),
          eq(transactions.toAccountId, bankAccounts.id),
        ),
        isNull(transactions.deletedAt),
      ),
    )
    .where(
      and(
        eq(bankAccounts.organizationId, orgId),
        opts.includeInactive ? undefined : eq(bankAccounts.isActive, true),
        isNull(bankAccounts.deletedAt),
      ),
    )
    .groupBy(bankAccounts.id)
    .orderBy(desc(bankAccounts.isActive), bankAccounts.name);

  // 最後對帳日（另外查，避免和上面的 join 產生笛卡兒積把金額重複加）
  const lastRows = await db
    .select({
      accountId: accountReconciliations.accountId,
      last: sql<string>`max(${accountReconciliations.asOfDate})`,
    })
    .from(accountReconciliations)
    .where(and(eq(accountReconciliations.organizationId, orgId), isNull(accountReconciliations.deletedAt)))
    .groupBy(accountReconciliations.accountId);
  const lastMap = new Map(lastRows.map((r) => [r.accountId, r.last]));

  return balances.map((b) => ({ ...b, lastReconciledAt: lastMap.get(b.id) ?? null }));
}

// Reconciliation snapshots with the book balance computed as of each snapshot date.
export async function listReconciliations(orgId: string, limit = 100) {
  const db = getDb();
  return db
    .select({
      id: accountReconciliations.id,
      accountId: accountReconciliations.accountId,
      accountName: bankAccounts.name,
      currency: bankAccounts.currency,
      asOfDate: accountReconciliations.asOfDate,
      statementBalance: accountReconciliations.statementBalance,
      note: accountReconciliations.note,
      // 截止日(含)前的帳面餘額：left join + filter，不用相關子查詢
      bookBalance: sql<string>`(
        ${bankAccounts.openingBalance}
        + coalesce(sum(${transactions.amount}) filter (where ${transactions.toAccountId} = ${accountReconciliations.accountId}), 0)
        - coalesce(sum(${transactions.amount}) filter (where ${transactions.fromAccountId} = ${accountReconciliations.accountId}), 0)
      )`,
    })
    .from(accountReconciliations)
    .leftJoin(bankAccounts, eq(bankAccounts.id, accountReconciliations.accountId))
    .leftJoin(
      transactions,
      and(
        or(
          eq(transactions.fromAccountId, accountReconciliations.accountId),
          eq(transactions.toAccountId, accountReconciliations.accountId),
        ),
        lte(transactions.txnDate, accountReconciliations.asOfDate),
        isNull(transactions.deletedAt),
      ),
    )
    .where(and(eq(accountReconciliations.organizationId, orgId), isNull(accountReconciliations.deletedAt)))
    .groupBy(accountReconciliations.id, bankAccounts.id)
    .orderBy(desc(accountReconciliations.asOfDate), desc(accountReconciliations.id))
    .limit(limit);
}

export async function listPayrollRuns(orgId: string, limit = 50) {
  const db = getDb();
  return db
    .select({
      id: payrollRuns.id,
      periodYear: payrollRuns.periodYear,
      periodMonth: payrollRuns.periodMonth,
      payDate: payrollRuns.payDate,
      status: payrollRuns.status,
      note: payrollRuns.note,
      payslipCount: sql<number>`(select count(*)::int from ${payslips} ps where ps.payroll_run_id = ${payrollRuns.id})`,
      netTotal: sql<string>`coalesce((select sum(ps.net_pay) from ${payslips} ps where ps.payroll_run_id = ${payrollRuns.id}), 0)`,
    })
    .from(payrollRuns)
    .where(and(eq(payrollRuns.organizationId, orgId), isNull(payrollRuns.deletedAt)))
    .orderBy(desc(payrollRuns.periodYear), desc(payrollRuns.periodMonth))
    .limit(limit);
}

export async function listPayrollItemTypes(orgId: string) {
  const db = getDb();
  // direction desc → 'earning' 在 'deduction' 之前
  return db
    .select({
      id: payrollItemTypes.id,
      name: payrollItemTypes.name,
      direction: payrollItemTypes.direction,
      isTaxable: payrollItemTypes.isTaxable,
      isStatutory: payrollItemTypes.isStatutory,
    })
    .from(payrollItemTypes)
    .where(eq(payrollItemTypes.organizationId, orgId))
    .orderBy(desc(payrollItemTypes.direction), payrollItemTypes.id);
}

// 薪資發放紀錄（每位員工每月一張）
export async function listPayslipRecords(orgId: string, limit = 200) {
  const db = getDb();
  return db
    .select({
      id: payslips.id,
      employeeName: employees.name,
      periodYear: payrollRuns.periodYear,
      periodMonth: payrollRuns.periodMonth,
      payDate: payrollRuns.payDate,
      taxableTotal: payslips.taxableTotal,
      nontaxableTotal: payslips.nontaxableTotal,
      deductionTotal: payslips.deductionTotal,
      netPay: payslips.netPay,
      paidTransactionId: payslips.paidTransactionId,
    })
    .from(payslips)
    .innerJoin(payrollRuns, eq(payrollRuns.id, payslips.payrollRunId))
    .leftJoin(employees, eq(employees.id, payslips.employeeId))
    .where(and(eq(payrollRuns.organizationId, orgId), isNull(payslips.deletedAt)))
    .orderBy(desc(payrollRuns.periodYear), desc(payrollRuns.periodMonth), employees.name)
    .limit(limit);
}

// ---- 客戶營運（專案 / 訂閱 / 合約）----

// 收支以 TWD 為主（amount_twd 缺值時退回 amount）做單一幣別彙總，報表用。
const incomeTwd = sql<string>`coalesce(sum(coalesce(${transactions.amountTwd}, ${transactions.amount})) filter (where ${transactions.type} = 'income'), 0)`;
const expenseTwd = sql<string>`coalesce(sum(coalesce(${transactions.amountTwd}, ${transactions.amount})) filter (where ${transactions.type} in ('expense','advance')), 0)`;

// 專案清單，附帶以 TWD 彙總的收入 / 支出（per-project P&L）。
export async function listProjects(orgId: string) {
  const db = getDb();
  const client = aliasedTable(parties, "client_party");
  const rows = await db
    .select({
      id: projects.id,
      name: projects.name,
      status: projects.status,
      description: projects.description,
      clientPartyId: projects.clientPartyId,
      clientName: client.name,
      income: incomeTwd,
      expense: expenseTwd,
    })
    .from(projects)
    .leftJoin(client, eq(client.id, projects.clientPartyId))
    .leftJoin(
      transactions,
      and(eq(transactions.projectId, projects.id), isNull(transactions.deletedAt)),
    )
    .where(and(eq(projects.organizationId, orgId), isNull(projects.deletedAt)))
    .groupBy(projects.id, client.name)
    .orderBy(desc(projects.createdAt));
  return rows.map((r) => {
    const income = Number(r.income);
    const expense = Number(r.expense);
    return { ...r, income, expense, net: income - expense };
  });
}

export async function getProject(orgId: string, id: number) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.organizationId, orgId), eq(projects.id, id), isNull(projects.deletedAt)))
    .limit(1);
  return row ?? null;
}

export async function listSubscriptions(orgId: string) {
  const db = getDb();
  return db
    .select({
      id: subscriptions.id,
      customerPartyId: subscriptions.customerPartyId,
      customerName: parties.name,
      projectId: subscriptions.projectId,
      projectName: projects.name,
      name: subscriptions.name,
      amount: subscriptions.amount,
      currency: subscriptions.currency,
      intervalMonths: subscriptions.intervalMonths,
      startDate: subscriptions.startDate,
      endDate: subscriptions.endDate,
      status: subscriptions.status,
      note: subscriptions.note,
    })
    .from(subscriptions)
    .leftJoin(parties, eq(parties.id, subscriptions.customerPartyId))
    .leftJoin(projects, eq(projects.id, subscriptions.projectId))
    .where(and(eq(subscriptions.organizationId, orgId), isNull(subscriptions.deletedAt)))
    .orderBy(desc(subscriptions.createdAt));
}

export async function getSubscription(orgId: string, id: number) {
  const db = getDb();
  const [row] = await db
    .select({
      id: subscriptions.id,
      customerPartyId: subscriptions.customerPartyId,
      customerName: parties.name,
      projectId: subscriptions.projectId,
      name: subscriptions.name,
      amount: subscriptions.amount,
      currency: subscriptions.currency,
      intervalMonths: subscriptions.intervalMonths,
      startDate: subscriptions.startDate,
      endDate: subscriptions.endDate,
      status: subscriptions.status,
    })
    .from(subscriptions)
    .leftJoin(parties, eq(parties.id, subscriptions.customerPartyId))
    .where(and(eq(subscriptions.organizationId, orgId), eq(subscriptions.id, id), isNull(subscriptions.deletedAt)))
    .limit(1);
  return row ?? null;
}

// 某訂閱各期已收金額：綁定此訂閱、同幣別、type=income 的交易，依 subscription_period 分組加總。
export async function subscriptionPaidByPeriod(
  orgId: string,
  subscriptionId: number,
): Promise<{ periodStart: string; paid: number }[]> {
  const db = getDb();
  const rows = await db
    .select({
      periodStart: transactions.subscriptionPeriod,
      paid: sql<string>`coalesce(sum(${transactions.amount}), 0)`,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.organizationId, orgId),
        eq(transactions.subscriptionId, subscriptionId),
        eq(transactions.type, "income"),
        isNull(transactions.deletedAt),
      ),
    )
    .groupBy(transactions.subscriptionPeriod);
  return rows
    .filter((r): r is { periodStart: string; paid: string } => r.periodStart != null)
    .map((r) => ({ periodStart: r.periodStart, paid: Number(r.paid) }));
}

export type SubscriptionForSchedule = {
  amount: string;
  intervalMonths: number;
  startDate: string;
  endDate: string | null;
};

export type SubscriptionPeriodStatus = "paid" | "partial" | "overdue" | "upcoming";

export type SubscriptionPeriod = {
  periodStart: string;
  periodLabel: string;
  expected: number;
  paid: number;
  status: SubscriptionPeriodStatus;
  note: string | null;
  isOverride: boolean;
};

// 某訂閱各期「應收金額」覆寫：未刪除的每期覆寫（含備註），依期別排序。
export async function listSubscriptionPeriods(
  orgId: string,
  subscriptionId: number,
): Promise<{ periodStart: string; expectedAmount: number; note: string | null }[]> {
  const db = getDb();
  const rows = await db
    .select({
      periodStart: subscriptionPeriods.periodStart,
      expectedAmount: subscriptionPeriods.expectedAmount,
      note: subscriptionPeriods.note,
    })
    .from(subscriptionPeriods)
    .where(
      and(
        eq(subscriptionPeriods.organizationId, orgId),
        eq(subscriptionPeriods.subscriptionId, subscriptionId),
        isNull(subscriptionPeriods.deletedAt),
      ),
    )
    .orderBy(subscriptionPeriods.periodStart);
  return rows.map((r) => ({
    periodStart: r.periodStart,
    expectedAmount: Number(r.expectedAmount),
    note: r.note,
  }));
}

// 純函式：把「排程期別」與「已收（依期別）」合併成各期收款狀態。
// - 排程期別：從 startDate 起，每隔 intervalMonths 一期，涵蓋所有 ≤ today 的期別，
//   再加上第一個 > today 的期別（下一期，標記 upcoming）；有 endDate 則不超過它。
// - 另外把已收資料中出現、但不在排程上的期別（提前 / 轉換 / 臨時期）也一併納入。
// - explicitPeriods：某期的「應收金額」覆寫（可含備註）；有覆寫的期別用覆寫金額，
//   其餘退回 sub.amount。覆寫的期別也一律納入顯示（即使還沒排到 / 沒收款）。
export function computeSubscriptionSchedule(
  sub: SubscriptionForSchedule,
  paidByPeriod: { periodStart: string; paid: number }[],
  explicitPeriods: { periodStart: string; expectedAmount: number; note: string | null }[],
  today: string,
): { periods: SubscriptionPeriod[]; totalOutstanding: number } {
  const defaultExpected = Number(sub.amount);
  const paidMap = new Map(paidByPeriod.map((p) => [p.periodStart, p.paid]));
  const overrideByStart = new Map(explicitPeriods.map((p) => [p.periodStart, p]));

  const starts = new Set<string>();
  if (sub.startDate && sub.intervalMonths >= 1) {
    const todayDate = parseISO(today);
    const end = sub.endDate ? parseISO(sub.endDate) : null;
    let d = parseISO(sub.startDate);
    let guard = 0;
    // 收集 ≤ today 的期別，並多帶一個 > today 的期別（下一期）。
    while (guard < 1000) {
      if (end && isAfter(d, end)) break;
      const iso = format(d, "yyyy-MM-dd");
      starts.add(iso);
      if (isAfter(d, todayDate)) break; // 已收到第一個未到期的期別，停止
      d = addMonths(d, sub.intervalMonths);
      guard++;
    }
  }
  // 已收資料中出現的期別也要顯示（即使不在排程上）。
  for (const p of paidByPeriod) starts.add(p.periodStart);
  // 有應收覆寫的期別也一律納入。
  for (const p of explicitPeriods) starts.add(p.periodStart);

  const sorted = [...starts].sort();
  let totalOutstanding = 0;
  const periods: SubscriptionPeriod[] = sorted.map((periodStart) => {
    const override = overrideByStart.get(periodStart);
    const expected = override?.expectedAmount ?? defaultExpected;
    const paid = paidMap.get(periodStart) ?? 0;
    const upcoming = periodStart > today;
    let status: SubscriptionPeriodStatus;
    if (paid >= expected) status = "paid";
    else if (paid > 0) status = "partial";
    else if (upcoming) status = "upcoming";
    else status = "overdue";
    if (!upcoming) totalOutstanding += Math.max(0, expected - paid);
    return {
      periodStart,
      periodLabel: periodStart,
      expected,
      paid,
      status,
      note: override?.note ?? null,
      isOverride: overrideByStart.has(periodStart),
    };
  });
  return { periods, totalOutstanding };
}

export type SubscriptionSchedule = {
  id: number;
  name: string;
  customerName: string | null;
  amount: string;
  currency: string;
  intervalMonths: number;
  startDate: string;
  endDate: string | null;
  status: string;
  nextChargeDate: string | null;
  periods: SubscriptionPeriod[];
  totalOutstanding: number;
};

// 抓一張訂閱 + 各期已收，算出各期收款狀態。MCP 工具與訂閱頁共用。
export async function getSubscriptionSchedule(
  orgId: string,
  id: number,
): Promise<SubscriptionSchedule | null> {
  const sub = await getSubscription(orgId, id);
  if (!sub) return null;
  const today = todayStr();
  const [paidByPeriod, explicitPeriods] = await Promise.all([
    subscriptionPaidByPeriod(orgId, id),
    listSubscriptionPeriods(orgId, id),
  ]);
  const { periods, totalOutstanding } = computeSubscriptionSchedule(
    sub,
    paidByPeriod,
    explicitPeriods,
    today,
  );
  return {
    id: sub.id,
    name: sub.name,
    customerName: sub.customerName,
    amount: sub.amount,
    currency: sub.currency,
    intervalMonths: sub.intervalMonths,
    startDate: sub.startDate,
    endDate: sub.endDate,
    status: sub.status,
    nextChargeDate:
      sub.status === "active"
        ? nextChargeDate(sub.startDate, sub.intervalMonths, today, sub.endDate)
        : null,
    periods,
    totalOutstanding,
  };
}

export type SubscriptionPeriodRow = {
  periodStart: string;
  expectedAmount: number;
  note: string | null;
};

// 新增 / 更新某訂閱某期的「應收金額」覆寫（org 內）。
// 因為唯一索引是 partial（deleted_at IS NULL），drizzle 的 onConflict 不易表達，
// 改用「先查存活的同期覆寫→有則更新、無則新增」的手動 upsert，語意較清楚。
export async function upsertSubscriptionPeriod(
  orgId: string,
  subscriptionId: number,
  periodStart: string,
  expectedAmount: number,
  note: string | null,
): Promise<SubscriptionPeriodRow> {
  const db = getDb();
  const amountStr = expectedAmount.toString();
  const [existing] = await db
    .select({ id: subscriptionPeriods.id })
    .from(subscriptionPeriods)
    .where(
      and(
        eq(subscriptionPeriods.organizationId, orgId),
        eq(subscriptionPeriods.subscriptionId, subscriptionId),
        eq(subscriptionPeriods.periodStart, periodStart),
        isNull(subscriptionPeriods.deletedAt),
      ),
    )
    .limit(1);

  const [row] = existing
    ? await db
        .update(subscriptionPeriods)
        .set({ expectedAmount: amountStr, note })
        .where(eq(subscriptionPeriods.id, existing.id))
        .returning({
          periodStart: subscriptionPeriods.periodStart,
          expectedAmount: subscriptionPeriods.expectedAmount,
          note: subscriptionPeriods.note,
        })
    : await db
        .insert(subscriptionPeriods)
        .values({
          organizationId: orgId,
          subscriptionId,
          periodStart,
          expectedAmount: amountStr,
          note,
        })
        .returning({
          periodStart: subscriptionPeriods.periodStart,
          expectedAmount: subscriptionPeriods.expectedAmount,
          note: subscriptionPeriods.note,
        });

  return { periodStart: row.periodStart, expectedAmount: Number(row.expectedAmount), note: row.note };
}

// 軟刪某訂閱某期的應收覆寫（該期退回訂閱預設金額）。回傳是否有刪到。
export async function deleteSubscriptionPeriod(
  orgId: string,
  subscriptionId: number,
  periodStart: string,
): Promise<boolean> {
  const db = getDb();
  const rows = await db
    .update(subscriptionPeriods)
    .set({ deletedAt: new Date().toISOString() })
    .where(
      and(
        eq(subscriptionPeriods.organizationId, orgId),
        eq(subscriptionPeriods.subscriptionId, subscriptionId),
        eq(subscriptionPeriods.periodStart, periodStart),
        isNull(subscriptionPeriods.deletedAt),
      ),
    )
    .returning({ id: subscriptionPeriods.id });
  return rows.length > 0;
}

// 合約選單用的精簡清單（綁交易時的下拉選項）。
export async function listContractOptions(orgId: string) {
  const db = getDb();
  return db
    .select({
      id: contracts.id,
      title: contracts.title,
      customerName: parties.name,
      currency: contracts.currency,
      status: contracts.status,
    })
    .from(contracts)
    .leftJoin(parties, eq(parties.id, contracts.customerPartyId))
    .where(and(eq(contracts.organizationId, orgId), isNull(contracts.deletedAt)))
    .orderBy(desc(contracts.createdAt));
}

export async function listContracts(orgId: string) {
  const db = getDb();
  // 收款進度：只看綁定此合約、且同幣別的交易（合約金額是單一幣別，不混算）。
  // received = income（已收）；cost = expense/advance（成本，僅供參考，不從合約金額扣）。
  const receivedSum = sql<string>`coalesce(sum(${transactions.amount}) filter (where ${transactions.type} = 'income'), 0)`;
  const costSum = sql<string>`coalesce(sum(${transactions.amount}) filter (where ${transactions.type} in ('expense','advance')), 0)`;
  const rows = await db
    .select({
      id: contracts.id,
      customerPartyId: contracts.customerPartyId,
      customerName: parties.name,
      projectId: contracts.projectId,
      projectName: projects.name,
      title: contracts.title,
      amount: contracts.amount,
      currency: contracts.currency,
      startDate: contracts.startDate,
      endDate: contracts.endDate,
      status: contracts.status,
      note: contracts.note,
      fileUrl: contracts.fileUrl,
      received: receivedSum,
      cost: costSum,
    })
    .from(contracts)
    .leftJoin(parties, eq(parties.id, contracts.customerPartyId))
    .leftJoin(projects, eq(projects.id, contracts.projectId))
    .leftJoin(
      transactions,
      and(
        eq(transactions.contractId, contracts.id),
        eq(transactions.currency, contracts.currency),
        isNull(transactions.deletedAt),
      ),
    )
    .where(and(eq(contracts.organizationId, orgId), isNull(contracts.deletedAt)))
    .groupBy(contracts.id, parties.name, projects.name)
    .orderBy(desc(contracts.createdAt));
  return rows.map((r) => {
    const received = Number(r.received);
    const cost = Number(r.cost);
    const remaining = r.amount == null ? null : Number(r.amount) - received;
    return { ...r, received, cost, remaining };
  });
}

// 廠商 / infra 成本報表：把支出（含代墊）依交易對象彙總（TWD）。
export async function listVendorCosts(orgId: string) {
  const db = getDb();
  const rows = await db
    .select({
      partyId: parties.id,
      partyName: parties.name,
      label: parties.label,
      txnCount: sql<number>`count(${transactions.id})`,
      total: sql<string>`coalesce(sum(coalesce(${transactions.amountTwd}, ${transactions.amount})), 0)`,
    })
    .from(transactions)
    .innerJoin(parties, eq(parties.id, transactions.partyId))
    .where(
      and(
        eq(transactions.organizationId, orgId),
        sql`${transactions.type} in ('expense','advance')`,
        isNull(transactions.deletedAt),
      ),
    )
    .groupBy(parties.id, parties.name, parties.label)
    .orderBy(sql`coalesce(sum(coalesce(${transactions.amountTwd}, ${transactions.amount})), 0) desc`);
  return rows.map((r) => ({ ...r, total: Number(r.total), txnCount: Number(r.txnCount) }));
}

// ---- MCP / OAuth clients ----

/** The current user's role in the given org (owner/admin/member), or null. */
export async function getMemberRole(orgId: string, userId: string) {
  const rows = await getDb()
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.userId, userId), eq(member.organizationId, orgId)))
    .limit(1);
  return rows[0]?.role ?? null;
}

export type McpClient = {
  id: string;
  clientId: string;
  name: string | null;
  type: string;
  disabled: boolean;
  createdAt: Date;
  activeTokens: number;
};

/**
 * MCP OAuth clients registered against this deployment (better-auth `mcp`
 * plugin). Self-registered via Dynamic Client Registration, so this is the
 * canonical list of what can talk to /mcp. activeTokens = unexpired access
 * tokens for that client. Not org-scoped (the OAuth provider is deployment-wide).
 */
export async function listMcpClients(): Promise<McpClient[]> {
  const rows = await getDb()
    .select({
      id: oauthApplication.id,
      clientId: oauthApplication.clientId,
      name: oauthApplication.name,
      type: oauthApplication.type,
      disabled: oauthApplication.disabled,
      createdAt: oauthApplication.createdAt,
      activeTokens: sql<number>`count(${oauthAccessToken.accessToken}) filter (where ${oauthAccessToken.accessTokenExpiresAt} > now())`,
    })
    .from(oauthApplication)
    .leftJoin(
      oauthAccessToken,
      eq(oauthAccessToken.clientId, oauthApplication.clientId),
    )
    .groupBy(
      oauthApplication.id,
      oauthApplication.clientId,
      oauthApplication.name,
      oauthApplication.type,
      oauthApplication.disabled,
      oauthApplication.createdAt,
    )
    .orderBy(desc(oauthApplication.createdAt));
  return rows.map((r) => ({ ...r, activeTokens: Number(r.activeTokens) }));
}

export type MyOrg = { id: string; name: string; slug: string | null };

/** Orgs the given user belongs to — for building per-org MCP connection URLs. */
export async function listMyOrgs(userId: string): Promise<MyOrg[]> {
  return getDb()
    .select({
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
    })
    .from(member)
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .where(eq(member.userId, userId))
    .orderBy(organization.name);
}

export type ActivityRow = {
  id: number; actorName: string | null; actorEmail: string | null; channel: string;
  action: string; entityType: string; entityId: number | null; summary: string | null; createdAt: string;
};
export async function listActivity(
  orgId: string,
  opts: { entityType?: string; action?: string; limit?: number } = {},
): Promise<ActivityRow[]> {
  const db = getDb();
  return db
    .select({
      id: activityLog.id,
      actorName: activityLog.actorName,
      actorEmail: activityLog.actorEmail,
      channel: activityLog.channel,
      action: activityLog.action,
      entityType: activityLog.entityType,
      entityId: activityLog.entityId,
      summary: activityLog.summary,
      createdAt: activityLog.createdAt,
    })
    .from(activityLog)
    .where(
      and(
        eq(activityLog.organizationId, orgId),
        opts.entityType ? eq(activityLog.entityType, opts.entityType) : undefined,
        opts.action ? eq(activityLog.action, opts.action) : undefined,
      ),
    )
    .orderBy(desc(activityLog.createdAt))
    .limit(opts.limit ?? 200);
}

// 每筆資料的「誰、何時建立 / 最後修改」，從 activity_log 衍生（不需在各表加欄位）。
// 一次查一批 id：取每個 entity 最後一筆 create 與最後一筆 update。
// #15（操作紀錄）之前的舊資料在 log 裡沒有紀錄，呼叫端可退回該列自己的 createdAt。
export type AuditMeta = {
  createdBy: string | null;
  createdChannel: string | null;
  createdAt: string | null;
  updatedBy: string | null;
  updatedChannel: string | null;
  updatedAt: string | null;
};

export async function getAuditMeta(
  orgId: string,
  entityType: string,
  ids: number[],
): Promise<Map<number, AuditMeta>> {
  const map = new Map<number, AuditMeta>();
  if (ids.length === 0) return map;
  const db = getDb();
  const rows = await db
    .selectDistinctOn([activityLog.entityId, activityLog.action], {
      entityId: activityLog.entityId,
      action: activityLog.action,
      actorName: activityLog.actorName,
      actorEmail: activityLog.actorEmail,
      channel: activityLog.channel,
      createdAt: activityLog.createdAt,
    })
    .from(activityLog)
    .where(
      and(
        eq(activityLog.organizationId, orgId),
        eq(activityLog.entityType, entityType),
        inArray(activityLog.entityId, ids),
        inArray(activityLog.action, ["create", "update"]),
      ),
    )
    // DISTINCT ON 要求排序前導欄位 = distinct 欄位；同一 (entity, action) 取最新那筆
    .orderBy(activityLog.entityId, activityLog.action, desc(activityLog.createdAt));

  for (const r of rows) {
    if (r.entityId == null) continue;
    const actor = r.actorName ?? r.actorEmail ?? null;
    const meta = map.get(r.entityId) ?? {
      createdBy: null,
      createdChannel: null,
      createdAt: null,
      updatedBy: null,
      updatedChannel: null,
      updatedAt: null,
    };
    if (r.action === "create") {
      meta.createdBy = actor;
      meta.createdChannel = r.channel;
      meta.createdAt = r.createdAt;
    } else if (r.action === "update") {
      meta.updatedBy = actor;
      meta.updatedChannel = r.channel;
      meta.updatedAt = r.createdAt;
    }
    map.set(r.entityId, meta);
  }
  return map;
}

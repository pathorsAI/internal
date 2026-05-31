import { sql, eq, desc, and, or, lte, inArray, aliasedTable } from "drizzle-orm";
import { getDb } from "./index";
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
} from "./schema";

export type Book = "internal" | "external" | "both";

export async function getOverview() {
  const db = getDb();

  // 依幣別分組（不同幣別不能混加）：收入=type income，支出=type expense+advance
  const rows = await db
    .select({
      currency: transactions.currency,
      income: sql<string>`coalesce(sum(${transactions.amount}) filter (where ${transactions.type} = 'income'), 0)`,
      expense: sql<string>`coalesce(sum(${transactions.amount}) filter (where ${transactions.type} in ('expense','advance')), 0)`,
    })
    .from(transactions)
    .where(sql`${transactions.type} in ('income','expense','advance')`)
    .groupBy(transactions.currency)
    .orderBy(transactions.currency);

  return rows.map((r) => {
    const income = Number(r.income);
    const expense = Number(r.expense);
    return { currency: r.currency, income, expense, net: income - expense };
  });
}

export async function listTransactions(book?: Book, limit = 100) {
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
    .where(book ? eq(transactions.book, book) : undefined)
    .orderBy(desc(transactions.txnDate), desc(transactions.id))
    .limit(limit);

  return rows;
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
    .where(inArray(documents.transactionId, ids))
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
export async function listAccountantNotices() {
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
    .where(eq(documents.invoiceKind, "paper"))
    .orderBy(desc(transactions.txnDate), desc(documents.id));
}

// 代墊未還：type=advance 且還沒有任何 reimbursement 連回它
export async function listOutstandingAdvances() {
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
        eq(transactions.type, "advance"),
        sql`NOT EXISTS (SELECT 1 FROM ${transactions} r WHERE r.related_to_id = ${transactions.id})`,
      ),
    )
    .orderBy(desc(transactions.txnDate));
}

export async function listInvoices(limit = 100) {
  const db = getDb();
  return db.select().from(invoices).orderBy(desc(invoices.invoiceDate), desc(invoices.id)).limit(limit);
}

export async function listBankAccounts() {
  const db = getDb();
  return db.select().from(bankAccounts).orderBy(desc(bankAccounts.isActive), bankAccounts.name);
}

export async function listEmployees(limit = 200) {
  const db = getDb();
  return db.select().from(employees).orderBy(desc(employees.isActive), employees.name).limit(limit);
}

export async function listParties() {
  const db = getDb();
  return db
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
      txnCount: sql<number>`(select count(*)::int from ${transactions} t where t.party_id = ${parties.id})`,
      txnTotal: sql<string>`coalesce((select sum(coalesce(t.amount_twd, t.amount)) from ${transactions} t where t.party_id = ${parties.id}), 0)`,
    })
    .from(parties)
    .leftJoin(bankAccounts, eq(bankAccounts.id, parties.defaultAccountId))
    .orderBy(desc(parties.isActive), parties.name);
}

export async function getParty(id: number) {
  const db = getDb();
  const [row] = await db.select().from(parties).where(eq(parties.id, id)).limit(1);
  return row ?? null;
}

export async function getBankAccount(id: number) {
  const db = getDb();
  const [row] = await db.select().from(bankAccounts).where(eq(bankAccounts.id, id)).limit(1);
  return row ?? null;
}

export async function getEmployee(id: number) {
  const db = getDb();
  const [row] = await db.select().from(employees).where(eq(employees.id, id)).limit(1);
  return row ?? null;
}

export async function getInvoice(id: number) {
  const db = getDb();
  const [row] = await db.select().from(invoices).where(eq(invoices.id, id)).limit(1);
  return row ?? null;
}

export async function getDocument(id: number) {
  const db = getDb();
  const [row] = await db.select().from(documents).where(eq(documents.id, id)).limit(1);
  return row ?? null;
}

export async function getReconciliation(id: number) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(accountReconciliations)
    .where(eq(accountReconciliations.id, id))
    .limit(1);
  return row ?? null;
}

export async function getTransaction(id: number) {
  const db = getDb();
  const [row] = await db.select().from(transactions).where(eq(transactions.id, id)).limit(1);
  return row ?? null;
}

export async function getPayrollRun(id: number) {
  const db = getDb();
  const [row] = await db.select().from(payrollRuns).where(eq(payrollRuns.id, id)).limit(1);
  return row ?? null;
}

export async function listCategories() {
  const db = getDb();
  return db
    .select({ id: categories.id, name: categories.name, kind: categories.kind })
    .from(categories)
    .where(eq(categories.isActive, true))
    .orderBy(categories.kind, categories.name);
}

// 帳面餘額 = 期初 + 流入 − 流出。用 left join + filter 聚合（相關子查詢在 drizzle sql 模板會關聯失效）。
export async function listAccountBalances() {
  const db = getDb();
  const balances = await db
    .select({
      id: bankAccounts.id,
      name: bankAccounts.name,
      currency: bankAccounts.currency,
      kind: bankAccounts.kind,
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
      or(
        eq(transactions.fromAccountId, bankAccounts.id),
        eq(transactions.toAccountId, bankAccounts.id),
      ),
    )
    .where(eq(bankAccounts.isActive, true))
    .groupBy(bankAccounts.id)
    .orderBy(bankAccounts.name);

  // 最後對帳日（另外查，避免和上面的 join 產生笛卡兒積把金額重複加）
  const lastRows = await db
    .select({
      accountId: accountReconciliations.accountId,
      last: sql<string>`max(${accountReconciliations.asOfDate})`,
    })
    .from(accountReconciliations)
    .groupBy(accountReconciliations.accountId);
  const lastMap = new Map(lastRows.map((r) => [r.accountId, r.last]));

  return balances.map((b) => ({ ...b, lastReconciledAt: lastMap.get(b.id) ?? null }));
}

// Reconciliation snapshots with the book balance computed as of each snapshot date.
export async function listReconciliations(limit = 100) {
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
      ),
    )
    .groupBy(accountReconciliations.id, bankAccounts.id)
    .orderBy(desc(accountReconciliations.asOfDate), desc(accountReconciliations.id))
    .limit(limit);
}

export async function listPayrollRuns(limit = 50) {
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
    .orderBy(desc(payrollRuns.periodYear), desc(payrollRuns.periodMonth))
    .limit(limit);
}

export async function listPayrollItemTypes() {
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
    .orderBy(desc(payrollItemTypes.direction), payrollItemTypes.id);
}

// 薪資發放紀錄（每位員工每月一張）
export async function listPayslipRecords(limit = 200) {
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
    .orderBy(desc(payrollRuns.periodYear), desc(payrollRuns.periodMonth), employees.name)
    .limit(limit);
}

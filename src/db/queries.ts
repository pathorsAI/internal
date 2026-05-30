import { sql, eq, desc, aliasedTable } from "drizzle-orm";
import { getDb } from "./index";
import {
  transactions,
  categories,
  bankAccounts,
  invoices,
  employees,
  payrollRuns,
  payslips,
  suppliers,
  accountReconciliations,
} from "./schema";

export type Book = "internal" | "external" | "both";

export async function getOverview() {
  const db = getDb();

  const [[txns], [inv], [emp], [acct]] = await Promise.all([
    db.select({ value: sql<number>`count(*)::int` }).from(transactions),
    db.select({ value: sql<number>`count(*)::int` }).from(invoices),
    db
      .select({ value: sql<number>`count(*)::int` })
      .from(employees)
      .where(eq(employees.isActive, true)),
    db
      .select({ value: sql<number>`count(*)::int` })
      .from(bankAccounts)
      .where(eq(bankAccounts.isActive, true)),
  ]);
  const counts = {
    txns: txns?.value ?? 0,
    invoices: inv?.value ?? 0,
    employees: emp?.value ?? 0,
    accounts: acct?.value ?? 0,
  };

  const byKind = await db
    .select({
      kind: categories.kind,
      total: sql<string>`coalesce(sum(coalesce(${transactions.amountTwd}, ${transactions.amount})), 0)`,
    })
    .from(transactions)
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .groupBy(categories.kind);

  const sumFor = (kinds: string[]) =>
    byKind
      .filter((r) => r.kind && kinds.includes(r.kind))
      .reduce((s, r) => s + Number(r.total), 0);

  const income = sumFor(["income"]);
  const expense = sumFor(["expense", "cogs", "non_operating"]);

  return {
    counts: counts ?? { txns: 0, invoices: 0, employees: 0, accounts: 0 },
    income,
    expense,
    net: income - expense,
  };
}

export async function listTransactions(book?: Book, limit = 100) {
  const db = getDb();
  const fromAcct = aliasedTable(bankAccounts, "from_acct");
  const toAcct = aliasedTable(bankAccounts, "to_acct");

  const rows = await db
    .select({
      id: transactions.id,
      txnDate: transactions.txnDate,
      party: transactions.party,
      description: transactions.description,
      amount: transactions.amount,
      currency: transactions.currency,
      amountTwd: transactions.amountTwd,
      book: transactions.book,
      categoryName: categories.name,
      categoryKind: categories.kind,
      fromAccount: fromAcct.name,
      toAccount: toAcct.name,
      supplierName: suppliers.name,
    })
    .from(transactions)
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .leftJoin(fromAcct, eq(fromAcct.id, transactions.fromAccountId))
    .leftJoin(toAcct, eq(toAcct.id, transactions.toAccountId))
    .leftJoin(suppliers, eq(suppliers.id, transactions.supplierId))
    .where(book ? eq(transactions.book, book) : undefined)
    .orderBy(desc(transactions.txnDate), desc(transactions.id))
    .limit(limit);

  return rows;
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

export async function listSuppliers() {
  const db = getDb();
  return db
    .select({
      id: suppliers.id,
      name: suppliers.name,
      taxId: suppliers.taxId,
      defaultCurrency: suppliers.defaultCurrency,
      typicalAmount: suppliers.typicalAmount,
      contact: suppliers.contact,
      note: suppliers.note,
      isActive: suppliers.isActive,
      accountName: bankAccounts.name,
      txnCount: sql<number>`(select count(*)::int from ${transactions} t where t.supplier_id = ${suppliers.id})`,
      txnTotal: sql<string>`coalesce((select sum(coalesce(t.amount_twd, t.amount)) from ${transactions} t where t.supplier_id = ${suppliers.id}), 0)`,
    })
    .from(suppliers)
    .leftJoin(bankAccounts, eq(bankAccounts.id, suppliers.defaultAccountId))
    .orderBy(desc(suppliers.isActive), suppliers.name);
}

// Current computed book balance per account = opening + inflows - outflows.
export async function listAccountBalances() {
  const db = getDb();
  return db
    .select({
      id: bankAccounts.id,
      name: bankAccounts.name,
      currency: bankAccounts.currency,
      kind: bankAccounts.kind,
      openingBalance: bankAccounts.openingBalance,
      bookBalance: sql<string>`(
        ${bankAccounts.openingBalance}
        + coalesce((select sum(t.amount) from ${transactions} t where t.to_account_id = ${bankAccounts.id}), 0)
        - coalesce((select sum(t.amount) from ${transactions} t where t.from_account_id = ${bankAccounts.id}), 0)
      )`,
      lastReconciledAt: sql<string | null>`(select max(r.as_of_date) from ${accountReconciliations} r where r.account_id = ${bankAccounts.id})`,
    })
    .from(bankAccounts)
    .where(eq(bankAccounts.isActive, true))
    .orderBy(bankAccounts.name);
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
      bookBalance: sql<string>`(
        ${bankAccounts.openingBalance}
        + coalesce((select sum(t.amount) from ${transactions} t where t.to_account_id = ${accountReconciliations.accountId} and t.txn_date <= ${accountReconciliations.asOfDate}), 0)
        - coalesce((select sum(t.amount) from ${transactions} t where t.from_account_id = ${accountReconciliations.accountId} and t.txn_date <= ${accountReconciliations.asOfDate}), 0)
      )`,
    })
    .from(accountReconciliations)
    .leftJoin(bankAccounts, eq(bankAccounts.id, accountReconciliations.accountId))
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

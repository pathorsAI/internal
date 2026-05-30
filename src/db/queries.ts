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
    })
    .from(transactions)
    .leftJoin(categories, eq(categories.id, transactions.categoryId))
    .leftJoin(fromAcct, eq(fromAcct.id, transactions.fromAccountId))
    .leftJoin(toAcct, eq(toAcct.id, transactions.toAccountId))
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

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
  projects,
  subscriptions,
  contracts,
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

export async function listTransactions(
  orgId: string,
  filters: TxnFilters = {},
  limit = 100,
) {
  const { book, categoryId, accountId, projectId, period } = filters;
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
    .where(
      and(
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
      ),
    )
    .orderBy(desc(transactions.txnDate), desc(transactions.id))
    .limit(limit);

  return rows;
}

// 有交易的年月清單（新到舊），給篩選下拉用
export async function listTransactionMonths(orgId: string): Promise<string[]> {
  const db = getDb();
  const rows = await db
    .selectDistinct({ ym: sql<string>`to_char(${transactions.txnDate}, 'YYYY-MM')`.as("ym") })
    .from(transactions)
    .where(eq(transactions.organizationId, orgId));
  return rows
    .map((r) => r.ym)
    .filter((ym): ym is string => !!ym)
    .sort()
    .reverse();
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
      and(eq(documents.organizationId, orgId), eq(documents.invoiceKind, "paper")),
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
        sql`NOT EXISTS (SELECT 1 FROM ${transactions} r WHERE r.related_to_id = ${transactions.id})`,
      ),
    )
    .orderBy(desc(transactions.txnDate));
}

export async function listInvoices(orgId: string, limit = 100) {
  const db = getDb();
  return db
    .select()
    .from(invoices)
    .where(eq(invoices.organizationId, orgId))
    .orderBy(desc(invoices.invoiceDate), desc(invoices.id))
    .limit(limit);
}

export async function listBankAccounts(orgId: string) {
  const db = getDb();
  return db
    .select()
    .from(bankAccounts)
    .where(eq(bankAccounts.organizationId, orgId))
    .orderBy(desc(bankAccounts.isActive), bankAccounts.name);
}

export async function listEmployees(orgId: string, limit = 200) {
  const db = getDb();
  return db
    .select()
    .from(employees)
    .where(eq(employees.organizationId, orgId))
    .orderBy(desc(employees.isActive), employees.name)
    .limit(limit);
}

export async function listParties(orgId: string) {
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
    .where(eq(parties.organizationId, orgId))
    .orderBy(desc(parties.isActive), parties.name);
}

export async function getParty(orgId: string, id: number) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(parties)
    .where(and(eq(parties.organizationId, orgId), eq(parties.id, id)))
    .limit(1);
  return row ?? null;
}

export async function getBankAccount(orgId: string, id: number) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(bankAccounts)
    .where(and(eq(bankAccounts.organizationId, orgId), eq(bankAccounts.id, id)))
    .limit(1);
  return row ?? null;
}

export async function getEmployee(orgId: string, id: number) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(employees)
    .where(and(eq(employees.organizationId, orgId), eq(employees.id, id)))
    .limit(1);
  return row ?? null;
}

export async function getInvoice(orgId: string, id: number) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(invoices)
    .where(and(eq(invoices.organizationId, orgId), eq(invoices.id, id)))
    .limit(1);
  return row ?? null;
}

export async function getDocument(orgId: string, id: number) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(documents)
    .where(and(eq(documents.organizationId, orgId), eq(documents.id, id)))
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
    .where(and(eq(transactions.organizationId, orgId), eq(transactions.id, id)))
    .limit(1);
  return row ?? null;
}

export async function getPayrollRun(orgId: string, id: number) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(payrollRuns)
    .where(and(eq(payrollRuns.organizationId, orgId), eq(payrollRuns.id, id)))
    .limit(1);
  return row ?? null;
}

export async function listCategories(orgId: string) {
  const db = getDb();
  return db
    .select({ id: categories.id, name: categories.name, kind: categories.kind })
    .from(categories)
    .where(and(eq(categories.organizationId, orgId), eq(categories.isActive, true)))
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
      or(
        eq(transactions.fromAccountId, bankAccounts.id),
        eq(transactions.toAccountId, bankAccounts.id),
      ),
    )
    .where(
      and(
        eq(bankAccounts.organizationId, orgId),
        opts.includeInactive ? undefined : eq(bankAccounts.isActive, true),
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
    .where(eq(accountReconciliations.organizationId, orgId))
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
      ),
    )
    .where(eq(accountReconciliations.organizationId, orgId))
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
    .where(eq(payrollRuns.organizationId, orgId))
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
    .where(eq(payrollRuns.organizationId, orgId))
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
    .leftJoin(transactions, eq(transactions.projectId, projects.id))
    .where(eq(projects.organizationId, orgId))
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
    .where(and(eq(projects.organizationId, orgId), eq(projects.id, id)))
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
    .where(eq(subscriptions.organizationId, orgId))
    .orderBy(desc(subscriptions.createdAt));
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
    .where(eq(contracts.organizationId, orgId))
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
      ),
    )
    .where(eq(contracts.organizationId, orgId))
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

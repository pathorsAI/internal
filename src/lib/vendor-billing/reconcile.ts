import { and, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { paymentMethods, transactions, vendorBillingAccounts, vendorInvoices } from "@/db/schema";
import { matchPartiesOf, parseRejectedTransactionIds } from "./account-meta";
import {
  addDays,
  GROUP_WINDOW_DAYS,
  invoicesDueForCreation,
  reconcileInvoices,
  type LedgerMode,
  type MatchInvoice,
  type MatchStatus,
  type MatchTransaction,
  type MatchUpdate,
} from "./match";
import { taipeiToday } from "./sync-plan";

/**
 * 對帳的 DB 端：讀本組織的發票與候選交易 → 跑 match.ts 的純函式 → 寫回狀態；
 * ledger_mode = create_unmatched 的帳號再把過了寬限期仍對不到的發票建成待確認支出。
 *
 * 每次同步後都會跑，也可以從頁面 / MCP 手動觸發。只寫本組織的 vendor_invoices 與 transactions。
 */

type Db = ReturnType<typeof getDb>;

export type ReconcileResult = {
  matched: number;
  suggested: number;
  unmatched: number;
  created: number;
};

type AccountRow = {
  id: number;
  provider: string;
  displayName: string;
  partyId: number | null;
  meta: Record<string, unknown>;
  ledgerMode: string;
  paymentMethodId: number | null;
};

async function loadAccounts(db: Db, orgId: string): Promise<AccountRow[]> {
  return db
    .select({
      id: vendorBillingAccounts.id,
      provider: vendorBillingAccounts.provider,
      displayName: vendorBillingAccounts.displayName,
      partyId: vendorBillingAccounts.partyId,
      meta: vendorBillingAccounts.meta,
      ledgerMode: vendorBillingAccounts.ledgerMode,
      paymentMethodId: vendorBillingAccounts.paymentMethodId,
    })
    .from(vendorBillingAccounts)
    .where(and(eq(vendorBillingAccounts.organizationId, orgId), isNull(vendorBillingAccounts.deletedAt)));
}

export type InvoiceForLedger = {
  id: number;
  billingAccountId: number;
  externalRef: string;
  source: string;
  invoiceDate: string;
  periodStart: string | null;
  periodEnd: string | null;
  amount: number;
  currency: string;
};

const PROVIDER_NAME: Record<string, string> = { azure: "Azure", gcp: "Google Cloud" };

/**
 * 為一張發票建一筆待確認支出（create_unmatched 到期、或人工按「建立交易」）。
 * 以 (org, 'azure' | 'gcp', 發票 external_ref) 去重（migrations/0026 的唯一索引，ON CONFLICT DO NOTHING）：
 * - 新建成功 → 發票標 created 並綁上去
 * - 已經有一筆（之前建過）且沒刪 → 綁上去
 * - 之前建過但被刪掉了 → 尊重刪除，發票標 ignored，不再長回來
 */
export async function createLedgerTransactionForInvoice(
  db: Db,
  orgId: string,
  invoice: InvoiceForLedger,
  account: Pick<AccountRow, "provider" | "displayName" | "partyId" | "paymentMethodId">,
  partyId: number,
): Promise<{ status: "created" | "linked" | "deleted"; transactionId: number | null }> {
  const externalSource = invoice.source === "gcp_bigquery" ? "gcp" : "azure";
  let fromAccountId: number | null = null;
  if (account.paymentMethodId !== null) {
    const [pm] = await db
      .select({ settles: paymentMethods.settlesFromAccountId })
      .from(paymentMethods)
      .where(and(eq(paymentMethods.id, account.paymentMethodId), eq(paymentMethods.organizationId, orgId)))
      .limit(1);
    fromAccountId = pm?.settles ?? null;
  }
  const amount = invoice.amount.toFixed(2);
  const period = invoice.periodStart && invoice.periodEnd ? `（${invoice.periodStart}～${invoice.periodEnd}）` : "";
  const inserted = await db
    .insert(transactions)
    .values({
      organizationId: orgId,
      type: "expense",
      txnDate: invoice.invoiceDate,
      description: `${PROVIDER_NAME[account.provider] ?? account.provider} ${account.displayName} 帳單 ${invoice.externalRef}${period}`,
      categoryId: null,
      partyId,
      amount,
      currency: invoice.currency,
      amountTwd: invoice.currency === "TWD" ? amount : null,
      fromAccountId,
      book: "internal",
      billedToCompanyTaxId: false,
      externalSource,
      externalRef: invoice.externalRef,
      externalMeta: {
        vendorInvoiceId: invoice.id,
        billingAccountId: invoice.billingAccountId,
        billingAccount: account.displayName,
        periodStart: invoice.periodStart,
        periodEnd: invoice.periodEnd,
        source: invoice.source,
      },
      needsReview: true,
    })
    .onConflictDoNothing()
    .returning({ id: transactions.id });

  let txnId = inserted[0]?.id ?? null;
  let status: "created" | "linked" | "deleted" = "created";
  if (txnId === null) {
    const [existing] = await db
      .select({ id: transactions.id, deletedAt: transactions.deletedAt })
      .from(transactions)
      .where(
        and(
          eq(transactions.organizationId, orgId),
          eq(transactions.externalSource, externalSource),
          eq(transactions.externalRef, invoice.externalRef),
        ),
      )
      .limit(1);
    if (existing && !existing.deletedAt) {
      txnId = existing.id;
      status = "linked";
    } else {
      status = "deleted";
    }
  }
  await db
    .update(vendorInvoices)
    .set(
      txnId === null
        ? { matchStatus: "ignored", suggestedTransactionId: null, updatedAt: sql`now()` }
        : {
            matchStatus: "created",
            matchedTransactionId: txnId,
            suggestedTransactionId: null,
            matchedAt: sql`now()`,
            updatedAt: sql`now()`,
          },
    )
    .where(and(eq(vendorInvoices.id, invoice.id), eq(vendorInvoices.organizationId, orgId)));
  return { status, transactionId: txnId };
}

type LoadedInvoice = MatchInvoice & InvoiceForLedger;

async function loadInvoices(db: Db, orgId: string, partiesOf: Map<number, number[]>): Promise<LoadedInvoice[]> {
  const rows = await db
    .select({
      id: vendorInvoices.id,
      billingAccountId: vendorInvoices.billingAccountId,
      externalRef: vendorInvoices.externalRef,
      source: vendorInvoices.source,
      invoiceDate: vendorInvoices.invoiceDate,
      periodStart: vendorInvoices.periodStart,
      periodEnd: vendorInvoices.periodEnd,
      amount: vendorInvoices.amount,
      currency: vendorInvoices.currency,
      matchStatus: vendorInvoices.matchStatus,
      matchedTransactionId: vendorInvoices.matchedTransactionId,
      suggestedTransactionId: vendorInvoices.suggestedTransactionId,
      meta: vendorInvoices.meta,
    })
    .from(vendorInvoices)
    .where(and(eq(vendorInvoices.organizationId, orgId), inArray(vendorInvoices.billingAccountId, [...partiesOf.keys()])));
  return rows.map(({ meta, ...r }) => ({
    ...r,
    rejectedTransactionIds: parseRejectedTransactionIds(meta),
    amount: Number(r.amount),
    currency: r.currency.trim().toUpperCase(),
    matchStatus: r.matchStatus as MatchStatus,
    partyIds: partiesOf.get(r.billingAccountId) ?? [],
  }));
}

/** 候選交易：比對廠商的未刪除支出，日期涵蓋所有未定發票的視窗（含合併比對的 75 天）。 */
async function loadCandidateTransactions(db: Db, orgId: string, open: LoadedInvoice[], parties: number[]): Promise<MatchTransaction[]> {
  const dates = open.map((i) => i.invoiceDate).sort((a, b) => a.localeCompare(b));
  const rows = await db
    .select({
      id: transactions.id,
      partyId: transactions.partyId,
      txnDate: transactions.txnDate,
      amount: transactions.amount,
      currency: transactions.currency,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.organizationId, orgId),
        eq(transactions.type, "expense"),
        isNull(transactions.deletedAt),
        inArray(transactions.partyId, parties),
        gte(transactions.txnDate, dates[0]),
        lte(transactions.txnDate, addDays(dates.at(-1) as string, GROUP_WINDOW_DAYS)),
      ),
    );
  return rows.map((t) => ({ ...t, amount: Number(t.amount), currency: t.currency.trim().toUpperCase() }));
}

/** 寫回狀態有變的發票（跑的途中有人手動處理過的不蓋掉），並同步更新記憶體裡的發票。 */
async function applyUpdates(
  db: Db,
  orgId: string,
  invoices: LoadedInvoice[],
  updates: MatchUpdate[],
  result: ReconcileResult,
): Promise<void> {
  const byId = new Map(invoices.map((i) => [i.id, i]));
  for (const u of updates) {
    await db
      .update(vendorInvoices)
      .set({
        matchStatus: u.matchStatus,
        matchedTransactionId: u.matchedTransactionId,
        suggestedTransactionId: u.suggestedTransactionId,
        matchedAt: u.matchStatus === "matched" ? sql`now()` : null,
        meta: sql`${vendorInvoices.meta} || ${JSON.stringify({ matchReason: u.reason })}::jsonb`,
        updatedAt: sql`now()`,
      })
      .where(
        and(
          eq(vendorInvoices.id, u.invoiceId),
          eq(vendorInvoices.organizationId, orgId),
          inArray(vendorInvoices.matchStatus, ["unmatched", "suggested"]),
        ),
      );
    const inv = byId.get(u.invoiceId);
    if (inv) {
      inv.matchStatus = u.matchStatus;
      inv.matchedTransactionId = u.matchedTransactionId;
      inv.suggestedTransactionId = u.suggestedTransactionId;
    }
    result[u.matchStatus]++;
  }
}

/** create_unmatched：過了寬限期仍對不到 → 建待確認支出（match_only 永遠不會走到這裡）。 */
async function createDueTransactions(
  db: Db,
  orgId: string,
  invoices: LoadedInvoice[],
  accountById: Map<number, AccountRow>,
  today: string,
): Promise<number> {
  const due = invoicesDueForCreation(invoices, (id) => (accountById.get(id)?.ledgerMode as LedgerMode) ?? "match_only", today);
  let created = 0;
  for (const inv of due) {
    const account = accountById.get(inv.billingAccountId);
    const partyId = account?.partyId ?? inv.partyIds[0];
    if (!account || !partyId) continue;
    const r = await createLedgerTransactionForInvoice(db, orgId, inv, account, partyId);
    if (r.status === "created") created++;
  }
  return created;
}

/** 跑一次對帳（today 預設台北今天）。 */
export async function reconcileVendorInvoices(orgId: string, opts: { today?: string } = {}): Promise<ReconcileResult> {
  const db = getDb();
  const today = opts.today ?? taipeiToday();
  const result: ReconcileResult = { matched: 0, suggested: 0, unmatched: 0, created: 0 };

  const accounts = await loadAccounts(db, orgId);
  if (accounts.length > 0) {
    const accountById = new Map(accounts.map((a) => [a.id, a]));
    const partiesOf = new Map(accounts.map((a) => [a.id, matchPartiesOf(a)]));
    const allParties = [...new Set([...partiesOf.values()].flat())];
    const invoices = await loadInvoices(db, orgId, partiesOf);
    const open = invoices.filter((i) => (i.matchStatus === "unmatched" || i.matchStatus === "suggested") && i.partyIds.length > 0);
    if (open.length > 0 && allParties.length > 0) {
      const txns = await loadCandidateTransactions(db, orgId, open, allParties);
      await applyUpdates(db, orgId, invoices, reconcileInvoices(invoices, txns), result);
    }
    result.created = await createDueTransactions(db, orgId, invoices, accountById, today);
  }
  return result;
}

import { and, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { user } from "@/db/auth-schema";
import {
  bankAccounts,
  parties,
  paymentMethods,
  transactions,
  vendorBillingAccounts,
  vendorBillingResources,
  vendorCostLines,
  vendorInvoices,
} from "@/db/schema";
import { matchPartiesOf, parseMatchPartyIds, parseRejectedTransactionIds, withRejected } from "./account-meta";
import { computeAttention, type AttentionItem } from "./attention";
import { assertOrgRefs, billingAccountRefs, invoiceResolutionRefs, paymentMethodRefs } from "./guards";
import {
  forbiddenSyncedFields,
  SYNCED_ACCOUNT_EDITABLE,
  SYNCED_PAYMENT_METHOD_EDITABLE,
  VendorBillingInputError,
  type BillingAccountPatch,
  type InvoiceAction,
  type PaymentMethodPatch,
} from "./inputs";
import { addDays, GROUP_WINDOW_DAYS, type MatchStatus } from "./match";
import { createLedgerTransactionForInvoice } from "./reconcile";
import { taipeiToday } from "./sync-plan";

/**
 * 廠商計費的讀寫（server only）。web server action 與 MCP 工具共用這一層：
 * - 每個查詢 / 寫入都帶 orgId（呼叫端從 requireOrg / resolveOrg 拿到，不是使用者輸入）。
 * - 寫入前一律 assertOrgRefs：帶進來的 party / 付款方式 / 帳本帳戶 / 負責人 / 交易都必須屬於同組織。
 * - 角色檢查（owner / admin）在呼叫端：web 的 actions.ts 與 MCP 工具各自先擋。
 * - 回傳值不含任何整合憑證（這層根本不碰 org_integrations 的密文）。
 */

type Db = ReturnType<typeof getDb>;

const num = (v: string | number | null | undefined) => (v === null || v === undefined ? null : Number(v));

/** `in ()` 不能是空的：空清單換成一個不存在的 id（0），查不到任何列。 */
const nonEmptyIds = (ids: number[]) => (ids.length > 0 ? ids : [0]);

// ---------------------------------------------------------------------------
// 型別
// ---------------------------------------------------------------------------

export type PaymentMethodBrief = {
  id: number;
  label: string;
  kind: string;
  last4: string | null;
  expiryMonth: number | null;
  expiryYear: number | null;
  source: string;
  isActive: boolean;
};

export type BillingAccountRow = {
  id: number;
  provider: string;
  externalId: string | null;
  displayName: string;
  source: string;
  status: string;
  ledgerMode: string;
  partyId: number | null;
  partyName: string | null;
  matchPartyIds: number[];
  paymentMethod: PaymentMethodBrief | null;
  ownerUserId: string | null;
  ownerName: string | null;
  lastVerifiedAt: string | null;
  lastSeenAt: string | null;
  meta: Record<string, unknown>;
  note: string | null;
  resourceCount: number;
  missingResourceCount: number;
  openInvoiceCount: number;
  latestInvoice: { invoiceDate: string; amount: number; currency: string; matchStatus: string } | null;
  createdAt: string;
  updatedAt: string;
};

export type ResourceRow = {
  id: number;
  billingAccountId: number;
  kind: string;
  externalId: string;
  name: string | null;
  labels: Record<string, string>;
  status: string;
  lastSeenAt: string | null;
  updatedAt: string;
};

export type TxnBrief = {
  id: number;
  txnDate: string;
  amount: number;
  currency: string;
  description: string | null;
  partyName: string | null;
};

export type InvoiceRow = {
  id: number;
  billingAccountId: number;
  accountName: string;
  provider: string;
  externalRef: string;
  source: string;
  invoiceDate: string;
  periodStart: string | null;
  periodEnd: string | null;
  amount: number;
  currency: string;
  status: string | null;
  amountDue: number | null;
  matchStatus: MatchStatus;
  matchReason: string | null;
  matchedTransaction: TxnBrief | null;
  suggestedTransaction: TxnBrief | null;
};

export type PaymentMethodRow = PaymentMethodBrief & {
  brand: string | null;
  holderName: string | null;
  settlesFromAccountId: number | null;
  settlesFromAccountName: string | null;
  note: string | null;
  accounts: { id: number; displayName: string; provider: string; status: string }[];
  updatedAt: string;
};

// ---------------------------------------------------------------------------
// 讀
// ---------------------------------------------------------------------------

const pmBrief = {
  id: paymentMethods.id,
  label: paymentMethods.label,
  kind: paymentMethods.kind,
  last4: paymentMethods.last4,
  expiryMonth: paymentMethods.expiryMonth,
  expiryYear: paymentMethods.expiryYear,
  source: paymentMethods.source,
  isActive: paymentMethods.isActive,
};

export async function listBillingAccounts(
  orgId: string,
  filter: { provider?: string; status?: string; ids?: number[] } = {},
): Promise<BillingAccountRow[]> {
  const db = getDb();
  const rows = await db
    .select({
      a: vendorBillingAccounts,
      partyName: parties.name,
      ownerName: sql<string | null>`coalesce(nullif(${user.name}, ''), ${user.email})`,
      pm: pmBrief,
    })
    .from(vendorBillingAccounts)
    .leftJoin(parties, and(eq(parties.id, vendorBillingAccounts.partyId), eq(parties.organizationId, orgId)))
    .leftJoin(user, eq(user.id, vendorBillingAccounts.ownerUserId))
    .leftJoin(
      paymentMethods,
      and(
        eq(paymentMethods.id, vendorBillingAccounts.paymentMethodId),
        eq(paymentMethods.organizationId, orgId),
        isNull(paymentMethods.deletedAt),
      ),
    )
    .where(
      and(
        eq(vendorBillingAccounts.organizationId, orgId),
        isNull(vendorBillingAccounts.deletedAt),
        filter.provider ? eq(vendorBillingAccounts.provider, filter.provider) : undefined,
        filter.status ? eq(vendorBillingAccounts.status, filter.status) : undefined,
        filter.ids ? inArray(vendorBillingAccounts.id, nonEmptyIds(filter.ids)) : undefined,
      ),
    )
    .orderBy(vendorBillingAccounts.provider, vendorBillingAccounts.displayName);
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.a.id);

  const [resCounts, invStats, latest] = await Promise.all([
    db
      .select({
        id: vendorBillingResources.billingAccountId,
        total: sql<number>`count(*)::int`,
        missing: sql<number>`count(*) filter (where ${vendorBillingResources.status} = 'missing')::int`,
      })
      .from(vendorBillingResources)
      .where(and(eq(vendorBillingResources.organizationId, orgId), inArray(vendorBillingResources.billingAccountId, ids)))
      .groupBy(vendorBillingResources.billingAccountId),
    db
      .select({
        id: vendorInvoices.billingAccountId,
        open: sql<number>`count(*) filter (where ${vendorInvoices.matchStatus} in ('unmatched','suggested'))::int`,
      })
      .from(vendorInvoices)
      .where(and(eq(vendorInvoices.organizationId, orgId), inArray(vendorInvoices.billingAccountId, ids)))
      .groupBy(vendorInvoices.billingAccountId),
    db
      .selectDistinctOn([vendorInvoices.billingAccountId], {
        id: vendorInvoices.billingAccountId,
        invoiceDate: vendorInvoices.invoiceDate,
        amount: vendorInvoices.amount,
        currency: vendorInvoices.currency,
        matchStatus: vendorInvoices.matchStatus,
      })
      .from(vendorInvoices)
      .where(and(eq(vendorInvoices.organizationId, orgId), inArray(vendorInvoices.billingAccountId, ids)))
      .orderBy(vendorInvoices.billingAccountId, desc(vendorInvoices.invoiceDate)),
  ]);
  const resMap = new Map(resCounts.map((r) => [r.id, r]));
  const invMap = new Map(invStats.map((r) => [r.id, r]));
  const latestMap = new Map(latest.map((r) => [r.id, r]));

  return rows.map(({ a, partyName, ownerName, pm }) => {
    const l = latestMap.get(a.id);
    return {
      id: a.id,
      provider: a.provider,
      externalId: a.externalId,
      displayName: a.displayName,
      source: a.source,
      status: a.status,
      ledgerMode: a.ledgerMode,
      partyId: a.partyId,
      partyName: partyName ?? null,
      matchPartyIds: parseMatchPartyIds(a.meta),
      paymentMethod: pm?.id ? pm : null,
      ownerUserId: a.ownerUserId,
      ownerName: a.ownerUserId ? (ownerName ?? null) : null,
      lastVerifiedAt: a.lastVerifiedAt,
      lastSeenAt: a.lastSeenAt,
      meta: a.meta ?? {},
      note: a.note,
      resourceCount: resMap.get(a.id)?.total ?? 0,
      missingResourceCount: resMap.get(a.id)?.missing ?? 0,
      openInvoiceCount: invMap.get(a.id)?.open ?? 0,
      latestInvoice: l
        ? { invoiceDate: l.invoiceDate, amount: Number(l.amount), currency: l.currency.trim(), matchStatus: l.matchStatus }
        : null,
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
    };
  });
}

export async function listResources(orgId: string, billingAccountIds?: number[]): Promise<ResourceRow[]> {
  const rows = await getDb()
    .select({
      id: vendorBillingResources.id,
      billingAccountId: vendorBillingResources.billingAccountId,
      kind: vendorBillingResources.kind,
      externalId: vendorBillingResources.externalId,
      name: vendorBillingResources.name,
      labels: vendorBillingResources.labels,
      status: vendorBillingResources.status,
      lastSeenAt: vendorBillingResources.lastSeenAt,
      updatedAt: vendorBillingResources.updatedAt,
    })
    .from(vendorBillingResources)
    .where(
      and(
        eq(vendorBillingResources.organizationId, orgId),
        billingAccountIds ? inArray(vendorBillingResources.billingAccountId, nonEmptyIds(billingAccountIds)) : undefined,
      ),
    )
    .orderBy(vendorBillingResources.status, vendorBillingResources.name);
  return rows.map((r) => ({ ...r, labels: r.labels ?? {} }));
}

async function txnBriefs(db: Db, orgId: string, ids: number[]): Promise<Map<number, TxnBrief>> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return new Map();
  const rows = await db
    .select({
      id: transactions.id,
      txnDate: transactions.txnDate,
      amount: transactions.amount,
      currency: transactions.currency,
      description: transactions.description,
      partyName: parties.name,
    })
    .from(transactions)
    .leftJoin(parties, eq(parties.id, transactions.partyId))
    .where(and(eq(transactions.organizationId, orgId), inArray(transactions.id, unique)));
  return new Map(
    rows.map((r) => [
      r.id,
      { ...r, amount: Number(r.amount), currency: r.currency.trim(), partyName: r.partyName ?? null },
    ]),
  );
}

export async function listVendorInvoices(
  orgId: string,
  filter: { matchStatus?: MatchStatus[]; billingAccountId?: number; limit?: number } = {},
): Promise<InvoiceRow[]> {
  const db = getDb();
  const rows = await db
    .select({
      i: vendorInvoices,
      accountName: vendorBillingAccounts.displayName,
      provider: vendorBillingAccounts.provider,
    })
    .from(vendorInvoices)
    .innerJoin(
      vendorBillingAccounts,
      and(eq(vendorBillingAccounts.id, vendorInvoices.billingAccountId), eq(vendorBillingAccounts.organizationId, orgId)),
    )
    .where(
      and(
        eq(vendorInvoices.organizationId, orgId),
        isNull(vendorBillingAccounts.deletedAt),
        filter.matchStatus?.length ? inArray(vendorInvoices.matchStatus, filter.matchStatus) : undefined,
        filter.billingAccountId ? eq(vendorInvoices.billingAccountId, filter.billingAccountId) : undefined,
      ),
    )
    .orderBy(desc(vendorInvoices.invoiceDate), desc(vendorInvoices.id))
    .limit(Math.min(Math.max(filter.limit ?? 200, 1), 500));
  const briefs = await txnBriefs(
    db,
    orgId,
    rows.flatMap((r) => [r.i.matchedTransactionId, r.i.suggestedTransactionId]).filter((x): x is number => x !== null),
  );
  return rows.map(({ i, accountName, provider }) => ({
    id: i.id,
    billingAccountId: i.billingAccountId,
    accountName,
    provider,
    externalRef: i.externalRef,
    source: i.source,
    invoiceDate: i.invoiceDate,
    periodStart: i.periodStart,
    periodEnd: i.periodEnd,
    amount: Number(i.amount),
    currency: i.currency.trim(),
    status: i.status,
    amountDue: num(i.meta?.amountDue as number | null | undefined),
    matchStatus: i.matchStatus as MatchStatus,
    matchReason: typeof i.meta?.matchReason === "string" ? i.meta.matchReason : null,
    matchedTransaction: i.matchedTransactionId ? (briefs.get(i.matchedTransactionId) ?? null) : null,
    suggestedTransaction: i.suggestedTransactionId ? (briefs.get(i.suggestedTransactionId) ?? null) : null,
  }));
}

export async function listPaymentMethods(orgId: string): Promise<PaymentMethodRow[]> {
  const db = getDb();
  const rows = await db
    .select({
      pm: paymentMethods,
      accountName: bankAccounts.name,
    })
    .from(paymentMethods)
    .leftJoin(
      bankAccounts,
      and(eq(bankAccounts.id, paymentMethods.settlesFromAccountId), eq(bankAccounts.organizationId, orgId)),
    )
    .where(and(eq(paymentMethods.organizationId, orgId), isNull(paymentMethods.deletedAt)))
    .orderBy(desc(paymentMethods.isActive), paymentMethods.label);
  const accounts = await db
    .select({
      id: vendorBillingAccounts.id,
      displayName: vendorBillingAccounts.displayName,
      provider: vendorBillingAccounts.provider,
      status: vendorBillingAccounts.status,
      paymentMethodId: vendorBillingAccounts.paymentMethodId,
    })
    .from(vendorBillingAccounts)
    .where(and(eq(vendorBillingAccounts.organizationId, orgId), isNull(vendorBillingAccounts.deletedAt)));
  return rows.map(({ pm, accountName }) => ({
    id: pm.id,
    label: pm.label,
    kind: pm.kind,
    last4: pm.last4,
    expiryMonth: pm.expiryMonth,
    expiryYear: pm.expiryYear,
    source: pm.source,
    isActive: pm.isActive,
    brand: pm.brand,
    holderName: pm.holderName,
    settlesFromAccountId: pm.settlesFromAccountId,
    settlesFromAccountName: accountName ?? null,
    note: pm.note,
    accounts: accounts
      .filter((a) => a.paymentMethodId === pm.id)
      .map(({ id, displayName, provider, status }) => ({ id, displayName, provider, status })),
    updatedAt: pm.updatedAt,
  }));
}

/** 最近幾個月的費用（每月 × 幣別合計）；純分析資料。 */
export async function costByMonth(
  orgId: string,
  billingAccountId: number,
  months = 6,
): Promise<{ month: string; currency: string; amount: number }[]> {
  const rows = await getDb()
    .select({
      month: vendorCostLines.month,
      currency: vendorCostLines.currency,
      amount: sql<string>`sum(${vendorCostLines.amount})`,
    })
    .from(vendorCostLines)
    .where(and(eq(vendorCostLines.organizationId, orgId), eq(vendorCostLines.billingAccountId, billingAccountId)))
    .groupBy(vendorCostLines.month, vendorCostLines.currency)
    .orderBy(desc(vendorCostLines.month))
    .limit(months * 2);
  return rows.map((r) => ({ month: r.month, currency: r.currency.trim(), amount: Math.round(Number(r.amount) * 100) / 100 }));
}

export async function getBillingAccount(orgId: string, id: number) {
  const [account] = await listBillingAccounts(orgId, { ids: [id] });
  if (!account) return null;
  const [resources, invoices, costs] = await Promise.all([
    listResources(orgId, [id]),
    listVendorInvoices(orgId, { billingAccountId: id, limit: 24 }),
    costByMonth(orgId, id),
  ]);
  return { account, resources, invoices, costs };
}

/** 手動綁定時可以挑的交易：比對廠商的支出，在發票日前 15 天～後 75 天；沒有比對廠商就列全部支出。 */
export async function listLinkCandidates(orgId: string, invoiceId: number): Promise<TxnBrief[]> {
  const db = getDb();
  const [row] = await db
    .select({ inv: vendorInvoices, partyId: vendorBillingAccounts.partyId, meta: vendorBillingAccounts.meta })
    .from(vendorInvoices)
    .innerJoin(vendorBillingAccounts, eq(vendorBillingAccounts.id, vendorInvoices.billingAccountId))
    .where(and(eq(vendorInvoices.id, invoiceId), eq(vendorInvoices.organizationId, orgId)))
    .limit(1);
  if (!row) throw new VendorBillingInputError(`找不到帳單 ${invoiceId}`);
  const partyIds = matchPartiesOf({ partyId: row.partyId, meta: row.meta });
  const rows = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(
      and(
        eq(transactions.organizationId, orgId),
        eq(transactions.type, "expense"),
        isNull(transactions.deletedAt),
        partyIds.length ? inArray(transactions.partyId, partyIds) : undefined,
        gte(transactions.txnDate, addDays(row.inv.invoiceDate, -15)),
        lte(transactions.txnDate, addDays(row.inv.invoiceDate, GROUP_WINDOW_DAYS)),
      ),
    )
    .orderBy(transactions.txnDate)
    .limit(50);
  const briefs = await txnBriefs(db, orgId, rows.map((r) => r.id));
  return rows.map((r) => briefs.get(r.id)).filter((x): x is TxnBrief => Boolean(x));
}

export async function getAttention(orgId: string, today = taipeiToday()): Promise<AttentionItem[]> {
  const db = getDb();
  const [pms, accounts, resources, invoices] = await Promise.all([
    db
      .select({
        id: paymentMethods.id,
        label: paymentMethods.label,
        kind: paymentMethods.kind,
        isActive: paymentMethods.isActive,
        expiryMonth: paymentMethods.expiryMonth,
        expiryYear: paymentMethods.expiryYear,
      })
      .from(paymentMethods)
      .where(and(eq(paymentMethods.organizationId, orgId), isNull(paymentMethods.deletedAt))),
    db
      .select({
        id: vendorBillingAccounts.id,
        displayName: vendorBillingAccounts.displayName,
        provider: vendorBillingAccounts.provider,
        source: vendorBillingAccounts.source,
        status: vendorBillingAccounts.status,
        paymentMethodId: vendorBillingAccounts.paymentMethodId,
        lastVerifiedAt: vendorBillingAccounts.lastVerifiedAt,
        updatedAt: vendorBillingAccounts.updatedAt,
        meta: vendorBillingAccounts.meta,
      })
      .from(vendorBillingAccounts)
      .where(and(eq(vendorBillingAccounts.organizationId, orgId), isNull(vendorBillingAccounts.deletedAt))),
    listResources(orgId),
    db
      .select({
        id: vendorInvoices.id,
        billingAccountId: vendorInvoices.billingAccountId,
        externalRef: vendorInvoices.externalRef,
        invoiceDate: vendorInvoices.invoiceDate,
        amount: vendorInvoices.amount,
        currency: vendorInvoices.currency,
        matchStatus: vendorInvoices.matchStatus,
        status: vendorInvoices.status,
        meta: vendorInvoices.meta,
      })
      .from(vendorInvoices)
      .where(eq(vendorInvoices.organizationId, orgId)),
  ]);
  const live = new Set(accounts.map((a) => a.id));
  return computeAttention({
    today,
    paymentMethods: pms,
    accounts: accounts.map(({ meta, ...a }) => ({
      ...a,
      cardConflict: typeof meta?.paymentMethodConflict === "string" ? meta.paymentMethodConflict : null,
    })),
    resources: resources.filter((r) => live.has(r.billingAccountId)),
    invoices: invoices
      .filter((i) => live.has(i.billingAccountId))
      .map((i) => ({
        id: i.id,
        billingAccountId: i.billingAccountId,
        externalRef: i.externalRef,
        invoiceDate: i.invoiceDate,
        amount: Number(i.amount),
        currency: i.currency.trim(),
        matchStatus: i.matchStatus as MatchStatus,
        providerStatus: i.status,
        amountDue: num(i.meta?.amountDue as number | null | undefined),
      })),
  });
}

// ---------------------------------------------------------------------------
// 寫（角色檢查在呼叫端）
// ---------------------------------------------------------------------------

async function loadAccount(db: Db, orgId: string, id: number) {
  const [row] = await db
    .select()
    .from(vendorBillingAccounts)
    .where(
      and(eq(vendorBillingAccounts.id, id), eq(vendorBillingAccounts.organizationId, orgId), isNull(vendorBillingAccounts.deletedAt)),
    )
    .limit(1);
  if (!row) throw new VendorBillingInputError(`找不到計費帳號 ${id}`);
  return row;
}

async function insertBillingAccount(db: Db, orgId: string, patch: BillingAccountPatch): Promise<number> {
  const [row] = await db
    .insert(vendorBillingAccounts)
    .values({
      organizationId: orgId,
      provider: patch.provider as string,
      externalId: patch.externalId ?? null,
      displayName: patch.displayName as string,
      partyId: patch.partyId ?? null,
      paymentMethodId: patch.paymentMethodId ?? null,
      ownerUserId: patch.ownerUserId ?? null,
      ledgerMode: patch.ledgerMode ?? "match_only",
      status: patch.status ?? "active",
      source: "manual",
      lastVerifiedAt: sql`now()`,
      meta: patch.matchPartyIds ? { matchPartyIds: patch.matchPartyIds } : {},
      note: patch.note ?? null,
    })
    .onConflictDoNothing()
    .returning({ id: vendorBillingAccounts.id });
  if (!row) throw new VendorBillingInputError("這個平台上的帳號 ID 已經登記過了");
  return row.id;
}

const ACCOUNT_COLUMNS = [
  "provider",
  "externalId",
  "displayName",
  "partyId",
  "paymentMethodId",
  "ownerUserId",
  "ledgerMode",
  "status",
  "note",
] as const;

/** 只放有傳的欄位；matchPartyIds 寫進 meta（jsonb 合併，不動 meta 的其他鍵）。 */
function accountUpdateSet(patch: BillingAccountPatch): Record<string, unknown> {
  const set: Record<string, unknown> = { updatedAt: sql`now()` };
  for (const k of ACCOUNT_COLUMNS) if (patch[k] !== undefined) set[k] = patch[k];
  if (patch.matchPartyIds !== undefined) {
    set.meta = sql`${vendorBillingAccounts.meta} || ${JSON.stringify({ matchPartyIds: patch.matchPartyIds })}::jsonb`;
  }
  return set;
}

/** 新增或修改計費帳號，回傳 id。同步來的帳號只能改 party / 比對廠商 / 付款方式 / 負責人 / 入帳模式 / 備註。 */
export async function upsertBillingAccount(orgId: string, patch: BillingAccountPatch): Promise<{ id: number; created: boolean }> {
  const db = getDb();
  await assertOrgRefs(orgId, {
    ...billingAccountRefs(patch),
    party: [patch.partyId, ...(patch.matchPartyIds ?? [])],
  });
  if (patch.id === null) return { id: await insertBillingAccount(db, orgId, patch), created: true };

  const current = await loadAccount(db, orgId, patch.id);
  if (current.source === "synced") {
    const bad = forbiddenSyncedFields(patch, SYNCED_ACCOUNT_EDITABLE);
    if (bad.length) throw new VendorBillingInputError(`同步來的帳號不能修改：${bad.join(", ")}（由平台同步決定）`);
  }
  await db
    .update(vendorBillingAccounts)
    .set(accountUpdateSet(patch))
    .where(and(eq(vendorBillingAccounts.id, patch.id), eq(vendorBillingAccounts.organizationId, orgId)));
  return { id: patch.id, created: false };
}

/** 手動帳號「確認無誤」：把 last_verified_at 設成現在。 */
export async function verifyBillingAccount(orgId: string, id: number): Promise<void> {
  const db = getDb();
  await loadAccount(db, orgId, id);
  await db
    .update(vendorBillingAccounts)
    .set({ lastVerifiedAt: sql`now()` })
    .where(and(eq(vendorBillingAccounts.id, id), eq(vendorBillingAccounts.organizationId, orgId)));
}

/** 刪除（軟刪）手動登記的帳號；同步來的帳號不能刪（下次同步會長回來），改由設定頁的範圍控制。 */
export async function deleteBillingAccount(orgId: string, id: number): Promise<void> {
  const db = getDb();
  const current = await loadAccount(db, orgId, id);
  if (current.source === "synced") {
    throw new VendorBillingInputError("同步來的帳號不能刪除；不想同步請到 設定 › 整合 取消勾選它");
  }
  await db
    .update(vendorBillingAccounts)
    .set({ deletedAt: sql`now()`, updatedAt: sql`now()` })
    .where(and(eq(vendorBillingAccounts.id, id), eq(vendorBillingAccounts.organizationId, orgId)));
}

export async function upsertPaymentMethod(orgId: string, patch: PaymentMethodPatch): Promise<{ id: number; created: boolean }> {
  const db = getDb();
  await assertOrgRefs(orgId, paymentMethodRefs(patch));
  if (patch.id === null) {
    const [row] = await db
      .insert(paymentMethods)
      .values({
        organizationId: orgId,
        kind: patch.kind as string,
        label: patch.label as string,
        brand: patch.brand ?? null,
        last4: patch.last4 ?? null,
        expiryMonth: patch.expiryMonth ?? null,
        expiryYear: patch.expiryYear ?? null,
        holderName: patch.holderName ?? null,
        settlesFromAccountId: patch.settlesFromAccountId ?? null,
        isActive: patch.isActive ?? true,
        note: patch.note ?? null,
        source: "manual",
      })
      .returning({ id: paymentMethods.id });
    return { id: row.id, created: true };
  }
  const [current] = await db
    .select({ source: paymentMethods.source })
    .from(paymentMethods)
    .where(and(eq(paymentMethods.id, patch.id), eq(paymentMethods.organizationId, orgId), isNull(paymentMethods.deletedAt)))
    .limit(1);
  if (!current) throw new VendorBillingInputError(`找不到付款方式 ${patch.id}`);
  if (current.source !== "manual") {
    const bad = forbiddenSyncedFields(patch, SYNCED_PAYMENT_METHOD_EDITABLE);
    if (bad.length) throw new VendorBillingInputError(`從 ${current.source} 同步的卡不能修改：${bad.join(", ")}`);
  }
  const { id, ...rest } = patch;
  const set = Object.fromEntries(Object.entries(rest).filter(([, v]) => v !== undefined));
  await db
    .update(paymentMethods)
    .set({ ...set, updatedAt: sql`now()` })
    .where(and(eq(paymentMethods.id, id), eq(paymentMethods.organizationId, orgId)));
  return { id, created: false };
}

/** 刪除（軟刪）手動付款方式；指向它的計費帳號改成「未設定」。 */
export async function deletePaymentMethod(orgId: string, id: number): Promise<void> {
  const db = getDb();
  const [current] = await db
    .select({ source: paymentMethods.source })
    .from(paymentMethods)
    .where(and(eq(paymentMethods.id, id), eq(paymentMethods.organizationId, orgId), isNull(paymentMethods.deletedAt)))
    .limit(1);
  if (!current) throw new VendorBillingInputError(`找不到付款方式 ${id}`);
  if (current.source !== "manual") throw new VendorBillingInputError("同步來的卡不能刪除，可以改成停用");
  await db
    .update(paymentMethods)
    .set({ deletedAt: sql`now()`, updatedAt: sql`now()` })
    .where(and(eq(paymentMethods.id, id), eq(paymentMethods.organizationId, orgId)));
  await db
    .update(vendorBillingAccounts)
    .set({ paymentMethodId: null, updatedAt: sql`now()` })
    .where(and(eq(vendorBillingAccounts.organizationId, orgId), eq(vendorBillingAccounts.paymentMethodId, id)));
}

/**
 * 人工處理一張帳單：
 *   confirm  採用建議的交易（→ manual）
 *   link     綁到指定交易（同組織、未刪除；多張帳單可以綁同一筆 → manual）；拒絕清單裡有它就拿掉
 *   unlink   解除綁定（→ unmatched；之前新建的交易不會被刪）。解除的交易（與當時的建議）記進
 *            meta.rejectedTransactionIds，之後不會再自動配回這張帳單；別的候選照樣可以自動配。
 *   ignore   不對帳（→ ignored）
 *   create   立刻新建一筆待確認支出並綁上（→ created）；需要帳號有交易對象
 */
export async function resolveVendorInvoice(
  orgId: string,
  invoiceId: number,
  action: InvoiceAction,
  transactionId?: number | null,
): Promise<InvoiceRow | undefined> {
  const db = getDb();
  await assertOrgRefs(orgId, invoiceResolutionRefs({ invoiceId, transactionId: action === "link" ? transactionId : null }));
  const [row] = await db
    .select({ inv: vendorInvoices, account: vendorBillingAccounts })
    .from(vendorInvoices)
    .innerJoin(vendorBillingAccounts, eq(vendorBillingAccounts.id, vendorInvoices.billingAccountId))
    .where(and(eq(vendorInvoices.id, invoiceId), eq(vendorInvoices.organizationId, orgId)))
    .limit(1);
  if (!row) throw new VendorBillingInputError(`找不到帳單 ${invoiceId}`);
  const { inv, account } = row;
  const where = and(eq(vendorInvoices.id, invoiceId), eq(vendorInvoices.organizationId, orgId));
  const rejected = parseRejectedTransactionIds(inv.meta);
  /** meta 只合併 rejectedTransactionIds 這個鍵。 */
  const rejectedMeta = (ids: number[]) =>
    sql`${vendorInvoices.meta} || ${JSON.stringify({ rejectedTransactionIds: ids })}::jsonb`;

  switch (action) {
    case "confirm": {
      if (inv.matchStatus !== "suggested" || !inv.suggestedTransactionId) {
        throw new VendorBillingInputError("這張帳單目前沒有建議的交易");
      }
      // 建議的交易可能已被刪掉或（理論上）不屬於本組織 —— 再驗一次
      await assertOrgRefs(orgId, { transaction: [inv.suggestedTransactionId] });
      await db
        .update(vendorInvoices)
        .set({
          matchStatus: "manual",
          matchedTransactionId: inv.suggestedTransactionId,
          suggestedTransactionId: null,
          matchedAt: sql`now()`,
          meta: rejectedMeta(withRejected(rejected, [], inv.suggestedTransactionId)),
          updatedAt: sql`now()`,
        })
        .where(where);
      break;
    }
    case "link": {
      if (!transactionId) throw new VendorBillingInputError("請選擇要綁定的交易");
      await db
        .update(vendorInvoices)
        .set({
          matchStatus: "manual",
          matchedTransactionId: transactionId,
          suggestedTransactionId: null,
          matchedAt: sql`now()`,
          meta: rejectedMeta(withRejected(rejected, [], transactionId)),
          updatedAt: sql`now()`,
        })
        .where(where);
      break;
    }
    case "unlink":
      await db
        .update(vendorInvoices)
        .set({
          matchStatus: "unmatched",
          matchedTransactionId: null,
          suggestedTransactionId: null,
          matchedAt: null,
          meta: rejectedMeta(withRejected(rejected, [inv.matchedTransactionId, inv.suggestedTransactionId])),
          updatedAt: sql`now()`,
        })
        .where(where);
      break;
    case "ignore":
      await db
        .update(vendorInvoices)
        .set({ matchStatus: "ignored", suggestedTransactionId: null, updatedAt: sql`now()` })
        .where(where);
      break;
    case "create": {
      if (["matched", "manual", "created"].includes(inv.matchStatus)) {
        throw new VendorBillingInputError("這張帳單已經綁定交易了，先解除綁定再建立");
      }
      const partyId = account.partyId ?? matchPartiesOf(account)[0];
      if (!partyId) throw new VendorBillingInputError("請先幫這個計費帳號設定交易對象，才能建立交易");
      if (Number(inv.amount) <= 0) throw new VendorBillingInputError("金額為 0 或負數的帳單不建立交易");
      const r = await createLedgerTransactionForInvoice(
        db,
        orgId,
        {
          id: inv.id,
          billingAccountId: inv.billingAccountId,
          externalRef: inv.externalRef,
          source: inv.source,
          invoiceDate: inv.invoiceDate,
          periodStart: inv.periodStart,
          periodEnd: inv.periodEnd,
          amount: Number(inv.amount),
          currency: inv.currency.trim(),
        },
        account,
        partyId,
      );
      if (r.status === "deleted") {
        throw new VendorBillingInputError("這張帳單之前建立的交易已被刪除，所以不再重建；帳單已標為不對帳");
      }
      break;
    }
  }
  // 帳號底下超過 500 張帳單時可能撈不到這張；寫入已經完成，所以回 undefined 而不是報錯
  return (await listVendorInvoices(orgId, { billingAccountId: inv.billingAccountId, limit: 500 })).find(
    (i) => i.id === invoiceId,
  );
}

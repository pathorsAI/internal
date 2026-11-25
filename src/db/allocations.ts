/**
 * 收款分配（migrations/0043）的資料庫端：有效分配的 CTE、各種「已收」的分組查詢、整組替換寫入。
 *
 * 規則在 src/lib/payment-allocation.ts（純函式）；這裡的 `effective` CTE 是同一條規則的 SQL 版：
 *   - 有分配列的交易 → 只取分配列；
 *   - 沒有分配列的 income 交易 → 舊的單一綁定當成一列（整筆金額、fee 0），
 *     優先順序 訂閱期別 > 請款項目 > 合約（NOT EXISTS 擋掉已經有分配列的交易）。
 * 都只算未刪除的 income 交易；幣別一律跟目標比，不同幣別的不算（本系統不做匯率換算）。
 *
 * 獨立成一支檔：queries.ts 與 mcp/shared.ts 都要用，放進 queries.ts 會造成循環 import。
 */
import { clearLinkReviewForAllocated } from "@/lib/linking/allocation-review";
import { and, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { getDb, runBatch, type Db } from "./index";
import { billingItems, contracts, paymentAllocations, subscriptions, transactions } from "./schema";
import {
  isLegacyMirror,
  validateAllocations,
  type AllocationErrorCode,
  type AllocationInput,
  type AllocationTarget,
  type AllocationTargetType,
} from "@/lib/payment-allocation";

/** 已收（含吸收的手續費）與其中的手續費。 */
export type Collected = { paid: number; fee: number };

/** raw execute 的結果：node-postgres／neon-http 都是 { rows }，保險起見也接受直接回陣列的 driver。 */
function rowsOf<T>(res: unknown): T[] {
  if (Array.isArray(res)) return res as T[];
  return (res as { rows?: T[] }).rows ?? [];
}

function idList(ids: readonly number[]): SQL {
  return sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  );
}

/**
 * 有效分配（見檔頭）。欄位一律轉成 text 再出去：raw execute 不經 drizzle 的欄位型別轉換，
 * 兩種 driver 對 bigint／date／numeric 的解析不同，轉成字串最穩。
 */
function effectiveCte(orgId: string): SQL {
  const legacySub = sql`(t.subscription_id is not null and t.subscription_period is not null)`;
  return sql`effective as (
    select a.id as allocation_id, a.transaction_id as txn_id, t.txn_date, t.currency, t.book,
           a.target_type, a.subscription_id, a.subscription_period, a.billing_item_id, a.contract_id,
           a.amount, a.fee, a.note
    from payment_allocations a
    join transactions t on t.id = a.transaction_id
    where a.organization_id = ${orgId}
      and t.organization_id = ${orgId}
      and t.deleted_at is null
      and t.type = 'income'
    union all
    select null::bigint, t.id, t.txn_date, t.currency, t.book,
           case when ${legacySub} then 'subscription_period'
                when t.billing_item_id is not null then 'billing_item'
                else 'contract' end,
           case when ${legacySub} then t.subscription_id end,
           case when ${legacySub} then t.subscription_period end,
           case when not ${legacySub} then t.billing_item_id end,
           case when not ${legacySub} and t.billing_item_id is null then t.contract_id end,
           t.amount, 0::numeric, null::text
    from transactions t
    where t.organization_id = ${orgId}
      and t.deleted_at is null
      and t.type = 'income'
      and (${legacySub} or t.billing_item_id is not null or t.contract_id is not null)
      and not exists (select 1 from payment_allocations a2 where a2.transaction_id = t.id)
  )`;
}

/** 各請款項目的已收（同幣別）。不給 ids 就是全 org。 */
export async function billingItemCollected(
  orgId: string,
  ids?: readonly number[],
  db: Db = getDb(),
): Promise<Map<number, Collected>> {
  if (ids?.length === 0) return new Map();
  const filter = ids ? sql`and e.billing_item_id in (${idList(ids)})` : sql``;
  const res = await db.execute(sql`
    with ${effectiveCte(orgId)}
    select e.billing_item_id::text as id,
           coalesce(sum(e.amount + e.fee), 0)::text as paid,
           coalesce(sum(e.fee), 0)::text as fee
    from effective e
    join billing_items bi on bi.id = e.billing_item_id and bi.currency = e.currency
    where e.billing_item_id is not null ${filter}
    group by e.billing_item_id`);
  return new Map(
    rowsOf<{ id: string; paid: string; fee: string }>(res).map((r) => [
      Number(r.id),
      { paid: Number(r.paid), fee: Number(r.fee) },
    ]),
  );
}

export type PeriodCollected = { periodStart: string; paid: number; fee: number };

/** 各訂閱各期的已收（同幣別）。不給 subscriptionIds 就是全 org。 */
export async function subscriptionPeriodCollected(
  orgId: string,
  subscriptionIds?: readonly number[],
  db: Db = getDb(),
): Promise<Map<number, PeriodCollected[]>> {
  if (subscriptionIds?.length === 0) return new Map();
  const filter = subscriptionIds ? sql`and e.subscription_id in (${idList(subscriptionIds)})` : sql``;
  const res = await db.execute(sql`
    with ${effectiveCte(orgId)}
    select e.subscription_id::text as id,
           e.subscription_period::text as period,
           coalesce(sum(e.amount + e.fee), 0)::text as paid,
           coalesce(sum(e.fee), 0)::text as fee
    from effective e
    join subscriptions s on s.id = e.subscription_id and s.currency = e.currency
    where e.subscription_id is not null and e.subscription_period is not null ${filter}
    group by e.subscription_id, e.subscription_period`);
  const out = new Map<number, PeriodCollected[]>();
  for (const r of rowsOf<{ id: string; period: string; paid: string; fee: string }>(res)) {
    const id = Number(r.id);
    const list = out.get(id) ?? [];
    list.push({ periodStart: r.period, paid: Number(r.paid), fee: Number(r.fee) });
    out.set(id, list);
  }
  return out;
}

/**
 * 各合約的已收（同幣別）＝ 直接分給合約 + 分給它底下的請款項目（billing_items.contract_id）
 * + 分給綁了它的訂閱的期別（subscriptions.contract_id）。不給 ids 就是全 org。
 */
export async function contractCollected(
  orgId: string,
  ids?: readonly number[],
  db: Db = getDb(),
): Promise<Map<number, Collected>> {
  if (ids?.length === 0) return new Map();
  const filter = ids ? sql`and c.id in (${idList(ids)})` : sql``;
  const res = await db.execute(sql`
    with ${effectiveCte(orgId)}
    select c.id::text as id,
           coalesce(sum(e.amount + e.fee), 0)::text as paid,
           coalesce(sum(e.fee), 0)::text as fee
    from effective e
    left join billing_items bi on bi.id = e.billing_item_id
    left join subscriptions s on s.id = e.subscription_id
    join contracts c on c.id = coalesce(e.contract_id, bi.contract_id, s.contract_id)
      and c.currency = e.currency
    where c.organization_id = ${orgId} ${filter}
    group by c.id`);
  return new Map(
    rowsOf<{ id: string; paid: string; fee: string }>(res).map((r) => [
      Number(r.id),
      { paid: Number(r.paid), fee: Number(r.fee) },
    ]),
  );
}

/**
 * 管理帳（book = both / internal）在某段期間（依交易日）吸收掉的手續費合計，依幣別分開。
 * 只有分配列會有 fee，舊的單一綁定一律是 0。
 */
export async function absorbedFeesTotal(
  orgId: string,
  from: string,
  to: string,
  db: Db = getDb(),
): Promise<{ currency: string; total: number }[]> {
  const res = await db.execute(sql`
    with ${effectiveCte(orgId)}
    select trim(e.currency)::text as currency, coalesce(sum(e.fee), 0)::text as total
    from effective e
    where e.fee > 0 and e.book in ('both', 'internal')
      and e.txn_date >= ${from}::date and e.txn_date <= ${to}::date
    group by e.currency
    order by e.currency`);
  return rowsOf<{ currency: string; total: string }>(res).map((r) => ({
    currency: r.currency,
    total: Number(r.total),
  }));
}

/** 一列有效分配（list_payment_allocations 與 Sheet 共用的形狀）。 */
export type EffectiveAllocationRow = {
  /** 分配列的 id；舊的單一綁定沒有實體列，為 null */
  id: number | null;
  /** allocation＝分配列；legacy＝沒有分配列的交易，用它的單一綁定算 */
  source: "allocation" | "legacy";
  transactionId: number;
  txnDate: string;
  currency: string;
  /** 交易的帳本：both / internal（管理帳看這兩種）/ external */
  book: string;
  targetType: AllocationTargetType;
  subscriptionId: number | null;
  subscriptionPeriod: string | null;
  billingItemId: number | null;
  contractId: number | null;
  amount: number;
  fee: number;
  note: string | null;
};

export type AllocationFilter = {
  transactionId?: number;
  target?: AllocationTarget;
  from?: string;
  to?: string;
  limit?: number;
};

/** 依交易、目標或交易日期間列出有效分配（含舊綁定退回的那種）。 */
export async function listEffectiveAllocations(
  orgId: string,
  filter: AllocationFilter,
  db: Db = getDb(),
): Promise<EffectiveAllocationRow[]> {
  const conds: SQL[] = [sql`true`];
  if (filter.transactionId != null) conds.push(sql`e.txn_id = ${filter.transactionId}`);
  const t = filter.target;
  if (t?.type === "subscription_period") {
    conds.push(sql`e.subscription_id = ${t.subscriptionId} and e.subscription_period = ${t.period}::date`);
  } else if (t?.type === "billing_item") {
    conds.push(sql`e.billing_item_id = ${t.billingItemId}`);
  } else if (t?.type === "contract") {
    conds.push(sql`e.contract_id = ${t.contractId}`);
  }
  if (filter.from) conds.push(sql`e.txn_date >= ${filter.from}::date`);
  if (filter.to) conds.push(sql`e.txn_date <= ${filter.to}::date`);
  const limit = Math.min(Math.max(filter.limit ?? 500, 1), 2000);
  const res = await db.execute(sql`
    with ${effectiveCte(orgId)}
    select e.allocation_id::text as id, e.txn_id::text as txn_id, e.txn_date::text as txn_date,
           trim(e.currency)::text as currency, e.book, e.target_type,
           e.subscription_id::text as subscription_id, e.subscription_period::text as subscription_period,
           e.billing_item_id::text as billing_item_id, e.contract_id::text as contract_id,
           e.amount::text as amount, e.fee::text as fee, e.note
    from effective e
    where ${sql.join(conds, sql` and `)}
    order by e.txn_date desc, e.txn_id desc, e.allocation_id nulls first
    limit ${limit}`);
  const n = (v: string | null) => (v == null ? null : Number(v));
  return rowsOf<{
    id: string | null;
    txn_id: string;
    txn_date: string;
    currency: string;
    book: string;
    target_type: AllocationTargetType;
    subscription_id: string | null;
    subscription_period: string | null;
    billing_item_id: string | null;
    contract_id: string | null;
    amount: string;
    fee: string;
    note: string | null;
  }>(res).map((r) => ({
    id: n(r.id),
    source: r.id == null ? "legacy" : "allocation",
    transactionId: Number(r.txn_id),
    txnDate: r.txn_date,
    currency: r.currency,
    book: r.book,
    targetType: r.target_type,
    subscriptionId: n(r.subscription_id),
    subscriptionPeriod: r.subscription_period,
    billingItemId: n(r.billing_item_id),
    contractId: n(r.contract_id),
    amount: Number(r.amount),
    fee: Number(r.fee),
    note: r.note,
  }));
}

// ---- 寫入 ----

export type AllocationWriteErrorCode =
  | AllocationErrorCode
  | "transactionNotFound"
  | "notIncome"
  | "targetNotFound"
  | "currencyMismatch"
  | "splitTransaction";

/** 寫入失敗的原因；code 給畫面翻譯，message 是英文（MCP 直接回給模型）。 */
export class AllocationWriteError extends Error {
  constructor(
    readonly code: AllocationWriteErrorCode,
    message: string,
    readonly index: number | null = null,
  ) {
    super(message);
    this.name = "AllocationWriteError";
  }
}

const VALIDATION_MESSAGES: Record<AllocationErrorCode, string> = {
  invalidTarget: "Each allocation needs exactly one target: subscriptionId + subscriptionPeriod, billingItemId, or contractId.",
  invalidPeriod: "subscriptionPeriod must be a valid date (YYYY-MM-DD, the period start).",
  negativeAmount: "amount must be ≥ 0.",
  negativeFee: "fee must be ≥ 0.",
  emptyLine: "amount + fee must be > 0.",
  duplicateTarget: "The same target appears twice; merge those lines.",
  overAllocated: "The allocated amounts add up to more than the transaction amount.",
};

type TxnHeader = {
  id: number;
  type: string;
  amount: string;
  currency: string;
  contractId: number | null;
  subscriptionId: number | null;
  subscriptionPeriod: string | null;
  billingItemId: number | null;
};

async function loadTxn(db: Db, orgId: string, txnId: number): Promise<TxnHeader | null> {
  const [row] = await db
    .select({
      id: transactions.id,
      type: transactions.type,
      amount: transactions.amount,
      currency: transactions.currency,
      contractId: transactions.contractId,
      subscriptionId: transactions.subscriptionId,
      subscriptionPeriod: transactions.subscriptionPeriod,
      billingItemId: transactions.billingItemId,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.organizationId, orgId),
        eq(transactions.id, txnId),
        isNull(transactions.deletedAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** 某筆交易自己存的分配列（不含舊綁定的退回）。 */
export async function storedAllocations(
  orgId: string,
  txnId: number,
  db: Db = getDb(),
): Promise<(AllocationInput & { id: number })[]> {
  const rows = await db
    .select()
    .from(paymentAllocations)
    .where(
      and(eq(paymentAllocations.organizationId, orgId), eq(paymentAllocations.transactionId, txnId)),
    )
    .orderBy(paymentAllocations.id);
  return rows.map((r) => ({ id: r.id, ...inputOfRow(r), note: r.note }));
}

function inputOfRow(r: typeof paymentAllocations.$inferSelect): AllocationInput {
  let target: AllocationTarget;
  if (r.targetType === "subscription_period") {
    target = {
      type: "subscription_period",
      subscriptionId: r.subscriptionId ?? 0,
      period: r.subscriptionPeriod ?? "",
    };
  } else if (r.targetType === "billing_item") {
    target = { type: "billing_item", billingItemId: r.billingItemId ?? 0 };
  } else {
    target = { type: "contract", contractId: r.contractId ?? 0 };
  }
  return { target, amount: Number(r.amount), fee: Number(r.fee) };
}

function legacyOf(txn: TxnHeader) {
  return {
    amount: Number(txn.amount),
    contractId: txn.contractId,
    subscriptionId: txn.subscriptionId,
    subscriptionPeriod: txn.subscriptionPeriod,
    billingItemId: txn.billingItemId,
  };
}

/**
 * 交易的分配列若只是「舊單一綁定的鏡像」（整筆分給原本綁的目標、手續費 0），就刪掉、讓讀取退回綁定欄位。
 * 要改交易的綁定欄位或金額之前呼叫（網頁編輯、update_transaction、看板配對），否則改綁會被
 * 那一列蓋掉、看起來沒生效。回傳刪完之後還剩幾列（> 0 代表這筆是真正拆分過的）。
 */
export async function releaseLegacyMirror(db: Db, orgId: string, txnId: number): Promise<number> {
  const txn = await loadTxn(db, orgId, txnId);
  if (!txn) return 0;
  const rows = await storedAllocations(orgId, txnId, db);
  if (rows.length === 0) return 0;
  if (!isLegacyMirror(legacyOf(txn), rows)) return rows.length;
  await db
    .delete(paymentAllocations)
    .where(
      and(eq(paymentAllocations.organizationId, orgId), eq(paymentAllocations.transactionId, txnId)),
    );
  return 0;
}

type TargetRef = { id: number; currency: string };

async function targetRefs(
  db: Db,
  orgId: string,
  list: readonly AllocationInput[],
): Promise<{ items: Map<number, TargetRef>; subs: Map<number, TargetRef>; contracts: Map<number, TargetRef> }> {
  const itemIds = new Set<number>();
  const subIds = new Set<number>();
  const contractIds = new Set<number>();
  for (const a of list) {
    if (a.target.type === "billing_item") itemIds.add(a.target.billingItemId);
    else if (a.target.type === "subscription_period") subIds.add(a.target.subscriptionId);
    else contractIds.add(a.target.contractId);
  }
  const [items, subs, cons] = await Promise.all([
    itemIds.size
      ? db
          .select({ id: billingItems.id, currency: billingItems.currency })
          .from(billingItems)
          .where(
            and(
              eq(billingItems.organizationId, orgId),
              inArray(billingItems.id, [...itemIds]),
              isNull(billingItems.deletedAt),
            ),
          )
      : Promise.resolve([] as TargetRef[]),
    subIds.size
      ? db
          .select({ id: subscriptions.id, currency: subscriptions.currency })
          .from(subscriptions)
          .where(
            and(
              eq(subscriptions.organizationId, orgId),
              inArray(subscriptions.id, [...subIds]),
              isNull(subscriptions.deletedAt),
            ),
          )
      : Promise.resolve([] as TargetRef[]),
    contractIds.size
      ? db
          .select({ id: contracts.id, currency: contracts.currency })
          .from(contracts)
          .where(
            and(
              eq(contracts.organizationId, orgId),
              inArray(contracts.id, [...contractIds]),
              isNull(contracts.deletedAt),
            ),
          )
      : Promise.resolve([] as TargetRef[]),
  ]);
  const toMap = (rows: TargetRef[]) => new Map(rows.map((r) => [r.id, r]));
  return { items: toMap(items), subs: toMap(subs), contracts: toMap(cons) };
}

function describeTarget(t: AllocationTarget): string {
  if (t.type === "subscription_period") return `subscription ${t.subscriptionId} period ${t.period}`;
  if (t.type === "billing_item") return `billing item ${t.billingItemId}`;
  return `contract ${t.contractId}`;
}

/**
 * 整組替換一筆 income 交易的分配（org 內）。空陣列＝清除，讀取退回舊的單一綁定欄位。
 * 檢查：交易屬於本 org、是 income、每個目標都在本 org 且未刪除、幣別跟交易一樣、Σamount ≤ 交易金額。
 * 舊的綁定欄位不動（有分配列時讀取本來就不看它們）。刪除＋寫入走 runBatch，一起成功或一起不算。
 */
export async function replaceTransactionAllocations(
  orgId: string,
  txnId: number,
  list: readonly AllocationInput[],
  userId: string | null,
  db: Db = getDb(),
): Promise<(AllocationInput & { id: number })[]> {
  const txn = await loadTxn(db, orgId, txnId);
  if (!txn) {
    throw new AllocationWriteError("transactionNotFound", `Transaction ${txnId} not found in your organization.`);
  }
  if (txn.type !== "income") {
    throw new AllocationWriteError("notIncome", `Transaction ${txnId} is not income; only income can be allocated.`);
  }
  const check = validateAllocations(Number(txn.amount), list);
  if (!check.ok) {
    throw new AllocationWriteError(check.code, VALIDATION_MESSAGES[check.code], check.index);
  }

  const refs = await targetRefs(db, orgId, list);
  const currency = txn.currency.trim();
  list.forEach((a, i) => {
    let ref: TargetRef | undefined;
    if (a.target.type === "billing_item") ref = refs.items.get(a.target.billingItemId);
    else if (a.target.type === "subscription_period") ref = refs.subs.get(a.target.subscriptionId);
    else ref = refs.contracts.get(a.target.contractId);
    if (!ref) {
      throw new AllocationWriteError(
        "targetNotFound",
        `${describeTarget(a.target)} not found in your organization.`,
        i,
      );
    }
    if (ref.currency.trim() !== currency) {
      throw new AllocationWriteError(
        "currencyMismatch",
        `${describeTarget(a.target)} is in ${ref.currency.trim()}, the transaction is in ${currency}.`,
        i,
      );
    }
  });

  const values = list.map((a) => ({
    organizationId: orgId,
    transactionId: txnId,
    targetType: a.target.type,
    subscriptionId: a.target.type === "subscription_period" ? a.target.subscriptionId : null,
    subscriptionPeriod: a.target.type === "subscription_period" ? a.target.period : null,
    billingItemId: a.target.type === "billing_item" ? a.target.billingItemId : null,
    contractId: a.target.type === "contract" ? a.target.contractId : null,
    amount: (Math.round(a.amount * 100) / 100).toFixed(2),
    fee: (Math.round(a.fee * 100) / 100).toFixed(2),
    note: a.note?.trim() ? a.note.trim() : null,
    createdByUserId: userId,
  }));

  const del = (q: Db) =>
    q
      .delete(paymentAllocations)
      .where(
        and(eq(paymentAllocations.organizationId, orgId), eq(paymentAllocations.transactionId, txnId)),
      );
  if (values.length === 0) {
    await runBatch((q) => [del(q)] as const, db);
  } else {
    await runBatch((q) => [del(q), q.insert(paymentAllocations).values(values)] as const, db);
    // 拆分好了＝歸屬定了：連結層的待連結旗標一併清掉
    await clearLinkReviewForAllocated(db, orgId, txnId);
  }
  return storedAllocations(orgId, txnId, db);
}

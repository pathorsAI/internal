import { aliasedTable, and, eq, isNull, sql, type SQL } from "drizzle-orm";
import { QueryBuilder } from "drizzle-orm/pg-core";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { billingItems, contracts, subscriptions, transactions } from "./schema";

/**
 * 專案損益的歸屬定義（docs/data-links.md 方案 C）：一筆交易屬於專案 P，只要下列任一條成立
 *
 *   1. transactions.project_id = P
 *   2. 交易的合約（contract_id）屬於 P
 *   3. 交易的訂閱（subscription_id）屬於 P —— 訂閱自己的 project_id，或訂閱所屬合約的專案
 *   4. 交易的請款項（billing_item_id）屬於 P —— 請款項自己的 project_id，或請款項所屬合約的專案
 *
 * 交易的 project_id 只在寫入當下從請款項 / 訂閱 / 合約繼承；之後才把合約歸到專案的話，
 * 舊交易的 project_id 還是空的。這裡在讀取時把整條鏈攤開，舊資料也算得進去。
 *
 * 去重：每筆交易攤成一列（帶 6 個候選專案 id），跟專案只用一個 `P in (...)` 條件 join，
 * 所以同一筆交易對同一個專案最多配對一次 —— 好幾條路徑同時命中也不會重複計算。
 * 已軟刪除的合約 / 訂閱 / 請款項不算路徑（使用者眼中它已經不存在）。
 */

// 用獨立的 QueryBuilder 組子查詢：不需要連線，可以嵌進任何 db 的查詢，也能直接單元測試 toSQL()。
const qb = new QueryBuilder();

/** 每筆（未刪除的）交易一列：金額欄位 + 6 條路徑各自指到的專案 id。 */
export function projectLinkedTransactions(orgId: string) {
  const c = aliasedTable(contracts, "plt_contract");
  const s = aliasedTable(subscriptions, "plt_sub");
  const sc = aliasedTable(contracts, "plt_sub_contract");
  const b = aliasedTable(billingItems, "plt_item");
  const bc = aliasedTable(contracts, "plt_item_contract");
  return qb
    .select({
      txnId: sql<number>`${transactions.id}`.as("txn_id"),
      type: sql<string>`${transactions.type}`.as("txn_type"),
      amount: sql<string>`${transactions.amount}`.as("txn_amount"),
      amountTwd: sql<string | null>`${transactions.amountTwd}`.as("txn_amount_twd"),
      viaTxn: sql<number | null>`${transactions.projectId}`.as("p_txn"),
      viaContract: sql<number | null>`${c.projectId}`.as("p_contract"),
      viaSubscription: sql<number | null>`${s.projectId}`.as("p_sub"),
      viaSubscriptionContract: sql<number | null>`${sc.projectId}`.as("p_sub_contract"),
      viaBillingItem: sql<number | null>`${b.projectId}`.as("p_item"),
      viaBillingItemContract: sql<number | null>`${bc.projectId}`.as("p_item_contract"),
    })
    .from(transactions)
    .leftJoin(c, and(eq(c.id, transactions.contractId), isNull(c.deletedAt)))
    .leftJoin(s, and(eq(s.id, transactions.subscriptionId), isNull(s.deletedAt)))
    .leftJoin(sc, and(eq(sc.id, s.contractId), isNull(sc.deletedAt)))
    .leftJoin(b, and(eq(b.id, transactions.billingItemId), isNull(b.deletedAt)))
    .leftJoin(bc, and(eq(bc.id, b.contractId), isNull(bc.deletedAt)))
    .where(and(eq(transactions.organizationId, orgId), isNull(transactions.deletedAt)))
    .as("plt");
}

export type ProjectLinkedTransactions = ReturnType<typeof projectLinkedTransactions>;

/** `P in (6 個候選)`：P 可以是欄位（per-project 彙總）或常數（單一專案篩選）。 */
export function belongsToProject(plt: ProjectLinkedTransactions, project: AnyPgColumn | number): SQL {
  return sql`${project} in (${plt.viaTxn}, ${plt.viaContract}, ${plt.viaSubscription}, ${plt.viaSubscriptionContract}, ${plt.viaBillingItem}, ${plt.viaBillingItemContract})`;
}

/** 以 TWD 彙總（amount_twd 缺值時退回 amount），與 queries.ts 其他報表同一套幣別語意。 */
export function linkedIncomeTwd(plt: ProjectLinkedTransactions) {
  return sql<string>`coalesce(sum(coalesce(${plt.amountTwd}, ${plt.amount})) filter (where ${plt.type} = 'income'), 0)`;
}

export function linkedExpenseTwd(plt: ProjectLinkedTransactions) {
  return sql<string>`coalesce(sum(coalesce(${plt.amountTwd}, ${plt.amount})) filter (where ${plt.type} in ('expense','advance')), 0)`;
}

/** 屬於某個專案的交易 id（子查詢），給「依專案篩選交易」用。 */
export function projectTransactionIds(orgId: string, projectId: number) {
  const plt = projectLinkedTransactions(orgId);
  return qb.select({ id: plt.txnId }).from(plt).where(belongsToProject(plt, projectId));
}

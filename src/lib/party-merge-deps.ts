import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { PgColumn, PgTable, PgUpdateSetSource } from "drizzle-orm/pg-core";
import { getDb } from "@/db";
import {
  billingItems,
  contracts,
  invoices,
  parties,
  projects,
  recurringExpenses,
  subscriptions,
  transactions,
  vendorBillingAccounts,
} from "@/db/schema";
import type { MergeCounts, MergePlan, PartyMergeDeps } from "./party-merge";

type Db = ReturnType<typeof getDb>;

type RepointKey = Exclude<keyof MergeCounts, "vendorBillingMatchParties">;

type OrgTable = PgTable & { id: PgColumn; organizationId: PgColumn };

/**
 * 所有參照 parties(id) 的外鍵（migrations 裡 `REFERENCES parties(id)`；links / receivables 已刪表）。
 * 新增參照 parties 的欄位時要加在這裡，否則合併後那張表會留著指向已刪除對象的列。
 */
const REPOINTS: { key: RepointKey; table: OrgTable; prop: string; column: PgColumn }[] = [
  { key: "transactions", table: transactions, prop: "partyId", column: transactions.partyId },
  { key: "projects", table: projects, prop: "clientPartyId", column: projects.clientPartyId },
  { key: "subscriptions", table: subscriptions, prop: "customerPartyId", column: subscriptions.customerPartyId },
  { key: "contracts", table: contracts, prop: "customerPartyId", column: contracts.customerPartyId },
  { key: "billingItems", table: billingItems, prop: "customerPartyId", column: billingItems.customerPartyId },
  { key: "invoices", table: invoices, prop: "partyId", column: invoices.partyId },
  { key: "vendorBillingAccounts", table: vendorBillingAccounts, prop: "partyId", column: vendorBillingAccounts.partyId },
  { key: "recurringExpenses", table: recurringExpenses, prop: "partyId", column: recurringExpenses.partyId },
];

/**
 * 合併要跑的所有語句（依序）。拆出來是為了讓本機驗證可以用別的 driver 跑同一組 SQL。
 *
 * 第一句是守門：目標與來源必須都還在（同組織、未刪除），否則除以零讓整個 transaction 失敗 ——
 * 驗證（讀）跟寫入之間有空檔，neon-http 又沒有互動式 transaction，只能這樣把檢查放進同一批。
 */
export function buildMergeStatements(db: Db, plan: MergePlan) {
  const { orgId, targetId, sourceIds } = plan;
  const allIds = [targetId, ...sourceIds];
  const guard = db.execute(sql`
    select 1 / (case when count(*) = ${allIds.length} then 1 else 0 end) as ok
    from ${parties}
    where ${parties.organizationId} = ${orgId}
      and ${inArray(parties.id, allIds)}
      and ${parties.deletedAt} is null`);

  const repoints = REPOINTS.map((r) => ({
    key: r.key,
    query: db
      .update(r.table)
      .set({ [r.prop]: targetId } as PgUpdateSetSource<typeof r.table>)
      .where(and(eq(r.table.organizationId, orgId), inArray(r.column, sourceIds)))
      .returning({ id: r.table.id }),
  }));

  const metaUpdates = plan.matchAccountUpdates.map((u) =>
    db
      .update(vendorBillingAccounts)
      .set({
        // 只換 matchPartyIds 這個鍵，meta 其他鍵（同步寫的 billingAccountId 等）不動。
        // 先 ::text 再 ::jsonb：參數一律以文字送出，不受 driver 對 jsonb 參數的編碼差異影響。
        meta: sql`coalesce(${vendorBillingAccounts.meta}, '{}'::jsonb) || ${JSON.stringify({ matchPartyIds: u.matchPartyIds })}::text::jsonb`,
      })
      .where(and(eq(vendorBillingAccounts.organizationId, orgId), eq(vendorBillingAccounts.id, u.id)))
      .returning({ id: vendorBillingAccounts.id }),
  );

  const targetAliases = db
    .update(parties)
    .set({ aliases: plan.aliases })
    .where(and(eq(parties.organizationId, orgId), eq(parties.id, targetId), isNull(parties.deletedAt)))
    .returning({ id: parties.id });

  const softDelete = db
    .update(parties)
    .set({ deletedAt: sql`now()` })
    .where(and(eq(parties.organizationId, orgId), inArray(parties.id, sourceIds), isNull(parties.deletedAt)))
    .returning({ id: parties.id });

  return { guard, repoints, metaUpdates, targetAliases, softDelete };
}

/** 依 buildMergeStatements 的順序把每句的結果列數整理成 MergeCounts。 */
export function countsFromResults(plan: MergePlan, results: readonly unknown[]): MergeCounts {
  const len = (i: number) => (Array.isArray(results[i]) ? (results[i] as unknown[]).length : 0);
  const counts = { vendorBillingMatchParties: 0 } as MergeCounts;
  REPOINTS.forEach((r, i) => {
    counts[r.key] = len(1 + i);
  });
  for (let i = 0; i < plan.matchAccountUpdates.length; i++) {
    counts.vendorBillingMatchParties += len(1 + REPOINTS.length + i);
  }
  return counts;
}

/** 正式環境的 deps：Neon。每個查詢都帶 organization_id；寫入用 db.batch（單一 transaction）。 */
export function partyMergeDeps(db: Db = getDb()): PartyMergeDeps {
  return {
    async loadParties(orgId, ids) {
      return db
        .select({
          id: parties.id,
          organizationId: parties.organizationId,
          name: parties.name,
          aliases: parties.aliases,
        })
        .from(parties)
        .where(and(eq(parties.organizationId, orgId), inArray(parties.id, ids), isNull(parties.deletedAt)));
    },
    async loadMatchAccounts(orgId) {
      return db
        .select({ id: vendorBillingAccounts.id, meta: vendorBillingAccounts.meta })
        .from(vendorBillingAccounts)
        .where(eq(vendorBillingAccounts.organizationId, orgId));
    },
    async apply(plan) {
      const s = buildMergeStatements(db, plan);
      const results = await db.batch([
        s.guard,
        ...s.repoints.map((r) => r.query),
        ...s.metaUpdates,
        s.targetAliases,
        s.softDelete,
      ]);
      return countsFromResults(plan, results);
    },
  };
}

import { describe, expect, test } from "bun:test";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import type { getDb } from "@/db";
import * as schema from "@/db/schema";
import { buildMergeStatements, countsFromResults } from "./party-merge-deps";
import type { MergePlan } from "./party-merge";

// 只組 SQL、不連線：neon() 在真的送查詢之前不會碰網路。
const db = drizzle(neon("postgres://user:pass@localhost/none"), { schema }) as unknown as ReturnType<typeof getDb>;

const PLAN: MergePlan = {
  orgId: "orgA",
  targetId: 1,
  sourceIds: [2, 3],
  aliases: ["Facebk *"],
  matchAccountUpdates: [{ id: 10, matchPartyIds: [1, 4] }],
};

describe("buildMergeStatements", () => {
  const s = buildMergeStatements(db, PLAN);
  const all = [...s.repoints.map((r) => r.query), ...s.metaUpdates, s.targetAliases, s.softDelete];

  test("covers every table that references parties", () => {
    expect(s.repoints.map((r) => r.key)).toEqual([
      "transactions",
      "projects",
      "subscriptions",
      "contracts",
      "billingItems",
      "invoices",
      "vendorBillingAccounts",
      "recurringExpenses",
    ]);
  });

  test("every write is scoped to the organization", () => {
    for (const q of all) {
      const { sql, params } = q.toSQL();
      expect(sql).toContain('"organization_id" = $');
      expect(params).toContain("orgA");
    }
  });

  test("repoints set the FK to the target for the source ids only", () => {
    const { sql, params } = s.repoints[0].query.toSQL();
    expect(sql).toStartWith('update "transactions" set "party_id" = $1');
    expect(sql).toContain('"transactions"."party_id" in ($3, $4)');
    expect(params).toEqual([1, "orgA", 2, 3]);
  });

  test("target and sources must still be live", () => {
    expect(s.targetAliases.toSQL().sql).toContain('"parties"."deleted_at" is null');
    expect(s.softDelete.toSQL().sql).toContain('"parties"."deleted_at" is null');
  });
});

describe("countsFromResults", () => {
  test("maps batch results back to per-table counts", () => {
    const results = [
      [{ ok: 1 }], // guard
      [{ id: 1 }, { id: 2 }], // transactions
      [], // projects
      [{ id: 3 }], // subscriptions
      [],
      [],
      [{ id: 4 }], // invoices
      [],
      [{ id: 5 }], // recurringExpenses
      [{ id: 10 }], // meta update
      [{ id: 1 }], // target aliases
      [{ id: 2 }, { id: 3 }], // soft delete
    ];
    expect(countsFromResults(PLAN, results)).toEqual({
      transactions: 2,
      projects: 0,
      subscriptions: 1,
      contracts: 0,
      billingItems: 0,
      invoices: 1,
      vendorBillingAccounts: 0,
      vendorBillingMatchParties: 1,
      recurringExpenses: 1,
    });
  });
});

import { describe, expect, test } from "bun:test";
import {
  isMergeGuardFailure,
  mergeParties,
  type MergeCounts,
  type MergeParty,
  type MergePlan,
  PartyMergeError,
  type PartyMergeDeps,
  planPartyMerge,
  repointIds,
} from "./party-merge";

type Row = MergeParty & { deletedAt: string | null };

const ZERO: MergeCounts = {
  transactions: 0,
  projects: 0,
  subscriptions: 0,
  contracts: 0,
  billingItems: 0,
  invoices: 0,
  vendorBillingAccounts: 0,
  vendorBillingMatchParties: 0,
  recurringExpenses: 0,
};

/**
 * 假的 deps：模擬兩個組織的交易對象與雲端帳單帳號。
 * honorOrg = false 模擬「查詢的租戶條件哪天被改壞了」，驗 planPartyMerge 的第二道檢查。
 */
function fakeDeps(rows: Row[], { honorOrg = true } = {}) {
  const applied: MergePlan[] = [];
  const accounts = [
    { id: 10, organizationId: "orgA", meta: { matchPartyIds: [2, 4] } },
    { id: 11, organizationId: "orgA", meta: { matchPartyIds: [4] } },
    { id: 12, organizationId: "orgA", meta: {} },
    { id: 13, organizationId: "orgB", meta: { matchPartyIds: [2] } },
  ];
  const deps: PartyMergeDeps = {
    async loadParties(orgId, ids) {
      return rows
        .filter((r) => ids.includes(r.id) && r.deletedAt === null && (!honorOrg || r.organizationId === orgId))
        .map((r) => ({ id: r.id, organizationId: r.organizationId, name: r.name, aliases: r.aliases }));
    },
    async loadMatchAccounts(orgId) {
      return accounts.filter((a) => a.organizationId === orgId);
    },
    async apply(plan) {
      applied.push(plan);
      return { ...ZERO, transactions: 3, vendorBillingMatchParties: plan.matchAccountUpdates.length };
    },
  };
  return { deps, applied };
}

const party = (id: number, name: string, aliases: string[] = [], organizationId = "orgA", deletedAt: string | null = null): Row => ({
  id,
  organizationId,
  name,
  aliases,
  deletedAt,
});

const ROWS: Row[] = [
  party(1, "Meta Ads", ["Facebook"]),
  party(2, "Facebk *26qx2aj6e4"),
  party(3, "FACEBK *9KQ", ["facebook", "Facebk *"]),
  party(5, "Deleted", [], "orgA", "2026-10-01T00:00:00Z"),
  party(6, "Other org", [], "orgB"),
];

describe("mergeParties", () => {
  test("merges aliases, repoints matchPartyIds and returns the counts from apply", async () => {
    const { deps, applied } = fakeDeps(ROWS);
    const res = await mergeParties(deps, "orgA", 1, [2, 3, 2]);

    expect(applied).toHaveLength(1);
    const plan = applied[0];
    expect(plan.orgId).toBe("orgA");
    expect(plan.targetId).toBe(1);
    expect(plan.sourceIds).toEqual([2, 3]);
    expect(plan.aliases).toEqual(["Facebook", "Facebk *26qx2aj6e4", "FACEBK *9KQ", "Facebk *"]);
    // 只有同組織、而且 matchPartyIds 有來源的帳號要改；orgB 的 13 不動
    expect(plan.matchAccountUpdates).toEqual([{ id: 10, matchPartyIds: [1, 4] }]);

    expect(res).toEqual({
      id: 1,
      name: "Meta Ads",
      mergedIds: [2, 3],
      mergedNames: ["Facebk *26qx2aj6e4", "FACEBK *9KQ"],
      aliases: plan.aliases,
      moved: { ...ZERO, transactions: 3, vendorBillingMatchParties: 1 },
    });
  });

  test("rejects a target that is also a source", async () => {
    const { deps, applied } = fakeDeps(ROWS);
    await expect(mergeParties(deps, "orgA", 1, [1, 2])).rejects.toThrow(PartyMergeError);
    expect(applied).toHaveLength(0);
  });

  test("rejects an empty or invalid source list", async () => {
    const { deps, applied } = fakeDeps(ROWS);
    await expect(mergeParties(deps, "orgA", 1, [])).rejects.toThrow("at least one");
    await expect(mergeParties(deps, "orgA", 1, ["2"])).rejects.toThrow("Invalid party id");
    await expect(mergeParties(deps, "orgA", 1, [1.5])).rejects.toThrow("Invalid party id");
    expect(applied).toHaveLength(0);
  });

  test("rejects deleted sources and targets", async () => {
    const { deps, applied } = fakeDeps(ROWS);
    await expect(mergeParties(deps, "orgA", 1, [5])).rejects.toThrow("Party 5 not found");
    await expect(mergeParties(deps, "orgA", 5, [2])).rejects.toThrow("Party 5 not found");
    expect(applied).toHaveLength(0);
  });

  test("rejects another organization's parties", async () => {
    const { deps, applied } = fakeDeps(ROWS);
    await expect(mergeParties(deps, "orgA", 1, [6])).rejects.toThrow("Party 6 not found");
    await expect(mergeParties(deps, "orgA", 6, [2])).rejects.toThrow("Party 6 not found");
    expect(applied).toHaveLength(0);
  });

  test("still rejects a cross-org row if the query's org filter is ever broken", async () => {
    const { deps, applied } = fakeDeps(ROWS, { honorOrg: false });
    await expect(mergeParties(deps, "orgA", 1, [6])).rejects.toThrow("Party 6 not found");
    expect(applied).toHaveLength(0);
  });
});

describe("planPartyMerge", () => {
  test("skips source names equal to the target name", () => {
    const { plan } = planPartyMerge({
      orgId: "orgA",
      targetId: 1,
      sourceIds: [2],
      parties: [party(1, "GitHub"), party(2, "github", ["Github, Inc."])],
      matchAccounts: [],
    });
    expect(plan.aliases).toEqual(["Github, Inc."]);
  });
});

describe("repointIds", () => {
  test("replaces sources with the target and dedupes", () => {
    expect(repointIds([2, 1, 3, 4], [2, 3], 1)).toEqual([1, 4]);
    expect(repointIds([4, 5], [2, 3], 1)).toBeNull();
  });
});

describe("isMergeGuardFailure", () => {
  test("detects the guard's division by zero, also when wrapped in a cause", () => {
    expect(isMergeGuardFailure(new Error("division by zero"))).toBe(true);
    expect(isMergeGuardFailure(new Error("Failed query: …", { cause: new Error("division by zero") }))).toBe(true);
    expect(isMergeGuardFailure(new Error("unique violation"))).toBe(false);
    expect(isMergeGuardFailure("division by zero")).toBe(false);
  });
});

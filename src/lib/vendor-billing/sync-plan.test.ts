import { describe, expect, test } from "bun:test";
import { aggregateCostLines, azureCostResource, monthChunks, syncWindowStart, UNALLOCATED_LABEL } from "./sync-plan";

describe("sync window", () => {
  test("first sync: 13 months back from the 1st", () => {
    expect(syncWindowStart(null, "2026-10-12")).toBe("2025-09-01");
  });
  test("later: last invoice − 60 days", () => {
    expect(syncWindowStart("2026-10-09", "2026-10-12")).toBe("2026-08-10");
  });
  test("month chunks ≤ 12 months", () => {
    expect(monthChunks("2025-09-01", "2026-10-12")).toEqual([
      { from: "2025-09-01", to: "2026-08-31" },
      { from: "2026-09-01", to: "2026-10-12" },
    ]);
    expect(monthChunks("2026-08-10", "2026-10-12")).toEqual([{ from: "2026-08-01", to: "2026-10-12" }]);
  });
});

describe("cost lines", () => {
  const subs = [{ subscriptionId: "AAA-111", displayName: "SE-service-prod" }];
  test("Azure subscription name → id; empty → (未分配)", () => {
    expect(azureCostResource("SE-service-prod", "", subs)).toEqual({ resourceExternalId: "aaa-111", resourceName: "SE-service-prod" });
    expect(azureCostResource("", "", subs)).toEqual({ resourceExternalId: "", resourceName: UNALLOCATED_LABEL });
    expect(azureCostResource("Gone sub", "", subs)).toEqual({ resourceExternalId: "Gone sub", resourceName: "Gone sub" });
  });
  test("duplicate keys are summed (one upsert row per key)", () => {
    const rows = aggregateCostLines([
      { month: "2026-09-01", resourceExternalId: "", resourceName: UNALLOCATED_LABEL, service: "", amount: -12, currency: "TWD" },
      { month: "2026-09-01", resourceExternalId: "", resourceName: UNALLOCATED_LABEL, service: "", amount: -3.5, currency: "TWD" },
      { month: "2026-09-01", resourceExternalId: "aaa", resourceName: "x", service: "VM", amount: 10, currency: "TWD" },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0].amount).toBe(-15.5);
  });
});

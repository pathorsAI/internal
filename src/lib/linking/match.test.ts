import { describe, expect, test } from "bun:test";
import { amountMatches, decideAutoLink, scoreCandidates } from "./match";
import { normalizePartyKey, partySimilarity, rankSimilarParties } from "./party-similarity";
import { deriveProjectStatus, contractReadyToClose } from "./project-status";

const base = { contractId: null, projectId: null, subscriptionPeriod: null, currency: "USD" };

describe("amountMatches", () => {
  test("exact and fee-deducted amounts match, overpayment does not", () => {
    expect(amountMatches(4500, 4500, "USD")).toBe(true);
    expect(amountMatches(4470, 4500, "USD")).toBe(true); // 電匯費 30
    expect(amountMatches(4400, 4500, "USD")).toBe(false);
    expect(amountMatches(4600, 4500, "USD")).toBe(false);
    expect(amountMatches(99_900, 100_000, "TWD")).toBe(true);
    expect(amountMatches(0, 0, "TWD")).toBe(false);
  });
});

describe("decideAutoLink", () => {
  test("unique matching candidate links", () => {
    const c = scoreCandidates(
      [
        { ...base, kind: "subscription", id: 1, label: "月費", expected: 4500 },
        { ...base, kind: "billing_item", id: 2, label: "建置", expected: 6000 },
      ],
      4480,
    );
    const d = decideAutoLink(c);
    expect(d.kind).toBe("link");
    if (d.kind === "link") expect(d.pick.id).toBe(1);
  });
  test("several matches → ambiguous; none matching → amount mismatch; no candidates → none", () => {
    const two = scoreCandidates(
      [
        { ...base, kind: "billing_item", id: 1, label: "a", expected: 6000 },
        { ...base, kind: "billing_item", id: 2, label: "b", expected: 6000 },
      ],
      6000,
    );
    expect(decideAutoLink(two)).toMatchObject({ kind: "review", reason: "link_ambiguous" });
    const off = scoreCandidates([{ ...base, kind: "subscription", id: 1, label: "月費", expected: 4500 }], 10_500);
    expect(decideAutoLink(off)).toMatchObject({ kind: "review", reason: "link_amount_mismatch" });
    expect(decideAutoLink([])).toEqual({ kind: "none" });
  });
});

describe("party similarity", () => {
  test("normalizes suffixes and punctuation", () => {
    expect(normalizePartyKey("HNT Marketing, LLC")).toBe("hnt marketing");
    expect(normalizePartyKey("派斯科技股份有限公司")).toBe("派斯科技");
  });
  test("near-identical names are similar, unrelated are not", () => {
    expect(partySimilarity("HNT Marketing LLC", "HNT Marketing Inc.")).toBe(1);
    expect(partySimilarity("HNT", "HNT Marketing LLC")).toBeGreaterThanOrEqual(0.8);
    expect(partySimilarity("Zonic Design & Imaging LLC", "Zonic Design and Imaging")).toBeGreaterThanOrEqual(0.8);
    expect(partySimilarity("Google", "Amazon")).toBeLessThan(0.8);
    expect(partySimilarity("AI", "AI3")).toBeLessThan(0.8);
  });
  test("rankSimilarParties uses names and aliases", () => {
    const parties = [
      { id: 1, name: "HNT Marketing LLC", aliases: ["Harry Kuo"] },
      { id: 2, name: "Google", aliases: [] },
    ];
    expect(rankSimilarParties(parties, "Harry  Kuo.").map((p) => p.id)).toEqual([1]);
    expect(rankSimilarParties(parties, "Stripe")).toEqual([]);
  });
});

describe("project status", () => {
  test("derived from contracts and subscriptions, manual archive overrides", () => {
    expect(deriveProjectStatus({ manualStatus: "active", contractStatuses: [], subscriptionStatuses: [] })).toBe("empty");
    expect(deriveProjectStatus({ manualStatus: "active", contractStatuses: ["completed", "active"], subscriptionStatuses: [] })).toBe("active");
    expect(deriveProjectStatus({ manualStatus: "active", contractStatuses: ["completed", "cancelled"], subscriptionStatuses: ["ended"] })).toBe("completed");
    expect(deriveProjectStatus({ manualStatus: "active", contractStatuses: ["completed"], subscriptionStatuses: ["paused"] })).toBe("active");
    expect(deriveProjectStatus({ manualStatus: "archived", contractStatuses: ["active"], subscriptionStatuses: [] })).toBe("archived");
  });
  test("contract ready to close", () => {
    expect(contractReadyToClose({ status: "active", amount: 100, received: 100 })).toBe(true);
    expect(contractReadyToClose({ status: "completed", amount: 100, received: 100 })).toBe(false);
    expect(contractReadyToClose({ status: "draft", amount: 0, received: 5 })).toBe(false);
  });
});

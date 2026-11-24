import { describe, expect, test } from "bun:test";
import { parseLinkCandidates, parsePendingParty } from "./pending";
import { partySimilarity, rankSimilarParties, similarPartiesWithin } from "./party-similarity";

describe("link_candidates parsing", () => {
  test("keeps well-formed candidates and drops junk", () => {
    const got = parseLinkCandidates({
      links: [
        { kind: "billing_item", id: 3, label: "HNT・第一期", contractId: 1, projectId: null, subscriptionPeriod: null, expected: 1000, currency: "USD", gap: 15, amountMatches: true },
        { kind: "nope", id: 4 },
        { kind: "contract", id: "7", expected: "200.5" },
        null,
      ],
    });
    expect(got).toEqual([
      { kind: "billing_item", id: 3, label: "HNT・第一期", contractId: 1, projectId: null, subscriptionPeriod: null, expected: 1000, currency: "USD", gap: 15, amountMatches: true },
      { kind: "contract", id: 7, label: "#7", contractId: null, projectId: null, subscriptionPeriod: null, expected: 200.5, currency: "", gap: 0, amountMatches: false },
    ]);
    expect(parseLinkCandidates(null)).toEqual([]);
    expect(parseLinkCandidates({ party: {} })).toEqual([]);
  });

  test("pending party", () => {
    expect(parsePendingParty({ party: { name: "HNT", label: "customer", candidates: [{ id: 2, name: "HNT Marketing LLC", score: 0.9, via: "name" }] } })).toEqual({
      name: "HNT",
      label: "customer",
      candidates: [{ id: 2, name: "HNT Marketing LLC", score: 0.9, via: "name" }],
    });
    expect(parsePendingParty({ links: [] })).toBeNull();
  });
});

describe("similarPartiesWithin", () => {
  const pool = [
    { id: 1, name: "HNT", aliases: [] },
    { id: 2, name: "HNT Marketing LLC", aliases: [] },
    { id: 3, name: "Google", aliases: ["Google Cloud *"] },
    { id: 4, name: "Gooogle", aliases: [] },
    { id: 5, name: "Cloudflare", aliases: [] },
    { id: 6, name: "Google Cloud Taiwan", aliases: [] },
  ];

  test("same answer as ranking each party against the others", () => {
    const fast = similarPartiesWithin(pool, 3);
    for (const p of pool) {
      const slow = rankSimilarParties(pool.filter((q) => q.id !== p.id), p.name, 3);
      expect(fast.get(p.id) ?? []).toEqual(slow);
    }
    expect(fast.get(1)?.map((s) => s.id)).toEqual([2]);
    expect(fast.has(5)).toBe(false);
  });

  test("edit distance right at the threshold still counts", () => {
    // 10 字元差 2 個 = 0.8（浮點數邊界）
    expect(partySimilarity("abcdefghij", "abcdefghxy")).toBeCloseTo(0.8);
    const got = similarPartiesWithin([
      { id: 1, name: "abcdefghij", aliases: [] },
      { id: 2, name: "abcdefghxy", aliases: [] },
    ]);
    expect(got.get(1)?.[0]?.id).toBe(2);
  });
});

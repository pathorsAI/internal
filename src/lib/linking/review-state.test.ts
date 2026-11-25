import { describe, expect, test } from "bun:test";
import { reviewStateOf, type TxnRow } from "./write";
import type { LinkResolution } from "./resolve";

const resolved = (over: Partial<LinkResolution["values"]> = {}): LinkResolution["values"] => ({
  projectId: null,
  contractId: null,
  subscriptionId: null,
  subscriptionPeriod: null,
  billingItemId: null,
  vendorBillingAccountId: null,
  reviewReason: null,
  linkCandidates: null,
  ...over,
});

const existing = (reviewReason: string | null): TxnRow =>
  ({ reviewReason, linkCandidates: reviewReason ? { links: [{ id: 32 }] } : null }) as unknown as TxnRow;

describe("reviewStateOf", () => {
  test("沒重新比對、沒有分配：保留原本的待連結狀態", () => {
    const v = reviewStateOf(resolved(), existing("link_suggested"), {}, false, false, false);
    expect(v.reviewReason).toBe("link_suggested");
    expect(v.linkCandidates).not.toBeNull();
  });

  test("有收款分配：舊的 link_* 旗標與候選清掉（#1505 這種，分配之前留下的建議）", () => {
    for (const reason of ["link_suggested", "link_ambiguous", "link_amount_mismatch"]) {
      const v = reviewStateOf(resolved(), existing(reason), {}, false, false, true);
      expect(v.reviewReason).toBeNull();
      expect(v.linkCandidates).toBeNull();
    }
  });

  test("有收款分配也不動 party_similar 與 link_skipped", () => {
    expect(reviewStateOf(resolved(), existing("party_similar"), {}, false, false, true).reviewReason).toBe("party_similar");
    expect(reviewStateOf(resolved(), existing("link_skipped"), {}, false, false, true).reviewReason).toBe("link_skipped");
  });
});

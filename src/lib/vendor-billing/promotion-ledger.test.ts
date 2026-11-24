import { describe, expect, test } from "bun:test";
import { booksPromotionCredits } from "./account-meta";
import {
  pendingPromotionTransactions,
  pickCloudCategory,
  planPromotionTransactions,
  PROMOTION_INCOME_CATEGORY,
} from "./promotion-ledger";

const ACCT = "01CBC3-343D16-C6AE22";
const months = [
  { billingAccountId: ACCT, month: "2026-08-01", periodEnd: "2026-08-31", amount: 735.55, currency: "USD" },
  { billingAccountId: ACCT, month: "2026-10-01", periodEnd: "2026-10-31", amount: 5670.33, currency: "USD" },
];

describe("promotion credits → management books", () => {
  test("two entries per month with stable external refs", () => {
    const plan = planPromotionTransactions(months);
    expect(plan.map((p) => [p.externalRef, p.type, p.amount, p.txnDate, p.description])).toEqual([
      [`${ACCT}:202608:promo-usage`, "expense", "735.55", "2026-08-31", "GCP 2026-08 用量（點數抵用部分）"],
      [`${ACCT}:202608:promo-credit`, "income", "735.55", "2026-08-31", "GCP 2026-08 抵用點數"],
      [`${ACCT}:202610:promo-usage`, "expense", "5670.33", "2026-10-31", "GCP 2026-10 用量（點數抵用部分）"],
      [`${ACCT}:202610:promo-credit`, "income", "5670.33", "2026-10-31", "GCP 2026-10 抵用點數"],
    ]);
    expect(planPromotionTransactions(months)).toEqual(plan);
  });

  test("idempotent: refs already in the ledger (even deleted ones) are not created again", () => {
    const plan = planPromotionTransactions(months);
    expect(pendingPromotionTransactions(plan, new Set(plan.map((p) => p.externalRef)))).toEqual([]);
    // 有人刪掉了 8 月的收入那筆 → existingRefs 仍包含它（查詢不看 deleted_at），不會長回來
    const existing = new Set([`${ACCT}:202608:promo-usage`, `${ACCT}:202608:promo-credit`]);
    expect(pendingPromotionTransactions(plan, existing).map((p) => p.externalRef)).toEqual([
      `${ACCT}:202610:promo-usage`,
      `${ACCT}:202610:promo-credit`,
    ]);
  });

  test("setting: GCP defaults on, off only when explicitly false, other providers never", () => {
    expect(booksPromotionCredits("gcp", {})).toBe(true);
    expect(booksPromotionCredits("gcp", null)).toBe(true);
    expect(booksPromotionCredits("gcp", { bookPromotionCredits: false })).toBe(false);
    expect(booksPromotionCredits("azure", { bookPromotionCredits: true })).toBe(false);
  });

  test("cloud category: only an existing cloud-like expense category, never invented", () => {
    expect(pickCloudCategory([{ id: 1, name: "薪資費用", kind: "expense" }, { id: 2, name: PROMOTION_INCOME_CATEGORY, kind: "income" }])).toBeNull();
    expect(pickCloudCategory([{ id: 1, name: "薪資費用", kind: "expense" }, { id: 5, name: "雲端服務費", kind: "expense" }])).toBe(5);
    expect(pickCloudCategory([{ id: 7, name: "Cloud hosting", kind: "income" }])).toBeNull();
  });
});

import { describe, expect, test } from "bun:test";
import { planCardSync, sameCard, type ExistingPaymentMethod } from "./card-dedupe";

const azureCard = {
  externalRef: "Rq1hogIAAAACAACA",
  kind: "card",
  brand: "MasterCard",
  last4: "2579",
  expiryMonth: 10,
  expiryYear: 2028,
};
const manual = (id: number, p: Partial<ExistingPaymentMethod> = {}): ExistingPaymentMethod => ({
  id,
  kind: "card",
  source: "manual",
  externalRef: null,
  brand: "Mastercard",
  last4: "2579",
  expiryMonth: 10,
  expiryYear: 2028,
  ...p,
});

describe("Azure card dedupe", () => {
  test("brand is compared case-insensitively; all facts must match", () => {
    expect(sameCard(azureCard, manual(1))).toBe(true);
    expect(sameCard(azureCard, manual(1, { expiryYear: 2029 }))).toBe(false);
    expect(sameCard(azureCard, manual(1, { last4: "4306" }))).toBe(false);
    expect(sameCard(azureCard, manual(1, { brand: "Visa" }))).toBe(false);
  });

  test("exactly one identical manual card → adopt it", () => {
    expect(planCardSync(azureCard, [manual(7), manual(8, { last4: "4306" })])).toEqual({ action: "adopt", id: 7 });
  });

  test("no identical card → create a new one", () => {
    expect(planCardSync(azureCard, [manual(8, { last4: "4306" })])).toEqual({ action: "upsert" });
  });

  test("several identical cards → conflict, nothing created or linked", () => {
    expect(planCardSync(azureCard, [manual(7), manual(9)])).toEqual({ action: "conflict", ids: [7, 9] });
  });

  test("an existing record with the same Azure id always wins (update in place)", () => {
    const synced = manual(5, { source: "azure", externalRef: "Rq1hogIAAAACAACA" });
    expect(planCardSync(azureCard, [synced, manual(7), manual(9)])).toEqual({ action: "upsert" });
  });

  test("cards already linked to some external id are never adopted", () => {
    expect(planCardSync(azureCard, [manual(7, { source: "azure", externalRef: "OTHER" })])).toEqual({ action: "upsert" });
  });

  test("non-card payment methods and cards without last4 are not deduped", () => {
    expect(planCardSync({ ...azureCard, kind: "other" }, [manual(7)])).toEqual({ action: "upsert" });
    expect(planCardSync({ ...azureCard, last4: null }, [manual(7, { last4: null })])).toEqual({ action: "upsert" });
    expect(planCardSync(azureCard, [manual(7, { kind: "wise_card" })])).toEqual({ action: "upsert" });
  });
});

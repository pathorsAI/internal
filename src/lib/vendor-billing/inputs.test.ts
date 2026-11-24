import { describe, expect, test } from "bun:test";
import {
  applyScheduleRules,
  forbiddenSyncedFields,
  normalizeBillingAccountInput,
  normalizePaymentMethodInput,
  SYNCED_ACCOUNT_EDITABLE,
  VendorBillingInputError,
} from "./inputs";

describe("payment method input", () => {
  test("a full card number is rejected, never truncated", () => {
    expect(() => normalizePaymentMethodInput({ kind: "card", label: "x", last4: "5412 7512 3456 2579" })).toThrow(/完整卡號/);
  });
  test("last4 / expiry are normalized", () => {
    expect(
      normalizePaymentMethodInput({ kind: "card", label: "MasterCard •2579", last4: "•2579", expiryMonth: "10", expiryYear: 28 }),
    ).toEqual({ id: null, kind: "card", label: "MasterCard •2579", last4: "2579", expiryMonth: 10, expiryYear: 2028 });
  });
  test("PATCH semantics: untouched fields stay out", () => {
    expect(normalizePaymentMethodInput({ id: 3, note: "x" })).toEqual({ id: 3, note: "x" });
  });
  test("create needs kind + label; bad month rejected", () => {
    expect(() => normalizePaymentMethodInput({ label: "x" })).toThrow(VendorBillingInputError);
    expect(() => normalizePaymentMethodInput({ id: 1, expiryMonth: 13 })).toThrow(/1～12/);
  });
});

describe("billing account input", () => {
  test("match parties deduped; bad ids rejected", () => {
    expect(normalizeBillingAccountInput({ id: 1, matchPartyIds: [3, 3, "4"] }).matchPartyIds).toEqual([3, 4]);
    expect(() => normalizeBillingAccountInput({ id: 1, partyId: -2 })).toThrow(VendorBillingInputError);
    expect(() => normalizeBillingAccountInput({ id: 1, ledgerMode: "book_everything" })).toThrow();
  });
  test("synced accounts: platform-owned fields are flagged", () => {
    const patch = normalizeBillingAccountInput({ id: 1, displayName: "renamed", partyId: 2 });
    expect(forbiddenSyncedFields(patch, SYNCED_ACCOUNT_EDITABLE)).toEqual(["displayName"]);
  });
});

describe("schedule (固定支出) fields", () => {
  test("parsed and validated", () => {
    expect(
      normalizeBillingAccountInput({
        id: 1,
        schedule: "fixed",
        anchorDate: "2026-01-31",
        intervalMonths: "12",
        expectedAmount: "1,234.5",
        currency: "usd",
        billingUrl: "https://console.cloud.google.com/billing",
      }),
    ).toEqual({
      id: 1,
      schedule: "fixed",
      anchorDate: "2026-01-31",
      intervalMonths: 12,
      expectedAmount: "1234.5",
      currency: "USD",
      billingUrl: "https://console.cloud.google.com/billing",
    });
    expect(normalizeBillingAccountInput({ id: 1, schedule: "none" }).schedule).toBeNull();
    expect(() => normalizeBillingAccountInput({ id: 1, schedule: "weekly" })).toThrow(VendorBillingInputError);
    expect(() => normalizeBillingAccountInput({ id: 1, intervalMonths: 0 })).toThrow(/1～36/);
    expect(() => normalizeBillingAccountInput({ id: 1, anchorDate: "2026/01/31" })).toThrow(/YYYY-MM-DD/);
    expect(() => normalizeBillingAccountInput({ id: 1, billingUrl: "javascript:alert(1)" })).toThrow(/http/);
  });

  test("synced accounts may set a schedule", () => {
    const patch = normalizeBillingAccountInput({ id: 1, schedule: "usage", expectedAmount: 30 });
    expect(forbiddenSyncedFields(patch, SYNCED_ACCOUNT_EDITABLE)).toEqual([]);
  });

  test("cross-field rules", () => {
    const none = { schedule: null, anchorDate: null, expectedAmount: null, currency: null };
    expect(() => applyScheduleRules({ id: null, schedule: "fixed" }, null)).toThrow(/扣款日/);
    expect(applyScheduleRules({ id: 1, expectedAmount: "10" }, none).currency).toBe("TWD");
    const fixed = { schedule: "fixed", anchorDate: "2026-01-05", expectedAmount: "10", currency: "USD" };
    expect(applyScheduleRules({ id: 1, schedule: "usage" }, fixed)).toEqual({ id: 1, schedule: "usage", anchorDate: null });
    expect(applyScheduleRules({ id: 1, expectedAmount: null }, fixed)).toEqual({ id: 1, expectedAmount: null, currency: null });
    expect(applyScheduleRules({ id: 1, note: "x" }, fixed)).toEqual({ id: 1, note: "x" });
  });
});

describe("rejected transaction list", () => {
  test("unlink adds, manual link removes", async () => {
    const { withRejected, parseRejectedTransactionIds } = await import("./account-meta");
    expect(withRejected([], [7, null])).toEqual([7]);
    expect(withRejected([7], [7, 8])).toEqual([7, 8]);
    expect(withRejected([7, 8], [], 7)).toEqual([8]);
    expect(parseRejectedTransactionIds({ rejectedTransactionIds: [3, "4", -1, "x", 3] })).toEqual([3, 4]);
    expect(parseRejectedTransactionIds({})).toEqual([]);
  });
});

import { describe, expect, test } from "bun:test";
import { cardExpiry, computeAttention, isProviderOverdue, parseTimestamp } from "./attention";

const today = "2026-10-12";

describe("card expiry", () => {
  test("ok / warn (≤ 90 days) / expired, by the last day of the month", () => {
    expect(cardExpiry(10, 2028, today)?.state).toBe("ok");
    expect(cardExpiry(12, 2026, today)).toEqual({ state: "warn", daysLeft: 80 });
    expect(cardExpiry(10, 2026, today)).toEqual({ state: "warn", daysLeft: 19 });
    expect(cardExpiry(9, 2026, today)?.state).toBe("expired");
    expect(cardExpiry(null, 2026, today)).toBeNull();
  });
});

test("DB timestamps parse", () => {
  expect(parseTimestamp("2026-09-24 10:00:00.123+00").toISOString()).toBe("2026-09-24T10:00:00.123Z");
});

describe("attention list", () => {
  const base = {
    today,
    paymentMethods: [
      { id: 1, label: "MasterCard •2579", kind: "card", isActive: true, expiryMonth: 10, expiryYear: 2028 },
      { id: 2, label: "Visa •4306", kind: "card", isActive: true, expiryMonth: 11, expiryYear: 2026 },
      { id: 3, label: "Old", kind: "card", isActive: false, expiryMonth: 1, expiryYear: 2020 },
    ],
    accounts: [
      { id: 10, displayName: "鄭宇傑（國泰）", provider: "azure", source: "synced", status: "active", paymentMethodId: 1, lastVerifiedAt: null, updatedAt: "2026-01-01 00:00:00+00" },
      { id: 11, displayName: "Cloudflare", provider: "cloudflare", source: "manual", status: "active", paymentMethodId: null, lastVerifiedAt: "2026-03-01 00:00:00+00", updatedAt: "2026-03-01 00:00:00+00" },
      { id: 12, displayName: "Gone", provider: "gcp", source: "synced", status: "missing", paymentMethodId: 1, lastVerifiedAt: null, updatedAt: "2026-10-01 00:00:00+00" },
    ],
    resources: [
      { id: 100, billingAccountId: 10, name: "Azure for Students", externalId: "x", status: "missing", updatedAt: "2026-10-10 00:00:00+00" },
      { id: 101, billingAccountId: 10, name: "old", externalId: "y", status: "missing", updatedAt: "2026-01-10 00:00:00+00" },
    ],
    invoices: [
      { id: 1000, billingAccountId: 10, externalRef: "G183233701", invoiceDate: "2026-09-09", amount: 4280, currency: "TWD", matchStatus: "unmatched" as const, providerStatus: "OverDue", amountDue: 4280 },
      { id: 1001, billingAccountId: 10, externalRef: "G151051979", invoiceDate: "2026-04-09", amount: 4338, currency: "TWD", matchStatus: "unmatched" as const, providerStatus: "Paid", amountDue: 0 },
      { id: 1002, billingAccountId: 10, externalRef: "G189867442", invoiceDate: "2026-10-09", amount: 3987, currency: "TWD", matchStatus: "unmatched" as const, providerStatus: "Paid", amountDue: 0 },
    ],
  };
  const items = computeAttention(base);
  const kinds = items.map((i) => i.kind);

  test("expiring card, no payment method, stale manual account", () => {
    expect(items).toContainEqual({ kind: "card_expiring", paymentMethodId: 2, label: "Visa •4306", daysLeft: 49 });
    expect(items).toContainEqual({ kind: "no_payment_method", billingAccountId: 11, label: "Cloudflare" });
    expect(items).toContainEqual(expect.objectContaining({ kind: "stale_verification", billingAccountId: 11 }));
    expect(kinds.filter((k) => k === "card_expired")).toEqual([]); // 停用的卡不提醒
  });

  test("overdue at the provider is surfaced (Azure 帳單逾期未付 TWD 4,280)", () => {
    expect(items).toContainEqual(expect.objectContaining({ kind: "invoice_overdue", invoiceId: 1000, amount: 4280, currency: "TWD" }));
    expect(isProviderOverdue({ providerStatus: "Due", amountDue: 100, invoiceDate: "2026-10-09" }, today)).toBe(false);
    expect(isProviderOverdue({ providerStatus: "Due", amountDue: 100, invoiceDate: "2026-08-01" }, today)).toBe(true);
  });

  test("unmatched only after 45 days", () => {
    expect(items.filter((i) => i.kind === "invoice_unmatched").map((i) => ("invoiceId" in i ? i.invoiceId : 0))).toEqual([1001]);
  });

  test("only recently missing accounts / resources", () => {
    expect(items).toContainEqual({ kind: "account_missing", billingAccountId: 12, label: "Gone" });
    expect(items.filter((i) => i.kind === "resource_missing").map((i) => ("resourceId" in i ? i.resourceId : 0))).toEqual([100]);
  });
});

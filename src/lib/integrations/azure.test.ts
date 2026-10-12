import { describe, expect, test } from "bun:test";
import {
  assertAzureReadOnly,
  makeAzureClient,
  parseCostQuery,
  parseExpiration,
  parseInvoices,
  parsePaymentMethodLinks,
  subscriptionResourceStatus,
} from "./azure";

const BA = "8369e875-ffc0-56f1-7e79-83b5815e6d84:09d0934e-5aba-4d36-9346-78bbd5642790_2019-05-31";
const BP = "eb362146-d231-4280-a8c9-8c8385057f52";
const ARM = "https://management.azure.com/providers/Microsoft.Billing/billingAccounts";

describe("paymentMethodLinks", () => {
  const sample = {
    value: [
      {
        id: `/providers/Microsoft.Billing/billingAccounts/${BA}/billingProfiles/${BP}/paymentMethodLinks/Rq1hogIAAAACAACA`,
        name: "Rq1hogIAAAACAACA",
        properties: {
          accountHolderName: "鄭宇傑",
          displayName: "MasterCard",
          expiration: "10/2028",
          family: "CreditCard",
          lastFourDigits: "2579",
          paymentMethodType: "mc",
          status: "active",
        },
      },
    ],
  };

  test("card fields come straight from properties; no full number anywhere", () => {
    const [pm] = parsePaymentMethodLinks(sample);
    expect(pm).toEqual({
      externalRef: "Rq1hogIAAAACAACA",
      kind: "card",
      label: "MasterCard •2579",
      brand: "MasterCard",
      last4: "2579",
      expiryMonth: 10,
      expiryYear: 2028,
      holderName: "鄭宇傑",
      status: "active",
    });
  });

  test("the payment method id (shared across profiles) wins over the link name", () => {
    const [pm] = parsePaymentMethodLinks({
      value: [{ name: "link-1", properties: { paymentMethodId: "/providers/Microsoft.Billing/paymentMethods/PM123", lastFourDigits: "4306", displayName: "Visa", family: "CreditCard" } }],
    });
    expect(pm.externalRef).toBe("PM123");
    expect(pm.label).toBe("Visa •4306");
  });

  test("bad last4 / expiry are dropped, not stored", () => {
    const [pm] = parsePaymentMethodLinks({ value: [{ name: "x", properties: { lastFourDigits: "12345", expiration: "13/2028", family: "DirectDebit" } }] });
    expect(pm.last4).toBeNull();
    expect(pm.expiryMonth).toBeNull();
    expect(pm.kind).toBe("other");
  });

  test("expiration formats", () => {
    expect(parseExpiration("10/2028")).toEqual({ month: 10, year: 2028 });
    expect(parseExpiration("6/31")).toEqual({ month: 6, year: 2031 });
    expect(parseExpiration("2031-06")).toEqual({ month: 6, year: 2031 });
    expect(parseExpiration("garbage")).toBeNull();
  });
});

describe("invoices + costs", () => {
  test("invoice amount / currency / dates / amountDue", () => {
    const [inv] = parseInvoices({
      value: [
        {
          name: "G183233701",
          properties: {
            invoiceDate: "2026-09-09T00:00:00.0000000Z",
            invoicePeriodStartDate: "2026-08-09T00:00:00Z",
            invoicePeriodEndDate: "2026-09-08T00:00:00Z",
            totalAmount: { currency: "TWD", value: 4280 },
            amountDue: { currency: "TWD", value: 4280 },
            status: "OverDue",
          },
        },
      ],
    });
    expect(inv).toMatchObject({
      externalRef: "G183233701",
      invoiceDate: "2026-09-09",
      periodStart: "2026-08-09",
      periodEnd: "2026-09-08",
      amount: 4280,
      currency: "TWD",
      status: "OverDue",
      amountDue: 4280,
    });
  });

  test("cost query rows are read by column name; unallocated row kept", () => {
    const { rows } = parseCostQuery({
      properties: {
        columns: [
          { name: "Cost" },
          { name: "BillingMonth" },
          { name: "SubscriptionName" },
          { name: "ServiceName" },
          { name: "Currency" },
        ],
        rows: [
          [1234.5, "2026-09-01T00:00:00", "SE-service-prod", "Virtual Machines", "TWD"],
          [-12, "2026-09-01T00:00:00", "", "", "TWD"],
        ],
      },
    });
    expect(rows).toEqual([
      { month: "2026-09-01", subscriptionId: "", subscriptionName: "SE-service-prod", service: "Virtual Machines", amount: 1234.5, currency: "TWD" },
      { month: "2026-09-01", subscriptionId: "", subscriptionName: "", service: "", amount: -12, currency: "TWD" },
    ]);
  });

  test("subscription status: Deleted → missing", () => {
    expect(subscriptionResourceStatus("Active")).toBe("active");
    expect(subscriptionResourceStatus("Deleted")).toBe("missing");
    expect(subscriptionResourceStatus(null)).toBe("active");
  });
});

describe("read-only allowlist", () => {
  test("allowed reads", () => {
    expect(() => assertAzureReadOnly("GET", `${ARM}/${BA}/billingProfiles?api-version=2024-04-01`)).not.toThrow();
    expect(() => assertAzureReadOnly("GET", `${ARM}/${BA}/billingProfiles/${BP}/billingSubscriptions`)).not.toThrow();
    expect(() => assertAzureReadOnly("GET", `${ARM}/${BA}/billingProfiles/${BP}/paymentMethodLinks`)).not.toThrow();
    expect(() => assertAzureReadOnly("GET", `${ARM}/${BA}/billingProfiles/${BP}/invoices`)).not.toThrow();
    expect(() =>
      assertAzureReadOnly("POST", `${ARM}/${BA}/billingProfiles/${BP}/providers/Microsoft.CostManagement/query`),
    ).not.toThrow();
    expect(() => assertAzureReadOnly("POST", "https://login.microsoftonline.com/tenant-1/oauth2/v2.0/token")).not.toThrow();
  });

  test("writes, other paths and other hosts are refused", () => {
    expect(() => assertAzureReadOnly("PUT", `${ARM}/${BA}/billingProfiles/${BP}`)).toThrow();
    expect(() => assertAzureReadOnly("DELETE", `${ARM}/${BA}/billingProfiles/${BP}/paymentMethodLinks`)).toThrow();
    expect(() => assertAzureReadOnly("POST", `${ARM}/${BA}/billingProfiles/${BP}/invoices`)).toThrow();
    expect(() => assertAzureReadOnly("GET", "https://management.azure.com/subscriptions/x/resourceGroups")).toThrow();
    expect(() => assertAzureReadOnly("GET", `https://evil.example.com/providers/Microsoft.Billing/billingAccounts`)).toThrow();
    expect(() => assertAzureReadOnly("GET", `http://management.azure.com/providers/Microsoft.Billing/billingAccounts`)).toThrow();
  });

  test("the client follows nextLink but still checks it against the allowlist", async () => {
    const seen: string[] = [];
    const fakeFetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      seen.push(url);
      if (url.includes("skiptoken")) {
        return Response.json({ value: [], nextLink: "https://evil.example.com/steal" });
      }
      return Response.json({ value: [{ name: "a" }], nextLink: `${ARM}/${BA}/billingProfiles?api-version=2024-04-01&$skiptoken=2` });
    }) as typeof fetch;
    const client = makeAzureClient(async () => "token", fakeFetch);
    await expect(client.listBillingProfiles({ id: BA, displayName: null, agreementType: null })).rejects.toThrow(/白名單/);
    expect(seen.some((u) => u.includes("evil"))).toBe(false);
  });
});

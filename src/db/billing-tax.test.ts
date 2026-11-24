import { describe, expect, test } from "bun:test";
import { computeSubscriptionSchedule, deriveBillingStatus } from "./queries";

const today = "2026-11-25";

describe("computeSubscriptionSchedule with 營業稅別", () => {
  const sub = {
    amount: "17400",
    intervalMonths: 3,
    startDate: "2026-07-01",
    endDate: null,
    currency: "TWD",
    taxSetting: { treatment: "taxable", basis: "net" } as const,
  };

  test("expected is gross; receiving only the net amount is partial", () => {
    const { periods, totalOutstanding } = computeSubscriptionSchedule(
      sub,
      [
        { periodStart: "2026-07-01", paid: 18270 },
        { periodStart: "2026-10-01", paid: 17400 },
      ],
      [],
      today,
    );
    const [q3, q4, next] = periods;
    expect(q3).toMatchObject({ amount: 17400, net: 17400, tax: 870, expected: 18270, status: "paid" });
    expect(q4).toMatchObject({ expected: 18270, paid: 17400, status: "partial" });
    expect(next).toMatchObject({ periodStart: "2027-01-01", status: "upcoming" });
    expect(totalOutstanding).toBe(870);
  });

  test("set_subscription_period overrides are in the subscription's basis and get taxed too", () => {
    const { periods } = computeSubscriptionSchedule(
      sub,
      [],
      [
        {
          periodStart: "2026-07-01",
          expectedAmount: 11600,
          note: "transition",
          dueDate: null,
          billedOn: null,
          invoicedOn: null,
        },
      ],
      today,
    );
    expect(periods[0]).toMatchObject({ amount: 11600, tax: 580, expected: 12180, isOverride: true });
  });

  test("no tax setting → expected equals the amount (no tax)", () => {
    const { periods } = computeSubscriptionSchedule(
      { amount: "1000", intervalMonths: 1, startDate: "2026-11-01", endDate: null },
      [{ periodStart: "2026-11-01", paid: 1000 }],
      [],
      today,
    );
    expect(periods[0]).toMatchObject({ expected: 1000, tax: 0, status: "paid" });
  });
});

describe("deriveBillingStatus against the gross receivable", () => {
  const base = { dueDate: "2026-11-01", billedOn: "2026-11-01", paymentTermsDays: 30 };
  test("paid in full only once gross is reached", () => {
    expect(deriveBillingStatus({ ...base, expected: 18270, paid: 17400 }, today)).toBe("partial");
    expect(deriveBillingStatus({ ...base, expected: 18270, paid: 18270 }, today)).toBe("paid");
  });
  test("overdue past billedOn + terms when nothing is received", () => {
    expect(deriveBillingStatus({ ...base, expected: 18270, paid: 0 }, "2026-12-15")).toBe("overdue");
  });
});

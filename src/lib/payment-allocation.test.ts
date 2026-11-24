import { describe, expect, test } from "bun:test";
import {
  absorbShortfall,
  allocationTotals,
  collectedFor,
  effectiveAllocations,
  isLegacyMirror,
  isValidPeriod,
  legacyTarget,
  lineShortfall,
  parseTargetKey,
  prefillAmount,
  targetKey,
  validateAllocations,
  type AllocationInput,
  type AllocationTarget,
} from "./payment-allocation";
import { collectionProgress } from "./tax-amounts";

const period: AllocationTarget = { type: "subscription_period", subscriptionId: 7, period: "2026-10-01" };
const build: AllocationTarget = { type: "billing_item", billingItemId: 11 };
const usage: AllocationTarget = { type: "billing_item", billingItemId: 12 };
const contract: AllocationTarget = { type: "contract", contractId: 3 };

const noLegacy = { contractId: null, subscriptionId: null, subscriptionPeriod: null, billingItemId: null };

describe("targetKey / parseTargetKey", () => {
  test("round-trips every target type and matches the billing board row keys", () => {
    expect(targetKey(period)).toBe("sub:7:2026-10-01");
    expect(targetKey(build)).toBe("bi:11");
    expect(targetKey(contract)).toBe("c:3");
    for (const t of [period, build, contract]) expect(parseTargetKey(targetKey(t))).toEqual(t);
  });

  test("rejects malformed keys", () => {
    for (const k of ["", "bi:", "bi:0", "bi:x", "sub:7", "sub:7:2026-13-01", "c:-1", "x:1", "bi:1:2"]) {
      expect(parseTargetKey(k)).toBeNull();
    }
  });
});

describe("isValidPeriod", () => {
  test("accepts real dates only", () => {
    expect(isValidPeriod("2026-02-28")).toBe(true);
    expect(isValidPeriod("2028-02-29")).toBe(true);
    expect(isValidPeriod("2026-02-30")).toBe(false);
    expect(isValidPeriod("2026-2-1")).toBe(false);
    expect(isValidPeriod("20260201")).toBe(false);
  });
});

describe("validateAllocations", () => {
  const line = (target: AllocationTarget, amount: number, fee = 0): AllocationInput => ({ target, amount, fee });

  test("an empty set is valid (clears allocations)", () => {
    expect(validateAllocations(100, [])).toEqual({ ok: true });
  });

  test("amounts may add up to exactly the transaction amount; fees don't count toward it", () => {
    expect(validateAllocations(100, [line(build, 60), line(usage, 40, 5)])).toEqual({ ok: true });
  });

  test("over-allocation is refused (with float-safe rounding)", () => {
    expect(validateAllocations(0.3, [line(build, 0.1), line(usage, 0.2)])).toEqual({ ok: true });
    expect(validateAllocations(100, [line(build, 60), line(usage, 40.01)])).toEqual({
      ok: false,
      code: "overAllocated",
      index: null,
    });
  });

  test("negative amount / fee and empty lines are refused with the line index", () => {
    expect(validateAllocations(100, [line(build, 10), line(usage, -1)])).toEqual({
      ok: false,
      code: "negativeAmount",
      index: 1,
    });
    expect(validateAllocations(100, [line(build, 10, -1)])).toEqual({ ok: false, code: "negativeFee", index: 0 });
    expect(validateAllocations(100, [line(build, 0, 0)])).toEqual({ ok: false, code: "emptyLine", index: 0 });
    // fee-only line is fine: the whole shortfall absorbed on a target that got no money from this payment
    expect(validateAllocations(100, [line(build, 0, 3)])).toEqual({ ok: true });
  });

  test("duplicate targets and invalid periods are refused", () => {
    expect(validateAllocations(100, [line(build, 10), line(build, 20)])).toEqual({
      ok: false,
      code: "duplicateTarget",
      index: 1,
    });
    expect(
      validateAllocations(100, [
        line({ type: "subscription_period", subscriptionId: 7, period: "2026-09-31" }, 10),
      ]),
    ).toEqual({ ok: false, code: "invalidPeriod", index: 0 });
    expect(validateAllocations(100, [line({ type: "contract", contractId: 0 }, 10)])).toEqual({
      ok: false,
      code: "invalidTarget",
      index: 0,
    });
  });
});

describe("legacy fallback", () => {
  test("precedence: subscription period > billing item > contract", () => {
    expect(
      legacyTarget({ contractId: 3, billingItemId: 11, subscriptionId: 7, subscriptionPeriod: "2026-10-01" }),
    ).toEqual(period);
    expect(legacyTarget({ contractId: 3, billingItemId: 11, subscriptionId: 7, subscriptionPeriod: null })).toEqual(
      build,
    );
    expect(legacyTarget({ ...noLegacy, contractId: 3 })).toEqual(contract);
    expect(legacyTarget(noLegacy)).toBeNull();
  });

  test("a transaction without allocation rows counts in full through its single binding, fee 0", () => {
    expect(effectiveAllocations({ ...noLegacy, amount: 500, contractId: 3, billingItemId: 11 }, [])).toEqual([
      { target: build, amount: 500, fee: 0 },
    ]);
    expect(effectiveAllocations({ ...noLegacy, amount: 500 }, [])).toEqual([]);
  });

  test("a transaction with allocation rows is counted only through them (its binding is ignored)", () => {
    const rows: AllocationInput[] = [{ target: usage, amount: 200, fee: 1 }];
    expect(effectiveAllocations({ ...noLegacy, amount: 500, billingItemId: 11 }, rows)).toEqual(rows);
  });

  test("isLegacyMirror recognises only the migrated single-binding shape", () => {
    const txn = { ...noLegacy, amount: 500, contractId: 3 };
    expect(isLegacyMirror(txn, [{ target: contract, amount: 500, fee: 0 }])).toBe(true);
    expect(isLegacyMirror(txn, [{ target: contract, amount: 499, fee: 0 }])).toBe(false);
    expect(isLegacyMirror(txn, [{ target: contract, amount: 500, fee: 1 }])).toBe(false);
    expect(isLegacyMirror(txn, [{ target: build, amount: 500, fee: 0 }])).toBe(false);
    expect(isLegacyMirror(txn, [])).toBe(false);
    expect(
      isLegacyMirror(txn, [
        { target: contract, amount: 250, fee: 0 },
        { target: build, amount: 250, fee: 0 },
      ]),
    ).toBe(false);
  });
});

describe("collection counts amount + fee against the gross receivable", () => {
  // 請款 13,001.04 = 訂閱期別 4,000 + 建置分期 6,000 + 用量 3,001.04；
  // 兩筆入帳 12,841.83 + 93.79 = 12,935.62，被扣掉 65.42 的匯款手續費。
  const billed = { period: 4000, build: 6000, usage: 3001.04 };

  test("allocate 4,000 / 6,000 / 2,935.62 + fee 65.42 → all three collected", () => {
    const payment = 12841.83 + 93.79;
    const allocations: AllocationInput[] = [
      { target: period, amount: 4000, fee: 0 },
      { target: build, amount: 6000, fee: 0 },
      { target: usage, amount: 2935.62, fee: 65.42 },
    ];
    expect(validateAllocations(payment, allocations)).toEqual({ ok: true });
    expect(allocationTotals(payment, allocations)).toEqual({ allocated: 12935.62, unallocated: 0, fees: 65.42 });

    const p = collectedFor(period, allocations);
    const b = collectedFor(build, allocations);
    const u = collectedFor(usage, allocations);
    expect(u).toEqual({ collected: 3001.04, fee: 65.42 });
    expect(collectionProgress(billed.period, p.collected)).toEqual({ remaining: 0, fullyCollected: true });
    expect(collectionProgress(billed.build, b.collected)).toEqual({ remaining: 0, fullyCollected: true });
    expect(collectionProgress(billed.usage, u.collected)).toEqual({ remaining: 0, fullyCollected: true });
  });

  test("without the fee the usage line stays partial", () => {
    const u = collectedFor(usage, [{ target: usage, amount: 2935.62, fee: 0 }]);
    expect(collectionProgress(billed.usage, u.collected)).toEqual({ remaining: 65.42, fullyCollected: false });
  });

  test("collectedFor sums several payments to the same target", () => {
    const rows: AllocationInput[] = [
      { target: usage, amount: 1000, fee: 0 },
      { target: build, amount: 6000, fee: 0 },
      { target: usage, amount: 1935.62, fee: 65.42 },
    ];
    expect(collectedFor(usage, rows)).toEqual({ collected: 3001.04, fee: 65.42 });
  });
});

describe("sheet helpers", () => {
  test("prefill = min(unallocated, outstanding), never negative", () => {
    expect(prefillAmount(12935.62 - 10000, 3001.04)).toBe(2935.62);
    expect(prefillAmount(5000, 3001.04)).toBe(3001.04);
    expect(prefillAmount(-1, 100)).toBe(0);
  });

  test("absorbShortfall puts the line's own shortfall into its fee (default the last line)", () => {
    const lines = [
      { amount: 4000, fee: 0, outstanding: 4000 },
      { amount: 6000, fee: 0, outstanding: 6000 },
      { amount: 2935.62, fee: 0, outstanding: 3001.04 },
    ];
    const out = absorbShortfall(lines);
    expect(out[2].fee).toBe(65.42);
    expect(lineShortfall(out[2])).toBe(0);
    expect(out[0]).toBe(lines[0]);
    // a line that is already over-allocated gets fee 0, and unknown outstanding is left alone
    expect(absorbShortfall([{ amount: 10, fee: 4, outstanding: 5 }], 0)[0].fee).toBe(0);
    const unknown = [{ amount: 10, fee: 0, outstanding: null }];
    expect(absorbShortfall(unknown, 0)).toEqual(unknown);
  });
});

import { describe, expect, test } from "bun:test";
import { computeAmounts, invoiceTaxIncludedFor, invoiceTreatmentFor } from "./simpany-issue";

describe("invoice defaults from the source's 營業稅別", () => {
  test("taxable follows the amount basis", () => {
    const net = { treatment: "taxable", basis: "net" } as const;
    expect(invoiceTreatmentFor(net)).toBe("taxable");
    expect(invoiceTaxIncludedFor(net)).toBe(false);
    expect(computeAmounts(17400, "taxable", invoiceTaxIncludedFor(net))).toEqual({
      untaxed: 17400,
      tax: 870,
      total: 18270,
    });
    expect(invoiceTaxIncludedFor({ treatment: "taxable", basis: "gross" })).toBe(true);
  });
  test("zero_rated / exempt carry over; none and no source keep the old defaults", () => {
    expect(invoiceTreatmentFor({ treatment: "zero_rated", basis: "net" })).toBe("zero_rated");
    expect(invoiceTreatmentFor({ treatment: "exempt", basis: "net" })).toBe("exempt");
    expect(invoiceTreatmentFor({ treatment: "none", basis: "net" })).toBeUndefined();
    expect(invoiceTreatmentFor(undefined)).toBeUndefined();
    expect(invoiceTaxIncludedFor({ treatment: "none", basis: "net" })).toBe(true);
    expect(invoiceTaxIncludedFor(undefined)).toBe(true);
  });
});

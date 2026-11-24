import { describe, expect, test } from "bun:test";
import { DEFAULT_TAX_SETTING, resolveTaxSetting, taxBreakdown, taxBreakdownOrNull } from "./tax-treatment";

describe("resolveTaxSetting", () => {
  const org = { treatment: "none", basis: "net" };
  test("bound to a contract → the contract wins, NULL fields fall back to the org", () => {
    expect(resolveTaxSetting({ org, contract: { treatment: "taxable", basis: null }, own: { treatment: "exempt" } })).toEqual({
      treatment: "taxable",
      basis: "net",
    });
    expect(resolveTaxSetting({ org, contract: {} })).toEqual({ treatment: "none", basis: "net" });
  });
  test("no contract → own fields, NULL → org, missing org → default", () => {
    expect(resolveTaxSetting({ org, own: { basis: "gross" } })).toEqual({ treatment: "none", basis: "gross" });
    expect(resolveTaxSetting({ org, own: null })).toEqual({ treatment: "none", basis: "net" });
    expect(resolveTaxSetting({})).toEqual(DEFAULT_TAX_SETTING);
    expect(resolveTaxSetting({ org: { treatment: "bogus", basis: "x" } })).toEqual(DEFAULT_TAX_SETTING);
  });
});

describe("taxBreakdown", () => {
  test("taxable + net: 5,800 × 3 per quarter → 18,270 = 17,400 + 870", () => {
    expect(taxBreakdown(17400, { treatment: "taxable", basis: "net" })).toEqual({ net: 17400, tax: 870, gross: 18270 });
  });
  test("taxable + gross: net + tax always equals the amount", () => {
    const b = taxBreakdown(18270, { treatment: "taxable", basis: "gross" });
    expect(b).toEqual({ net: 17400, tax: 870, gross: 18270 });
    const odd = taxBreakdown(1001, { treatment: "taxable", basis: "gross" });
    expect(odd.net + odd.tax).toBe(1001);
  });
  test("TWD tax rounds to whole dollars, other currencies to cents", () => {
    expect(taxBreakdown(333, { treatment: "taxable", basis: "net" }).tax).toBe(17);
    expect(taxBreakdown(333, { treatment: "taxable", basis: "net" }, "USD").tax).toBe(16.65);
  });
  test("zero-rated, exempt and none have no tax", () => {
    for (const treatment of ["zero_rated", "exempt", "none"] as const) {
      expect(taxBreakdown(4500, { treatment, basis: "net" }, "USD")).toEqual({ net: 4500, tax: 0, gross: 4500 });
    }
  });
  test("null / empty amount", () => {
    expect(taxBreakdownOrNull(null, DEFAULT_TAX_SETTING)).toBeNull();
    expect(taxBreakdownOrNull("5800.00", DEFAULT_TAX_SETTING)).toEqual({ net: 5800, tax: 290, gross: 6090 });
  });
});

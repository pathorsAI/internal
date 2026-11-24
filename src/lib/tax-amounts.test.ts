import { describe, expect, test } from "bun:test";
import {
  collectionProgress,
  effectiveTaxSetting,
  taxedAmount,
  taxedAmountOrNull,
} from "./tax-amounts";
import type { TaxSetting } from "./tax-treatment";

const org: TaxSetting = { treatment: "taxable", basis: "net" };

describe("effectiveTaxSetting", () => {
  test("bound to a contract → contract wins over own; contract NULL falls back to org", () => {
    expect(
      effectiveTaxSetting(
        org,
        { taxTreatment: "exempt", amountBasis: "gross" },
        12,
        { taxTreatment: "zero_rated", amountBasis: null },
      ),
    ).toEqual({ treatment: "zero_rated", basis: "net" });
    // 合約兩欄都 NULL：不看自己的欄位，直接沿用組織
    expect(
      effectiveTaxSetting(org, { taxTreatment: "exempt", amountBasis: "gross" }, 12, {
        taxTreatment: null,
        amountBasis: null,
      }),
    ).toEqual(org);
  });
  test("not bound → own fields, NULL → org", () => {
    expect(effectiveTaxSetting(org, { taxTreatment: "none", amountBasis: null })).toEqual({
      treatment: "none",
      basis: "net",
    });
    expect(effectiveTaxSetting(org, null)).toEqual(org);
  });
});

describe("taxedAmount", () => {
  test("attaches the effective setting to the breakdown", () => {
    expect(taxedAmount(17400, org, "TWD")).toEqual({
      net: 17400,
      tax: 870,
      gross: 18270,
      taxTreatment: "taxable",
      amountBasis: "net",
    });
  });
  test("unset contract amount → null numbers, setting still reported", () => {
    expect(taxedAmountOrNull(null, org, "TWD")).toEqual({
      net: null,
      tax: null,
      gross: null,
      taxTreatment: "taxable",
      amountBasis: "net",
    });
    expect(taxedAmountOrNull("1000", { treatment: "none", basis: "net" }, "TWD")?.gross).toBe(1000);
  });
});

describe("collectionProgress", () => {
  test("received is compared with gross, not the net amount", () => {
    const { gross } = taxedAmount(17400, org, "TWD");
    // 收到未稅金額 17,400 還差 870，不能算收齊
    expect(collectionProgress(gross, 17400)).toEqual({ remaining: 870, fullyCollected: false });
    expect(collectionProgress(gross, 18270)).toEqual({ remaining: 0, fullyCollected: true });
  });
  test("no amount / zero amount is never fully collected", () => {
    expect(collectionProgress(null, 500)).toEqual({ remaining: null, fullyCollected: false });
    expect(collectionProgress(0, 0)).toEqual({ remaining: 0, fullyCollected: false });
  });
});

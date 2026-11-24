import { describe, expect, test } from "bun:test";
import { optTaxArgs } from "./shared";
import { tools } from "./tools";

describe("optTaxArgs", () => {
  test("absent → untouched, null/empty → inherit, valid values pass", () => {
    expect(optTaxArgs({})).toEqual({});
    expect(optTaxArgs({ taxTreatment: null, amountBasis: "" })).toEqual({
      taxTreatment: null,
      amountBasis: null,
    });
    expect(optTaxArgs({ taxTreatment: "zero_rated", amountBasis: "gross" })).toEqual({
      taxTreatment: "zero_rated",
      amountBasis: "gross",
    });
  });
  test("rejects anything outside the enums", () => {
    expect(() => optTaxArgs({ taxTreatment: "vat" })).toThrow(/taxTreatment/);
    expect(() => optTaxArgs({ amountBasis: 1 })).toThrow(/amountBasis/);
  });
});

describe("tax params on the write tools", () => {
  test.each([
    "create_contract",
    "update_contract",
    "create_subscription",
    "update_subscription",
    "create_billing_item",
    "update_billing_item",
  ])("%s accepts taxTreatment / amountBasis", (name) => {
    const props = tools[name].inputSchema.properties;
    expect(props.taxTreatment).toBeDefined();
    expect(props.amountBasis).toBeDefined();
  });

  test("closed row schemas list every property as required", () => {
    for (const name of ["list_contracts", "list_subscriptions", "list_billing_status"]) {
      const item = (tools[name].outputSchema?.properties?.items as { items: { properties: object; required: string[] } })
        .items;
      expect(item.required.sort()).toEqual(Object.keys(item.properties).sort());
      expect(item.required).toEqual(expect.arrayContaining(["net", "tax", "gross", "taxTreatment", "amountBasis"]));
    }
  });
});

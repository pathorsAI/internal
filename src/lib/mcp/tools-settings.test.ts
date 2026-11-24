import { describe, expect, test } from "bun:test";
import { integrationConnectUrl, settingsTools } from "./tools-settings";
import { vendorBillingAdminTools } from "./tools-vendor-billing-admin";
import { tools } from "./tools";

const ctx = { userId: "u1" };

describe("settings tools", () => {
  test("are registered", () => {
    for (const name of [...Object.keys(settingsTools), ...Object.keys(vendorBillingAdminTools)]) {
      expect(tools[name]).toBeDefined();
    }
  });

  test("the connect link opens the sheet for that provider and org", () => {
    const url = new URL(integrationConnectUrl("azure", "pathors"));
    expect(url.pathname).toBe("/dashboard/settings/integrations");
    expect(url.searchParams.get("connect")).toBe("azure");
    expect(url.searchParams.get("org")).toBe("pathors");
  });

  test.each([
    ["disconnect_integration", { provider: "gcp" }],
    ["disconnect_calendar", {}],
    ["revoke_api_key", { id: 1 }],
  ])("%s needs confirm: true (checked before anything else)", async (name, args) => {
    await expect(settingsTools[name].execute(args, ctx)).rejects.toThrow("confirm: true");
    await expect(settingsTools[name].execute({ ...args, confirm: false }, ctx)).rejects.toThrow("confirm: true");
  });

  test.each([["delete_vendor_billing_account"], ["delete_payment_method"]])(
    "%s needs confirm: true",
    async (name) => {
      await expect(vendorBillingAdminTools[name].execute({ id: 1 }, ctx)).rejects.toThrow("confirm: true");
    },
  );

  test("no secret field is accepted by any settings tool's input schema", () => {
    const secretKeys = ["password", "apiToken", "clientSecret", "serviceAccountJson", "webhookUrl", "token", "secret"];
    for (const t of Object.values(settingsTools)) {
      const props = Object.keys(t.inputSchema.properties);
      for (const k of secretKeys) expect(props).not.toContain(k);
    }
  });
});

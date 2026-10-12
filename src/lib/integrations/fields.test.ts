import { describe, expect, test } from "bun:test";
import { INTEGRATION_CATALOG } from "./catalog";
import { fieldApplies, findMissingRequiredField, pickFields } from "./fields";

const gcp = INTEGRATION_CATALOG.gcp;
const all = [...gcp.credentialFields, ...(gcp.configFields ?? [])];
const AUD = "//iam.googleapis.com/projects/36598995522/locations/global/workloadIdentityPools/internal-app/providers/internal-app-oidc";

function validate(values: Record<string, string>) {
  const creds = pickFields(gcp.credentialFields, all, values);
  const config = pickFields(gcp.configFields, all, values);
  return { creds, config, missing: findMissingRequiredField(all, { ...creds, ...config })?.key ?? null };
}

describe("mode-dependent credential validation (GCP)", () => {
  test("key mode (default) requires the JSON key", () => {
    expect(validate({}).missing).toBe("serviceAccountJson");
    const r = validate({ serviceAccountJson: "{…}" });
    expect(r.missing).toBeNull();
    expect(r.config.authMode).toBe("key");
  });

  test("workload identity needs no key, but needs audience + SA", () => {
    expect(validate({ authMode: "workload_identity" }).missing).toBe("wifAudience");
    const r = validate({
      authMode: "workload_identity",
      wifAudience: AUD,
      serviceAccountEmail: "internal-billing-reader@internal-498514.iam.gserviceaccount.com",
    });
    expect(r.missing).toBeNull();
  });

  test("a key pasted while in workload identity mode is not stored", () => {
    const r = validate({ authMode: "workload_identity", serviceAccountJson: "{secret}", wifAudience: AUD, serviceAccountEmail: "a@b.iam.gserviceaccount.com" });
    expect(r.creds).toEqual({});
  });

  test("an unknown select value falls out", () => {
    expect(validate({ authMode: "magic" }).config.authMode).toBeUndefined();
  });

  test("fields without `when` always apply", () => {
    expect(fieldApplies(all.find((f) => f.key === "bigQueryDataset")!, all, { authMode: "workload_identity" })).toBe(true);
  });
});

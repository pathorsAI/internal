import { describe, expect, test } from "bun:test";
import {
  exportTableName,
  filterAllowlisted,
  matchExportTables,
  parseAzureScope,
  parseBigQueryExport,
  parseGcpScope,
  sanitizeAllowlist,
} from "./scope";

const BA = "8369e875-ffc0-56f1-7e79-83b5815e6d84:09d0934e-5aba-4d36-9346-78bbd5642790_2019-05-31";
const COMPANY = "eb362146-d231-4280-a8c9-8c8385057f52";
const discovered = [
  { billingAccountId: BA, billingAccountName: null, id: COMPANY, displayName: "鄭宇傑（國泰）" },
  { billingAccountId: BA, billingAccountName: null, id: "R3XJ-XNP5-BG7-PGB", displayName: "鄭 宇傑（台新）" },
  { billingAccountId: BA, billingAccountName: null, id: "5YO6-OZVA-BG7-PGB", displayName: "鄭 宇傑（台新）" },
];

describe("Azure scope allowlist", () => {
  test("only the company profile is synced when only it is ticked; personal profiles are not", () => {
    const scope = parseAzureScope({ billingAccountId: BA, billingProfileIds: [COMPANY], discovered });
    const selected = filterAllowlisted(scope.discovered, scope.billingProfileIds);
    expect(selected.map((p) => p.id)).toEqual([COMPANY]);
    expect(scope.billingAccountId).toBe(BA);
  });

  test("an empty allowlist syncs nothing (not everything)", () => {
    const scope = parseAzureScope({ discovered });
    expect(scope.billingProfileIds).toEqual([]);
    expect(filterAllowlisted(scope.discovered, scope.billingProfileIds)).toEqual([]);
  });

  test("garbage in config is ignored", () => {
    const scope = parseAzureScope({ billingProfileIds: ["", 3, null, COMPANY, COMPANY], discovered: [null, { id: "x" }] });
    expect(scope.billingProfileIds).toEqual([COMPANY]);
    expect(scope.discovered).toEqual([]);
  });

  test("saving only accepts ids that were actually discovered", () => {
    expect(sanitizeAllowlist([COMPANY, "INJECTED-ID", COMPANY], discovered)).toEqual([COMPANY]);
    expect(sanitizeAllowlist("nope", discovered)).toEqual([]);
  });
});

describe("GCP scope", () => {
  const gcp = [
    { id: "01CBC3-343D16-C6AE22", displayName: "Pathors - TWGCP(USD)", masterBillingAccount: "0148E6-B09FE5-9F5CAE", currencyCode: "USD", open: true },
    { id: "0169B6-2E38CC-45314F", displayName: "Other company", masterBillingAccount: null, currencyCode: "TWD", open: true },
  ];

  test("one GCP identity seeing two companies' accounts only syncs the ticked one", () => {
    const scope = parseGcpScope({ billingAccountIds: ["01CBC3-343D16-C6AE22"], discovered: gcp });
    expect(filterAllowlisted(scope.discovered, scope.billingAccountIds).map((a) => a.id)).toEqual(["01CBC3-343D16-C6AE22"]);
  });

  test("BigQuery export: object or flat connect fields, validated", () => {
    expect(parseBigQueryExport({ bigQueryExport: { projectId: "internal-498514", dataset: "billing_export" } })).toEqual({
      projectId: "internal-498514",
      dataset: "billing_export",
    });
    expect(parseBigQueryExport({ bigQueryProjectId: "buzz-445414", bigQueryDataset: "billing_export" })).toEqual({
      projectId: "buzz-445414",
      dataset: "billing_export",
    });
    expect(parseBigQueryExport({ bigQueryProjectId: "x`; DROP", bigQueryDataset: "billing_export" })).toBeNull();
    expect(parseBigQueryExport({})).toBeNull();
  });

  test("export table auto-detection maps each account to its own table", () => {
    expect(exportTableName("01CBC3-343D16-C6AE22")).toBe("gcp_billing_export_v1_01CBC3_343D16_C6AE22");
    const m = matchExportTables(
      [
        "gcp_billing_export_v1_01CBC3_343D16_C6AE22",
        "gcp_billing_export_resource_v1_01CBC3_343D16_C6AE22",
        "cloud_pricing_export",
      ],
      ["01CBC3-343D16-C6AE22", "0169B6-2E38CC-45314F"],
    );
    expect([...m.entries()]).toEqual([["01CBC3-343D16-C6AE22", "gcp_billing_export_v1_01CBC3_343D16_C6AE22"]]);
  });
});

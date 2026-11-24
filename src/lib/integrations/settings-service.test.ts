import { beforeEach, describe, expect, mock, test } from "bun:test";
import * as realIntl from "next-intl/server";
import * as realStore from "./store";
import type { IntegrationSummary } from "./types";

// service 只透過 store 碰 DB，翻譯走 next-intl：兩個都換成假的，其他照真的跑。
const t = (key: string, values?: Record<string, unknown>) =>
  values ? `${key} ${JSON.stringify(values)}` : key;
// mock.module 是整個 test process 共用的，所以保留其餘的 export。
mock.module("next-intl/server", () => ({ ...realIntl, getTranslations: async () => t }));

let rows: Record<string, IntegrationSummary> = {};
const calls: { fn: string; args: unknown[] }[] = [];
mock.module("@/lib/integrations/store", () => ({
  ...realStore,
  getIntegration: async (_orgId: string, provider: string) => rows[provider] ?? null,
  saveConnection: async (...args: unknown[]) => calls.push({ fn: "saveConnection", args }),
  setIntegrationEnabled: async (...args: unknown[]) => calls.push({ fn: "setIntegrationEnabled", args }),
  updateConfig: async (...args: unknown[]) => calls.push({ fn: "updateConfig", args }),
  deleteIntegration: async (_orgId: string, provider: string) => (rows[provider] ? 1 : 0),
}));

const {
  applicableCredentialKeys,
  connectIntegrationForOrg,
  disconnectIntegrationForOrg,
  saveCloudBillingScopeForOrg,
  setIntegrationEnabledForOrg,
  IntegrationSettingsError,
} = await import("./settings-service");

const logs: string[] = [];
const actor = {
  orgId: "org1",
  userId: "u1",
  log: async (_a: string, _e: string, _id: number | null, summary: string) => {
    logs.push(summary);
  },
};

function summary(provider: string, patch: Partial<IntegrationSummary> = {}): IntegrationSummary {
  return {
    provider,
    enabled: false,
    status: "connected",
    config: {},
    connectedAt: "2026-11-01T00:00:00Z",
    connectedByName: null,
    tokenExpiresAt: null,
    lastSyncedAt: null,
    lastError: null,
    ...patch,
  } as IntegrationSummary;
}

beforeEach(() => {
  rows = {};
  calls.length = 0;
  logs.length = 0;
});

describe("applicableCredentialKeys", () => {
  test("GCP workload identity needs no secret; key mode and the others do", () => {
    expect(applicableCredentialKeys("gcp", { authMode: "workload_identity" })).toEqual([]);
    expect(applicableCredentialKeys("gcp", { authMode: "key" })).toEqual(["serviceAccountJson"]);
    expect(applicableCredentialKeys("gcp", {})).toEqual(["serviceAccountJson"]);
    expect(applicableCredentialKeys("simpany", {})).toEqual(["account", "password"]);
    expect(applicableCredentialKeys("wise", {})).toEqual(["apiToken"]);
    expect(applicableCredentialKeys("azure", {})).toEqual(["tenantId", "clientId", "clientSecret"]);
    expect(applicableCredentialKeys("discord", {})).toEqual(["webhookUrl"]);
  });
});

describe("connectIntegrationForOrg (secretFree)", () => {
  test("refuses providers that need a secret, before testing or saving anything", async () => {
    for (const provider of ["simpany", "wise", "azure", "discord"]) {
      await expect(
        connectIntegrationForOrg(actor, provider, {}, { mode: "connect", secretFree: true }),
      ).rejects.toThrow("errors.secretRequired");
    }
    expect(calls).toEqual([]);
  });

  test("refuses a secret smuggled into a secret-free mode", async () => {
    await expect(
      connectIntegrationForOrg(
        actor,
        "gcp",
        { authMode: "workload_identity", serviceAccountJson: "{\"private_key\":\"x\"}" },
        { mode: "connect", secretFree: true },
      ),
    ).rejects.toBeInstanceOf(IntegrationSettingsError);
    expect(calls).toEqual([]);
  });

  test("GCP workload identity still validates required fields", async () => {
    await expect(
      connectIntegrationForOrg(actor, "gcp", { authMode: "workload_identity" }, { mode: "connect", secretFree: true }),
    ).rejects.toThrow("errors.requiredField");
  });
});

describe("switches", () => {
  test("cannot switch on an integration that needs reauth; switching off always works", async () => {
    rows.wise = summary("wise", { status: "needs_reauth", enabled: true });
    await expect(setIntegrationEnabledForOrg(actor, "wise", true)).rejects.toThrow("errors.cannotEnable");
    expect(await setIntegrationEnabledForOrg(actor, "wise", false)).toEqual({
      provider: "wise",
      enabled: false,
      changed: true,
    });
    expect(calls.map((c) => c.fn)).toEqual(["setIntegrationEnabled"]);
    expect(logs).toHaveLength(1);
  });

  test("no-op when the value is unchanged (nothing written, nothing logged)", async () => {
    rows.gcp = summary("gcp", { enabled: true });
    expect((await setIntegrationEnabledForOrg(actor, "gcp", true)).changed).toBe(false);
    expect(calls).toEqual([]);
    expect(logs).toEqual([]);
  });

  test("unknown provider and not-connected are clear errors", async () => {
    await expect(setIntegrationEnabledForOrg(actor, "stripe", true)).rejects.toThrow("errors.unknownProvider");
    await expect(setIntegrationEnabledForOrg(actor, "gcp", true)).rejects.toThrow("errors.notConnected");
  });

  test("disconnect logs only when something was removed", async () => {
    expect(await disconnectIntegrationForOrg(actor, "gcp")).toEqual({ provider: "gcp", removed: false });
    expect(logs).toEqual([]);
    rows.gcp = summary("gcp");
    expect(await disconnectIntegrationForOrg(actor, "gcp")).toEqual({ provider: "gcp", removed: true });
    expect(logs).toHaveLength(1);
  });
});

describe("saveCloudBillingScopeForOrg", () => {
  test("keeps only discovered ids and reports the rest", async () => {
    rows.gcp = summary("gcp", {
      config: {
        discovered: [
          { id: "AAAAAA-BBBBBB-CCCCCC", displayName: "Ours", masterBillingAccount: null, currencyCode: "USD", open: true },
        ],
      },
    });
    const res = await saveCloudBillingScopeForOrg(actor, "gcp", {
      ids: ["AAAAAA-BBBBBB-CCCCCC", "ZZZZZZ-ZZZZZZ-ZZZZZZ"],
      bigQuery: { projectId: "my-project", dataset: "billing_export" },
    });
    expect(res.selectedIds).toEqual(["AAAAAA-BBBBBB-CCCCCC"]);
    expect(res.ignoredIds).toEqual(["ZZZZZZ-ZZZZZZ-ZZZZZZ"]);
    expect(res.bigQueryExport).toEqual({ projectId: "my-project", dataset: "billing_export" });
    expect(calls[0]).toEqual({
      fn: "updateConfig",
      args: [
        "org1",
        "gcp",
        {
          billingAccountIds: ["AAAAAA-BBBBBB-CCCCCC"],
          bigQueryExport: { projectId: "my-project", dataset: "billing_export" },
        },
      ],
    });
  });

  test("omitting bigQuery keeps the existing export; null clears it", async () => {
    rows.gcp = summary("gcp", { config: { bigQueryExport: { projectId: "kept-project", dataset: "kept_ds" } } });
    expect((await saveCloudBillingScopeForOrg(actor, "gcp", { ids: [] })).bigQueryExport).toEqual({
      projectId: "kept-project",
      dataset: "kept_ds",
    });
    expect((await saveCloudBillingScopeForOrg(actor, "gcp", { ids: [], bigQuery: null })).bigQueryExport).toBeNull();
  });

  test("rejects a malformed BigQuery export", async () => {
    rows.gcp = summary("gcp");
    await expect(
      saveCloudBillingScopeForOrg(actor, "gcp", { ids: [], bigQuery: { projectId: "Bad Project!", dataset: "x" } }),
    ).rejects.toThrow("scope.errors.bigQuery");
  });
});

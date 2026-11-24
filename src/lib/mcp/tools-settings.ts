import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { organization } from "@/db/auth-schema";
import { listApiKeys, revokeApiKey } from "@/lib/api-keys";
import { publicBaseUrl } from "@/lib/base-url";
import {
  CalendarNotConnectedError,
  disconnectCalendar,
  getCalendarOwnerLabel,
  getCalendarSettings,
  setReminderDays,
  syncBillingCalendar,
} from "@/lib/google-calendar";
import { gcpAuthMode, workloadIdentityBindingCommand } from "@/lib/integrations/gcp";
import {
  applicableCredentialKeys,
  connectIntegrationForOrg,
  disconnectIntegrationForOrg,
  refreshCloudDiscoveryForOrg,
  saveCloudBillingScopeForOrg,
  setIntegrationAutoSyncForOrg,
  setIntegrationEnabledForOrg,
  type SettingsActor,
} from "@/lib/integrations/settings-service";
import { getIntegration } from "@/lib/integrations/store";
import { INTEGRATION_PROVIDER_IDS, isIntegrationProviderId } from "@/lib/integrations/types";
import { oidcIssuer } from "@/lib/oidc";
import { parseAzureScope, parseGcpScope } from "@/lib/vendor-billing/scope";
import { isIsoDate, parseWiseConfig, refreshWiseBalances, saveWiseMappings, type MappingInput } from "@/lib/wise-sync";
import {
  listResult,
  listSchema,
  optBoolean,
  ORG_ARG,
  requireNumber,
  requireString,
  resolveOrg,
  rowSchema,
  type JsonSchemaObject,
  type ToolContext,
  type ToolDef,
} from "./shared";
import { assertToolManager, toolAuditLog } from "./tools-integrations";

// ---- 設定類工具：設定 › 整合 / 日曆 / 基本資料 / API 能在網頁上點的，這裡都有一支 ----
//
// 規則（與 docs/mcp.md「設定工具」一節一致）：
// - 寫入一律 owner / admin（assertToolManager），與網頁 server action 同一份 service：
//   src/lib/integrations/settings-service.ts、src/lib/wise-sync.ts、src/lib/google-calendar.ts。
// - 需要秘密的憑證（密碼、token、金鑰、webhook）不經過 MCP／API。get_integration_connect_link
//   回傳直接打開連接視窗的網址；不含秘密的連接方式（GCP workload identity）才走 connect_integration。
// - 回傳值不含任何憑證、token 或密文。
// - 中斷連接這類收不回來的動作要 confirm: true。

const PROVIDER_ARG = {
  provider: { type: "string", enum: [...INTEGRATION_PROVIDER_IDS], description: "Integration id; see list_integrations." },
} as const;

const CLOUD_PROVIDER_ARG = {
  provider: { type: "string", enum: ["azure", "gcp"], description: "Cloud billing integration." },
} as const;

export const CONFIRM_ARG = {
  confirm: {
    type: "boolean",
    description: "Must be true. Ask the user to confirm first; this cannot be undone from here.",
  },
} as const;

export function requireConfirm(args: Record<string, unknown>, what: string) {
  if (optBoolean(args, "confirm") !== true) {
    throw new Error(`${what} cannot be undone. Ask the user to confirm, then call again with confirm: true.`);
  }
}

function requireBoolean(args: Record<string, unknown>, key: string): boolean {
  const v = optBoolean(args, key);
  if (v === undefined) throw new Error(`"${key}" is required and must be a boolean.`);
  return v;
}

/** 已驗證 owner / admin 的組織 + 依來源記操作紀錄的 actor。 */
async function managerActor(args: Record<string, unknown>, ctx: ToolContext): Promise<SettingsActor> {
  const orgId = await resolveOrg(args, ctx);
  await assertToolManager(orgId, ctx);
  return { orgId, userId: ctx.userId, log: toolAuditLog(ctx, orgId) };
}

const SETTINGS_PAGE = "/dashboard/settings/integrations";

/** 設定 › 整合 的網址；connect = provider 時頁面會直接打開那個整合的連接視窗。 */
export function integrationConnectUrl(provider: string, orgSlugOrId?: string | null): string {
  const url = new URL(SETTINGS_PAGE, publicBaseUrl());
  url.searchParams.set("connect", provider);
  if (orgSlugOrId) url.searchParams.set("org", orgSlugOrId);
  return url.toString();
}

async function orgRow(orgId: string): Promise<{ name: string; slug: string | null }> {
  const [row] = await getDb()
    .select({ name: organization.name, slug: organization.slug })
    .from(organization)
    .where(eq(organization.id, orgId))
    .limit(1);
  return row ?? { name: orgId, slug: null };
}

const TOGGLE_RESULT = (key: "enabled" | "autoSync"): JsonSchemaObject =>
  rowSchema({
    provider: { type: "string", enum: [...INTEGRATION_PROVIDER_IDS] },
    [key]: { type: "boolean", description: "The value now in effect." },
    changed: { type: "boolean", description: "false = it already had this value; nothing was written." },
  });

const CLOUD_CANDIDATE = rowSchema({
  id: { type: "string", description: "Pass these back in set_cloud_billing_scope.ids." },
  displayName: { type: ["string", "null"] },
  currency: { type: ["string", "null"] },
  selected: { type: "boolean" },
  closed: { type: "boolean", description: "GCP: the billing account is closed." },
  reseller: { type: "boolean", description: "GCP: a sub-account under a reseller (master) account." },
});

const WISE_BALANCE_ROW = rowSchema({
  profileId: { type: "number" },
  profileName: { type: "string" },
  balanceId: { type: "number" },
  currency: { type: "string" },
  amount: { type: ["number", "null"], description: "Balance at the last refresh." },
  fetchedAt: { type: ["string", "null"], description: "ISO 8601; when the balance was last refreshed." },
  bankAccountId: { type: ["number", "null"], description: "Mapped ledger account (list_bank_accounts); null = not synced." },
  syncFrom: { type: ["string", "null"], description: "Cutover date YYYY-MM-DD; nothing before it is imported." },
});

const API_KEY_ROW = rowSchema({
  id: { type: "number" },
  name: { type: "string" },
  prefix: { type: "string", description: "First characters of the key, for recognising it. The full key is never shown again." },
  scope: { type: "string", enum: ["read", "write"] },
  status: { type: "string", enum: ["active", "expired", "revoked"] },
  createdAt: { type: "string", description: "ISO 8601." },
  createdBy: { type: ["string", "null"], description: "The member the key acts as." },
  expiresAt: { type: ["string", "null"], description: "ISO 8601; null = never expires." },
  lastUsedAt: { type: ["string", "null"], description: "ISO 8601 (updated at most once a minute)." },
  revokedAt: { type: ["string", "null"], description: "ISO 8601." },
});

export const settingsTools: Record<string, ToolDef> = {
  // ---- 整合：連接 / 開關 / 自動同步 / 中斷 ----

  get_integration_connect_link: {
    description:
      "URL of the web page that opens this integration's connect (or reconnect) sheet directly, for an owner/admin to enter the credentials there. Use it whenever connecting needs a secret — Simpany password, Wise API token, Azure client secret, GCP service-account JSON key, Discord webhook URL: secrets are never sent through MCP or the API, by design. Give the URL to the user. Also says whether the integration can be connected secret-free with connect_integration instead (today: GCP with authMode = workload_identity).",
    inputSchema: {
      type: "object",
      properties: { ...PROVIDER_ARG, ...ORG_ARG },
      required: ["provider"],
      additionalProperties: false,
    },
    outputSchema: rowSchema({
      provider: { type: "string", enum: [...INTEGRATION_PROVIDER_IDS] },
      url: { type: "string", description: "Open in a browser while signed in as an owner/admin of this organization." },
      connected: { type: "boolean", description: "Already connected (the sheet will be a reconnect)." },
      secretFreeModes: {
        type: "array",
        items: { type: "string" },
        description: "Connection modes that need no secret and can use connect_integration; empty when every mode needs one.",
      },
    }),
    execute: async (args, ctx) => {
      const orgId = await resolveOrg(args, ctx);
      const provider = requireString(args, "provider");
      if (!isIntegrationProviderId(provider)) throw new Error(`Unknown integration: ${provider}`);
      const [row, org] = await Promise.all([getIntegration(orgId, provider), orgRow(orgId)]);
      const secretFreeModes =
        provider === "gcp" && applicableCredentialKeys("gcp", { authMode: "workload_identity" }).length === 0
          ? ["workload_identity"]
          : [];
      return {
        provider,
        url: integrationConnectUrl(provider, org.slug ?? orgId),
        connected: Boolean(row),
        secretFreeModes,
      };
    },
  },

  connect_integration: {
    description:
      "Connect (or reconnect) an integration WITHOUT any secret, owner/admin only. Only connection modes that need no credential are accepted — today that is GCP billing with authMode = \"workload_identity\" (values: wifAudience, serviceAccountEmail, optional bigQueryProjectId + bigQueryDataset). The connection is tested live first (same testConnection as the web sheet) and only saved when the test passes. A new connection starts switched OFF — switch it on with set_integration_enabled afterwards. Anything that needs a password / token / key is refused: use get_integration_connect_link and let the user enter it in the web app. For workload identity, the GCP side must first allow this organization's subject — get_cloud_billing_scope returns the exact gcloud binding command once connected; the OIDC issuer is returned here on failure.",
    inputSchema: {
      type: "object",
      properties: {
        ...PROVIDER_ARG,
        values: {
          type: "object",
          description:
            "Non-secret connect fields, keyed like the web sheet. GCP workload identity: { authMode: \"workload_identity\", wifAudience: \"//iam.googleapis.com/projects/<number>/locations/global/workloadIdentityPools/<pool>/providers/<provider>\", serviceAccountEmail: \"<sa>@<project>.iam.gserviceaccount.com\", bigQueryProjectId?, bigQueryDataset? }.",
          additionalProperties: { type: "string" },
        },
        ...ORG_ARG,
      },
      required: ["provider", "values"],
      additionalProperties: false,
    },
    outputSchema: rowSchema({
      provider: { type: "string", enum: [...INTEGRATION_PROVIDER_IDS] },
      created: { type: "boolean", description: "true = new connection (switched off); false = reconnected, on/off kept." },
      enabled: { type: "boolean" },
      config: { type: "object", description: "Non-secret settings saved for the integration." },
      next: { type: "string" },
    }),
    annotations: { openWorldHint: true },
    execute: async (args, ctx) => {
      const actor = await managerActor(args, ctx);
      const provider = requireString(args, "provider");
      const raw = args.values;
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error('"values" must be an object.');
      const values = raw as Record<string, unknown>;
      let res;
      try {
        res = await connectIntegrationForOrg(actor, provider, values, { mode: "connect", secretFree: true });
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        if (provider === "gcp" && values.authMode === "workload_identity") {
          let issuer = "";
          try {
            issuer = oidcIssuer();
          } catch {
            issuer = "(OIDC_ISSUER not configured)";
          }
          throw new Error(
            `${message}\nWorkload identity checklist: the pool's OIDC provider must trust issuer ${issuer}, and the service account must grant roles/iam.workloadIdentityUser to subject ${actor.orgId} (gcloud iam service-accounts add-iam-policy-binding <sa> --role=roles/iam.workloadIdentityUser --member="principal://iam.googleapis.com/projects/<number>/locations/global/workloadIdentityPools/<pool>/subject/${actor.orgId}").`,
          );
        }
        throw e;
      }
      const row = await getIntegration(actor.orgId, res.provider);
      return {
        provider: res.provider,
        created: res.created,
        enabled: row?.enabled ?? false,
        config: row?.config ?? res.config,
        next: row?.enabled
          ? "Connected and switched on."
          : "Connected. Switch it on with set_integration_enabled; for Azure / GCP then tick the billing scope with set_cloud_billing_scope.",
      };
    },
  },

  set_integration_enabled: {
    description:
      "Switch an integration on or off (owner/admin). Same as the switch in 設定 › 整合. Switching on requires status = connected (reconnect first when it needs reauth); switching off always works and stops its tools and the daily auto-sync. Idempotent.",
    inputSchema: {
      type: "object",
      properties: { ...PROVIDER_ARG, enabled: { type: "boolean" }, ...ORG_ARG },
      required: ["provider", "enabled"],
      additionalProperties: false,
    },
    outputSchema: TOGGLE_RESULT("enabled"),
    annotations: { idempotentHint: true },
    execute: async (args, ctx) => {
      const actor = await managerActor(args, ctx);
      return setIntegrationEnabledForOrg(actor, requireString(args, "provider"), requireBoolean(args, "enabled"));
    },
  },

  set_integration_auto_sync: {
    description:
      "Turn an integration's daily auto-sync (06:00 Asia/Taipei) on or off (owner/admin). Supported for simpany, wise, azure and gcp. Auto-sync only runs while the integration is also switched on and healthy. Idempotent.",
    inputSchema: {
      type: "object",
      properties: {
        provider: { type: "string", enum: ["simpany", "wise", "azure", "gcp"] },
        autoSync: { type: "boolean" },
        ...ORG_ARG,
      },
      required: ["provider", "autoSync"],
      additionalProperties: false,
    },
    outputSchema: TOGGLE_RESULT("autoSync"),
    annotations: { idempotentHint: true },
    execute: async (args, ctx) => {
      const actor = await managerActor(args, ctx);
      return setIntegrationAutoSyncForOrg(actor, requireString(args, "provider"), requireBoolean(args, "autoSync"));
    },
  },

  disconnect_integration: {
    description:
      "Disconnect an integration (owner/admin): deletes its stored (encrypted) credentials, token cache and settings — billing scope, Wise mappings, everything in its config. Records already imported into the books stay. Reconnecting needs the credentials again in the web app. Requires confirm: true — ask the user first.",
    inputSchema: {
      type: "object",
      properties: { ...PROVIDER_ARG, ...CONFIRM_ARG, ...ORG_ARG },
      required: ["provider", "confirm"],
      additionalProperties: false,
    },
    outputSchema: rowSchema({
      provider: { type: "string", enum: [...INTEGRATION_PROVIDER_IDS] },
      removed: { type: "boolean", description: "false = it was not connected." },
    }),
    annotations: { destructiveHint: true, idempotentHint: true },
    execute: async (args, ctx) => {
      requireConfirm(args, "Disconnecting an integration");
      const actor = await managerActor(args, ctx);
      return disconnectIntegrationForOrg(actor, requireString(args, "provider"));
    },
  },

  // ---- Azure / GCP 計費範圍 ----

  get_cloud_billing_scope: {
    description:
      "The billing scope of the Azure or GCP integration: every billing profile (Azure) / billing account (GCP) the connection can see (discovered), which ones this organization ticked as its own (selected), the GCP BigQuery billing export, and the GCP auth mode — for workload identity, the subject and the exact gcloud command an admin must run to bind the service account. Only selected ids are synced. Never returns credentials.",
    inputSchema: {
      type: "object",
      properties: { ...CLOUD_PROVIDER_ARG, ...ORG_ARG },
      required: ["provider"],
      additionalProperties: false,
    },
    outputSchema: rowSchema({
      provider: { type: "string", enum: ["azure", "gcp"] },
      connected: { type: "boolean" },
      enabled: { type: "boolean", description: "Switched on and healthy (refresh needs this)." },
      discoveredAt: { type: ["string", "null"], description: "ISO 8601; last refresh_cloud_billing_discovery." },
      candidates: { type: "array", items: CLOUD_CANDIDATE },
      selectedIds: { type: "array", items: { type: "string" } },
      azureBillingAccountId: { type: ["string", "null"] },
      bigQueryExport: {
        anyOf: [rowSchema({ projectId: { type: "string" }, dataset: { type: "string" } }), { type: "null" }],
        description: "GCP only.",
      },
      gcpAuth: {
        anyOf: [
          rowSchema({
            mode: { type: "string", enum: ["key", "workload_identity"] },
            serviceAccountEmail: { type: ["string", "null"] },
            subject: { type: ["string", "null"], description: "Workload identity subject (= organization id)." },
            bindingCommand: { type: ["string", "null"], description: "gcloud command granting roles/iam.workloadIdentityUser to this organization." },
          }),
          { type: "null" },
        ],
      },
    }),
    execute: async (args, ctx) => {
      const orgId = await resolveOrg(args, ctx);
      const provider = requireString(args, "provider");
      if (provider !== "azure" && provider !== "gcp") throw new Error(`Unknown cloud billing integration: ${provider}`);
      const row = await getIntegration(orgId, provider);
      const base = {
        provider,
        connected: Boolean(row),
        enabled: Boolean(row?.enabled && row.status === "connected"),
      };
      if (provider === "azure") {
        const scope = parseAzureScope(row?.config);
        return {
          ...base,
          discoveredAt: scope.discoveredAt,
          candidates: scope.discovered.map((p) => ({
            id: p.id,
            displayName: p.displayName ?? null,
            currency: null,
            selected: scope.billingProfileIds.includes(p.id),
            closed: false,
            reseller: false,
          })),
          selectedIds: scope.billingProfileIds,
          azureBillingAccountId: scope.billingAccountId,
          bigQueryExport: null,
          gcpAuth: null,
        };
      }
      const scope = parseGcpScope(row?.config);
      const c = row?.config ?? {};
      const mode = gcpAuthMode(c);
      return {
        ...base,
        discoveredAt: scope.discoveredAt,
        candidates: scope.discovered.map((a) => ({
          id: a.id,
          displayName: a.displayName ?? null,
          currency: a.currencyCode ?? null,
          selected: scope.billingAccountIds.includes(a.id),
          closed: !a.open,
          reseller: Boolean(a.masterBillingAccount),
        })),
        selectedIds: scope.billingAccountIds,
        azureBillingAccountId: null,
        bigQueryExport: scope.bigQueryExport,
        gcpAuth: row
          ? {
              mode,
              serviceAccountEmail: typeof c.serviceAccountEmail === "string" ? c.serviceAccountEmail : null,
              subject: mode === "workload_identity" ? orgId : null,
              bindingCommand:
                mode === "workload_identity"
                  ? workloadIdentityBindingCommand(c.serviceAccountEmail, c.wifAudience, orgId)
                  : null,
            }
          : null,
      };
    },
  },

  set_cloud_billing_scope: {
    description:
      "Set which Azure billing profiles / GCP billing accounts belong to this organization (owner/admin) — the same billing scope can contain other organizations' or personal accounts, so only ticked ids are synced. `ids` replaces the whole selection and only ids from get_cloud_billing_scope's candidates are kept (others are returned in ignoredIds). Run refresh_cloud_billing_discovery first if the list is empty or stale. GCP only: `bigQuery` sets the BigQuery billing export (project + dataset; the table gcp_billing_export_v1_<account> is detected automatically) — omit to keep it, null to clear.",
    inputSchema: {
      type: "object",
      properties: {
        ...CLOUD_PROVIDER_ARG,
        ids: { type: "array", items: { type: "string" }, description: "The full selection; [] = sync nothing." },
        bigQuery: {
          anyOf: [
            {
              type: "object",
              properties: { projectId: { type: "string" }, dataset: { type: "string" } },
              required: ["projectId", "dataset"],
              additionalProperties: false,
            },
            { type: "null" },
          ],
          description: "GCP only. Omit = unchanged; null = remove the export.",
        },
        ...ORG_ARG,
      },
      required: ["provider", "ids"],
      additionalProperties: false,
    },
    outputSchema: rowSchema({
      provider: { type: "string", enum: ["azure", "gcp"] },
      selectedIds: { type: "array", items: { type: "string" } },
      ignoredIds: { type: "array", items: { type: "string" }, description: "Sent but not among the discovered candidates." },
      bigQueryExport: {
        anyOf: [rowSchema({ projectId: { type: "string" }, dataset: { type: "string" } }), { type: "null" }],
      },
    }),
    annotations: { idempotentHint: true },
    execute: async (args, ctx) => {
      const actor = await managerActor(args, ctx);
      const provider = requireString(args, "provider");
      if (!Array.isArray(args.ids)) throw new Error('"ids" must be an array of strings.');
      const input: { ids: unknown; bigQuery?: { projectId?: unknown; dataset?: unknown } | null } = { ids: args.ids };
      if ("bigQuery" in args) {
        if (provider !== "gcp") throw new Error('"bigQuery" is only for provider "gcp".');
        input.bigQuery = (args.bigQuery as { projectId?: unknown; dataset?: unknown } | null) ?? null;
      }
      return saveCloudBillingScopeForOrg(actor, provider, input);
    },
  },

  refresh_cloud_billing_discovery: {
    description:
      "Re-list the Azure billing profiles / GCP billing accounts the connection can see (read-only calls to the platform; owner/admin; the integration must be switched on). The selection is unchanged — only the candidate list (get_cloud_billing_scope) is updated.",
    inputSchema: {
      type: "object",
      properties: { ...CLOUD_PROVIDER_ARG, ...ORG_ARG },
      required: ["provider"],
      additionalProperties: false,
    },
    outputSchema: rowSchema({
      provider: { type: "string", enum: ["azure", "gcp"] },
      discoveredCount: { type: "number" },
      discoveredAt: { type: "string", description: "ISO 8601." },
    }),
    annotations: { openWorldHint: true, idempotentHint: true },
    execute: async (args, ctx) => {
      const actor = await managerActor(args, ctx);
      const provider = requireString(args, "provider");
      const res = await refreshCloudDiscoveryForOrg(actor.orgId, provider);
      await actor.log("update", "integration", null, `${provider}: 重新探索計費範圍（${res.discoveredCount} 筆）`);
      return res;
    },
  },

  // ---- Wise 餘額 ↔ 帳本帳戶 ----

  get_wise_account_mappings: {
    description:
      "Wise balances (from the last refresh) and which ledger bank account each is mapped to, with its cutover date (syncFrom). Only mapped balances with a cutover date are imported by wise_sync_transactions / the daily auto-sync. Never returns the Wise token.",
    inputSchema: { type: "object", properties: { ...ORG_ARG }, additionalProperties: false },
    outputSchema: {
      type: "object",
      properties: {
        connected: { type: "boolean" },
        enabled: { type: "boolean" },
        balances: { type: "array", items: WISE_BALANCE_ROW },
      },
      required: ["connected", "enabled", "balances"],
      additionalProperties: false,
    },
    execute: async (args, ctx) => {
      const orgId = await resolveOrg(args, ctx);
      const row = await getIntegration(orgId, "wise");
      const cfg = parseWiseConfig(row?.config);
      const profileName = (id: number) => cfg.profiles.find((p) => p.id === id)?.name ?? String(id);
      return {
        connected: Boolean(row),
        enabled: Boolean(row?.enabled && row.status === "connected"),
        balances: cfg.balances.map((b) => {
          const m = cfg.accountMappings.find((x) => x.balanceId === b.balanceId);
          return {
            profileId: b.profileId,
            profileName: profileName(b.profileId),
            balanceId: b.balanceId,
            currency: b.currency,
            amount: typeof b.amount === "number" ? b.amount : null,
            fetchedAt: b.fetchedAt ?? null,
            bankAccountId: m?.bankAccountId ?? null,
            syncFrom: m?.syncFrom ?? null,
          };
        }),
      };
    },
  },

  set_wise_account_mappings: {
    description:
      "Map Wise balances to ledger bank accounts and set each cutover date (owner/admin) — same as the mapping table in 設定 › 整合 › Wise. Only the balances you list change; others keep their mapping. bankAccountId null = stop syncing that balance. The ledger account must be this organization's, same currency, and mapped to at most one balance. syncFrom omitted/null on a mapped balance = a suggested date is filled in (the day after the account's latest existing transaction). Run refresh_wise_balances first if a balance is missing.",
    inputSchema: {
      type: "object",
      properties: {
        mappings: {
          type: "array",
          items: {
            type: "object",
            properties: {
              balanceId: { type: "number" },
              bankAccountId: { type: ["number", "null"] },
              syncFrom: { type: ["string", "null"], description: "YYYY-MM-DD." },
            },
            required: ["balanceId", "bankAccountId"],
            additionalProperties: false,
          },
        },
        ...ORG_ARG,
      },
      required: ["mappings"],
      additionalProperties: false,
    },
    outputSchema: listSchema(
      rowSchema({
        profileId: { type: "number" },
        balanceId: { type: "number" },
        currency: { type: "string" },
        bankAccountId: { type: ["number", "null"] },
        syncFrom: { type: ["string", "null"] },
      }),
    ),
    annotations: { idempotentHint: true },
    execute: async (args, ctx) => {
      const actor = await managerActor(args, ctx);
      if (!Array.isArray(args.mappings)) throw new Error('"mappings" must be an array.');
      const row = await getIntegration(actor.orgId, "wise");
      if (!row) throw new Error("Wise 尚未連接");
      const cfg = parseWiseConfig(row.config);
      const updates = new Map<number, { bankAccountId: number | null; syncFrom: string | null }>();
      for (const raw of args.mappings as Record<string, unknown>[]) {
        const balanceId = requireNumber(raw ?? {}, "balanceId");
        const bank = raw?.bankAccountId;
        if (bank !== null && (typeof bank !== "number" || !Number.isInteger(bank))) {
          throw new Error(`bankAccountId for balance ${balanceId} must be an integer or null.`);
        }
        const syncFrom = raw?.syncFrom ?? null;
        if (syncFrom !== null && !isIsoDate(syncFrom)) {
          throw new Error(`syncFrom for balance ${balanceId} must be YYYY-MM-DD.`);
        }
        updates.set(balanceId, { bankAccountId: bank, syncFrom });
      }
      const input: MappingInput[] = cfg.balances.map((b) => {
        const existing = cfg.accountMappings.find((m) => m.balanceId === b.balanceId);
        const next = updates.get(b.balanceId);
        updates.delete(b.balanceId);
        return {
          profileId: b.profileId,
          balanceId: b.balanceId,
          bankAccountId: next ? next.bankAccountId : (existing?.bankAccountId ?? null),
          syncFrom: next ? next.syncFrom : (existing?.syncFrom ?? null),
        };
      });
      if (updates.size > 0) {
        throw new Error(`找不到 Wise 餘額 #${[...updates.keys()].join(", #")}，請先 refresh_wise_balances`);
      }
      const res = await saveWiseMappings(actor.orgId, input);
      if ("error" in res) throw new Error(res.error);
      await actor.log("update", "integration", null, "wise: 更新 Wise 帳戶對應");
      return listResult(res.mappings);
    },
  },

  refresh_wise_balances: {
    description:
      "Re-read the Wise profiles and balances (read-only GET to Wise; owner/admin; the integration must be switched on) so new balances can be mapped with set_wise_account_mappings. Mappings are kept.",
    inputSchema: { type: "object", properties: { ...ORG_ARG }, additionalProperties: false },
    outputSchema: rowSchema({
      balanceCount: { type: "number" },
      profileCount: { type: "number" },
    }),
    annotations: { openWorldHint: true, idempotentHint: true },
    execute: async (args, ctx) => {
      const actor = await managerActor(args, ctx);
      const cfg = await refreshWiseBalances(actor.orgId);
      await actor.log("update", "integration", null, `wise: 重新整理餘額（${cfg.balances.length} 筆）`);
      return { balanceCount: cfg.balances.length, profileCount: cfg.profiles.length };
    },
  },

  // ---- Google 日曆 ----

  get_calendar_settings: {
    description:
      "Google Calendar billing-reminder settings: whether it is connected, by whom, and how many days ahead reminders fire. Connecting needs a Google sign-in in the browser (web only: 設定 › 整合 › Google 日曆); syncing is sync_billing_calendar.",
    inputSchema: { type: "object", properties: { ...ORG_ARG }, additionalProperties: false },
    outputSchema: rowSchema({
      connected: { type: "boolean" },
      connectedBy: { type: ["string", "null"] },
      reminderDays: { type: "number" },
      connectUrl: { type: "string", description: "Settings page where an owner/admin connects it." },
    }),
    execute: async (args, ctx) => {
      const orgId = await resolveOrg(args, ctx);
      const [settings, owner, org] = await Promise.all([
        getCalendarSettings(orgId),
        getCalendarOwnerLabel(orgId),
        orgRow(orgId),
      ]);
      const url = new URL(SETTINGS_PAGE, publicBaseUrl());
      url.searchParams.set("org", org.slug ?? orgId);
      return {
        connected: Boolean(settings?.ownerUserId && settings.googleCalendarId),
        connectedBy: owner,
        reminderDays: settings?.reminderDays ?? 3,
        connectUrl: url.toString(),
      };
    },
  },

  set_calendar_reminder_days: {
    description:
      "How many days before each billing / payment / invoicing date Google Calendar reminds (0–60; owner/admin). Re-pushes the existing events so the new reminder takes effect.",
    inputSchema: {
      type: "object",
      properties: { days: { type: "number", description: "Integer 0–60." }, ...ORG_ARG },
      required: ["days"],
      additionalProperties: false,
    },
    outputSchema: rowSchema({
      reminderDays: { type: "number" },
      synced: { type: "boolean", description: "false = saved, but the calendar is not connected so nothing was pushed." },
    }),
    annotations: { openWorldHint: true, idempotentHint: true },
    execute: async (args, ctx) => {
      const actor = await managerActor(args, ctx);
      const days = requireNumber(args, "days");
      if (!Number.isInteger(days) || days < 0 || days > 60) throw new Error("days must be an integer from 0 to 60.");
      await setReminderDays(actor.orgId, days);
      await actor.log("update", "calendar", null, `提醒提前天數改為 ${days} 天`);
      let synced = true;
      try {
        await syncBillingCalendar(actor.orgId, (await orgRow(actor.orgId)).name);
      } catch (e) {
        if (!(e instanceof CalendarNotConnectedError)) throw e;
        synced = false;
      }
      return { reminderDays: days, synced };
    },
  },

  disconnect_calendar: {
    description:
      "Disconnect Google Calendar (owner/admin): deletes the dedicated reminder sub-calendar from the connecting member's Google account and forgets the link. calendarRemoved = false means Google refused (expired grant) and the user must delete that calendar in Google themselves. Requires confirm: true — ask the user first.",
    inputSchema: {
      type: "object",
      properties: { ...CONFIRM_ARG, ...ORG_ARG },
      required: ["confirm"],
      additionalProperties: false,
    },
    outputSchema: rowSchema({
      calendarRemoved: { type: "boolean" },
    }),
    annotations: { destructiveHint: true, openWorldHint: true },
    execute: async (args, ctx) => {
      requireConfirm(args, "Disconnecting Google Calendar");
      const actor = await managerActor(args, ctx);
      const res = await disconnectCalendar(actor.orgId);
      await actor.log("update", "calendar", null, "中斷 Google 日曆連結");
      return res;
    },
  },

  // ---- 組織基本資料 ----

  update_organization: {
    description:
      "Rename this organization (owner/admin) — same as 設定 › 基本資料. The slug (organizationId) does not change.",
    inputSchema: {
      type: "object",
      properties: { name: { type: "string", description: "1–100 characters." }, ...ORG_ARG },
      required: ["name"],
      additionalProperties: false,
    },
    outputSchema: rowSchema({
      organizationId: { type: "string" },
      name: { type: "string" },
    }),
    execute: async (args, ctx) => {
      const orgId = await resolveOrg(args, ctx);
      await assertToolManager(orgId, ctx, "修改組織資料");
      const name = requireString(args, "name");
      if (name.length > 100) throw new Error("name must be at most 100 characters.");
      await getDb().update(organization).set({ name }).where(eq(organization.id, orgId));
      return { organizationId: orgId, name };
    },
  },

  // ---- API keys（建立只在網頁：會產生秘密）----

  list_api_keys: {
    description:
      "This organization's API keys (owner/admin): name, prefix, scope (read / write), who it acts as, expiry, last use and status. Never returns the key or its hash. Creating a key is web-only (設定 › API) because it produces a secret; revoking can be done with revoke_api_key.",
    inputSchema: { type: "object", properties: { ...ORG_ARG }, additionalProperties: false },
    outputSchema: listSchema(API_KEY_ROW),
    execute: async (args, ctx) => {
      const orgId = await resolveOrg(args, ctx);
      await assertToolManager(orgId, ctx, "查看 API key");
      return listResult(await listApiKeys(orgId));
    },
  },

  revoke_api_key: {
    description:
      "Revoke an API key (owner/admin). It stops working immediately and cannot be re-enabled — a new key must be created in the web app. Requires confirm: true.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "number", description: "From list_api_keys." }, ...CONFIRM_ARG, ...ORG_ARG },
      required: ["id", "confirm"],
      additionalProperties: false,
    },
    outputSchema: rowSchema({ id: { type: "number" }, name: { type: "string" }, revoked: { type: "boolean" } }),
    annotations: { destructiveHint: true, idempotentHint: true },
    execute: async (args, ctx) => {
      requireConfirm(args, "Revoking an API key");
      const actor = await managerActor(args, ctx);
      const id = requireNumber(args, "id");
      const res = await revokeApiKey(actor.orgId, id, ctx.userId);
      if (!res) throw new Error(`API key ${id} not found in this organization, or already revoked.`);
      await actor.log("delete", "api_key", res.id, `撤銷 API key「${res.name}」`);
      return { ...res, revoked: true };
    },
  },
};

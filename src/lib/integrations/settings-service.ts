import { getTranslations } from "next-intl/server";
import type { ActivityAction } from "@/db/activity";
import { EncryptionKeyMissingError } from "@/lib/crypto";
import { azureBillingAccountId, discoverAzureProfiles, withAzureClient } from "@/lib/integrations/azure";
import { supportsAutoSync } from "@/lib/integrations/autosync-config";
import { getCatalogEntry } from "@/lib/integrations/catalog";
import { fieldApplies, findMissingRequiredField, pickFields } from "@/lib/integrations/fields";
import { withGcpClient } from "@/lib/integrations/gcp";
import { getProvider } from "@/lib/integrations/registry";
import {
  deleteIntegration,
  getIntegration,
  saveConnection,
  setIntegrationEnabled,
  updateConfig,
} from "@/lib/integrations/store";
import {
  isIntegrationProviderId,
  type IntegrationConfig,
  type IntegrationCredentials,
  type IntegrationProviderId,
  type TestConnectionResult,
} from "@/lib/integrations/types";
import {
  isValidBigQueryExport,
  parseAzureScope,
  parseGcpScope,
  sanitizeAllowlist,
  type BigQueryExport,
} from "@/lib/vendor-billing/scope";

/**
 * 設定 › 整合 的業務邏輯，網頁（server actions）與 MCP／REST 工具共用同一份。
 *
 * 呼叫端負責驗身分與角色（owner / admin），這裡只拿已驗證過的 orgId / userId，並透過
 * `log` 寫操作紀錄 —— 網頁傳 logWeb，工具傳 logMcp／API key 版本，所以同一個動作在
 * 操作紀錄裡會標出正確的來源。
 *
 * 失敗一律丟 IntegrationSettingsError（訊息給人看，已翻譯）；不含任何憑證。
 */

export class IntegrationSettingsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IntegrationSettingsError";
  }
}

export type SettingsAuditFn = (
  action: ActivityAction,
  entityType: string,
  entityId: number | null,
  summary: string,
) => Promise<void>;

export type SettingsActor = { orgId: string; userId: string; log: SettingsAuditFn };

async function tIntegrations() {
  return getTranslations("integrations");
}

async function requireProvider(providerArg: unknown): Promise<IntegrationProviderId> {
  const t = await tIntegrations();
  if (!isIntegrationProviderId(providerArg)) {
    throw new IntegrationSettingsError(t("errors.unknownProvider", { provider: String(providerArg) }));
  }
  return providerArg;
}

async function providerName(provider: IntegrationProviderId): Promise<string> {
  const t = await tIntegrations();
  return t(`providers.${provider}.name`);
}

// ---- 連接 / 重新連接 ----

/**
 * 這組輸入值實際會用到哪些「憑證」欄位（依 `when` 判斷適用與否）。回空陣列 = 這種連接
 * 方式不需要任何秘密（例如 GCP workload identity），才可以走 MCP / API。
 */
export function applicableCredentialKeys(
  provider: IntegrationProviderId,
  values: Record<string, unknown>,
): string[] {
  const entry = getCatalogEntry(provider);
  const all = [...entry.credentialFields, ...(entry.configFields ?? [])];
  return entry.credentialFields.filter((f) => fieldApplies(f, all, values)).map((f) => f.key);
}

/** catalog 裡所有憑證欄位的 key（不管目前適不適用），用來拒絕「把秘密塞進工具參數」。 */
export function credentialFieldKeys(provider: IntegrationProviderId): string[] {
  return getCatalogEntry(provider).credentialFields.map((f) => f.key);
}

export type ConnectOptions = {
  mode: "connect" | "reconnect";
  /**
   * true = 只接受不含秘密的連接（MCP / API）：有任何憑證欄位適用、或參數裡出現憑證欄位
   * 的 key，就直接拒絕，連 testConnection 都不跑。
   */
  secretFree?: boolean;
};

export type ConnectResult = { provider: IntegrationProviderId; created: boolean; config: IntegrationConfig };

/**
 * 連接：驗必填 → provider.testConnection 實測 → 加密存入。新連接 enabled = false。
 * 已經連接過（兩個分頁同時操作、或重新連接）則保留開關狀態。
 */
export async function connectIntegrationForOrg(
  actor: SettingsActor,
  providerArg: unknown,
  values: Record<string, unknown>,
  opts: ConnectOptions,
): Promise<ConnectResult> {
  const t = await tIntegrations();
  const provider = await requireProvider(providerArg);
  const name = await providerName(provider);
  const impl = getProvider(provider);
  if (!impl) throw new IntegrationSettingsError(t("errors.notImplemented", { name }));

  const entry = getCatalogEntry(provider);
  const allFields = [...entry.credentialFields, ...(entry.configFields ?? [])];

  if (opts.secretFree) {
    const leaked = credentialFieldKeys(provider).filter((k) => k in values);
    const needed = applicableCredentialKeys(provider, values);
    if (leaked.length > 0 || needed.length > 0) {
      throw new IntegrationSettingsError(t("errors.secretRequired", { name }));
    }
  }

  // 欄位可能依別的欄位（例如 GCP 的 authMode）決定適不適用：不適用的不檢查、也不存。
  const credentials: IntegrationCredentials = pickFields(entry.credentialFields, allFields, values);
  const configInput: IntegrationConfig = pickFields(entry.configFields, allFields, values);
  const missing = findMissingRequiredField(allFields, {
    ...credentials,
    ...(configInput as Record<string, string>),
  });
  if (missing) {
    throw new IntegrationSettingsError(t("errors.requiredField", { field: t(`fields.${missing.labelKey}`) }));
  }

  // 重新連接時把既有 config 一起給 provider：有些 provider 需要之前發現的 id 才能測。
  const existing = await getIntegration(actor.orgId, provider);
  const config: IntegrationConfig = { ...existing?.config, ...configInput };

  let result: TestConnectionResult;
  try {
    // orgId 來自呼叫端驗過的身分，不是使用者輸入。
    result = await impl.testConnection(credentials, config, { orgId: actor.orgId });
  } catch (e) {
    // provider 自己沒處理好的例外（網路錯之類）。provider 有責任不把憑證放進錯誤訊息。
    result = { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  if (!result.ok) throw new IntegrationSettingsError(t("errors.testFailed", { error: result.error }));

  const savedConfig = { ...configInput, ...result.config };
  try {
    await saveConnection({
      orgId: actor.orgId,
      provider,
      userId: actor.userId,
      credentials,
      config: savedConfig,
      tokenCache: result.tokenCache,
    });
  } catch (e) {
    if (e instanceof EncryptionKeyMissingError) {
      throw new IntegrationSettingsError(t("errors.encryptionKeyMissing"));
    }
    throw e;
  }

  const created = !existing;
  await actor.log(
    created ? "create" : "update",
    "integration",
    null,
    created || opts.mode === "connect"
      ? t("activity.connected", { name })
      : t("activity.reconnected", { name }),
  );
  return { provider, created, config: savedConfig };
}

// ---- 開關 / 自動同步 / 中斷 ----

/** 開 / 關。開啟只允許在 status = connected 時；關閉永遠允許。 */
export async function setIntegrationEnabledForOrg(
  actor: SettingsActor,
  providerArg: unknown,
  enabled: boolean,
): Promise<{ provider: IntegrationProviderId; enabled: boolean; changed: boolean }> {
  const t = await tIntegrations();
  const provider = await requireProvider(providerArg);
  const name = await providerName(provider);
  const row = await getIntegration(actor.orgId, provider);
  if (!row) throw new IntegrationSettingsError(t("errors.notConnected", { name }));
  if (enabled && row.status !== "connected") {
    throw new IntegrationSettingsError(t("errors.cannotEnable", { name }));
  }
  const changed = row.enabled !== enabled;
  if (changed) {
    await setIntegrationEnabled(actor.orgId, provider, enabled);
    await actor.log(
      "update",
      "integration",
      null,
      enabled ? t("activity.enabled", { name }) : t("activity.disabled", { name }),
    );
  }
  return { provider, enabled, changed };
}

/** 每日自動同步的開關（config.autoSync）。沒存 = 開；關掉存 false。 */
export async function setIntegrationAutoSyncForOrg(
  actor: SettingsActor,
  providerArg: unknown,
  autoSync: boolean,
): Promise<{ provider: IntegrationProviderId; autoSync: boolean; changed: boolean }> {
  const t = await tIntegrations();
  if (!isIntegrationProviderId(providerArg) || !supportsAutoSync(providerArg)) {
    throw new IntegrationSettingsError(t("errors.unknownProvider", { provider: String(providerArg) }));
  }
  const provider = providerArg;
  const name = await providerName(provider);
  const row = await getIntegration(actor.orgId, provider);
  if (!row) throw new IntegrationSettingsError(t("errors.notConnected", { name }));
  const changed = (row.config.autoSync !== false) !== autoSync;
  if (changed) {
    await updateConfig(actor.orgId, provider, { autoSync });
    await actor.log(
      "update",
      "integration",
      null,
      autoSync ? t("activity.autoSyncOn", { name }) : t("activity.autoSyncOff", { name }),
    );
  }
  return { provider, autoSync, changed };
}

/** 中斷連接 = 刪列（連同加密憑證與 token）。沒連接過也算成功（removed = false）。 */
export async function disconnectIntegrationForOrg(
  actor: SettingsActor,
  providerArg: unknown,
): Promise<{ provider: IntegrationProviderId; removed: boolean }> {
  const t = await tIntegrations();
  const provider = await requireProvider(providerArg);
  const removed = (await deleteIntegration(actor.orgId, provider)) > 0;
  if (removed) {
    await actor.log("delete", "integration", null, t("activity.disconnected", { name: await providerName(provider) }));
  }
  return { provider, removed };
}

// ---- Azure / GCP 計費範圍 ----

export type CloudBillingProvider = "azure" | "gcp";

export type CloudScopeInput = {
  ids: unknown;
  /** 只有 GCP 用。undefined = 不改；null 或兩欄皆空 = 清掉。 */
  bigQuery?: { projectId?: unknown; dataset?: unknown } | null;
};

export type CloudScopeResult = {
  provider: CloudBillingProvider;
  selectedIds: string[];
  /** 送來但不在已探索清單裡、所以被丟掉的 id。 */
  ignoredIds: string[];
  bigQueryExport: BigQueryExport | null;
};

function requireCloudProvider(provider: unknown, t: Awaited<ReturnType<typeof tIntegrations>>): CloudBillingProvider {
  if (provider !== "azure" && provider !== "gcp") {
    throw new IntegrationSettingsError(t("errors.unknownProvider", { provider: String(provider) }));
  }
  return provider;
}

/**
 * 存勾選的計費範圍。只接受 config.discovered 裡出現過的 id（sanitizeAllowlist），所以不可能
 * 勾到別的組織的帳號。GCP 另可設 BigQuery billing export（專案 + dataset）。
 */
export async function saveCloudBillingScopeForOrg(
  actor: SettingsActor,
  providerArg: unknown,
  input: CloudScopeInput,
): Promise<CloudScopeResult> {
  const t = await tIntegrations();
  const provider = requireCloudProvider(providerArg, t);
  const name = await providerName(provider);
  const row = await getIntegration(actor.orgId, provider);
  if (!row) throw new IntegrationSettingsError(t("errors.notConnected", { name }));

  const requested = Array.isArray(input?.ids) ? input.ids.filter((v): v is string => typeof v === "string") : [];
  if (provider === "azure") {
    const scope = parseAzureScope(row.config);
    const ids = sanitizeAllowlist(input?.ids, scope.discovered);
    await updateConfig(actor.orgId, "azure", { billingProfileIds: ids });
    await actor.log("update", "integration", null, t("scope.activity.saved", { name, count: ids.length }));
    return { provider, selectedIds: ids, ignoredIds: requested.filter((id) => !ids.includes(id)), bigQueryExport: null };
  }

  const scope = parseGcpScope(row.config);
  const ids = sanitizeAllowlist(input?.ids, scope.discovered);
  let bigQueryExport: BigQueryExport | null = scope.bigQueryExport;
  if (input && "bigQuery" in input && input.bigQuery !== undefined) {
    const bq = input.bigQuery;
    const projectId = typeof bq?.projectId === "string" ? bq.projectId.trim() : "";
    const dataset = typeof bq?.dataset === "string" ? bq.dataset.trim() : "";
    if (projectId || dataset) {
      const v = { projectId, dataset };
      if (!isValidBigQueryExport(v)) throw new IntegrationSettingsError(t("scope.errors.bigQuery"));
      bigQueryExport = v;
    } else {
      bigQueryExport = null;
    }
  }
  await updateConfig(actor.orgId, "gcp", { billingAccountIds: ids, bigQueryExport });
  await actor.log("update", "integration", null, t("scope.activity.saved", { name, count: ids.length }));
  return { provider, selectedIds: ids, ignoredIds: requested.filter((id) => !ids.includes(id)), bigQueryExport };
}

/** 重新向平台列出候選（整合要已開啟）。勾選不變，只更新 config.discovered。 */
export async function refreshCloudDiscoveryForOrg(
  orgId: string,
  providerArg: unknown,
): Promise<{ provider: CloudBillingProvider; discoveredCount: number; discoveredAt: string }> {
  const t = await tIntegrations();
  const provider = requireCloudProvider(providerArg, t);
  const discoveredAt = new Date().toISOString();
  let discoveredCount = 0;
  if (provider === "azure") {
    await withAzureClient(orgId, async (client, row) => {
      const ba = azureBillingAccountId(row.config);
      if (!ba) throw new IntegrationSettingsError(t("scope.errors.noBillingAccount"));
      const profiles = await discoverAzureProfiles(client, ba);
      discoveredCount = profiles.length;
      await updateConfig(orgId, "azure", { discovered: profiles, discoveredAt });
    });
  } else {
    await withGcpClient(orgId, async (client) => {
      const discovered = await client.listBillingAccounts();
      discoveredCount = discovered.length;
      await updateConfig(orgId, "gcp", { discovered, discoveredAt });
    });
  }
  return { provider, discoveredCount, discoveredAt };
}

"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { canManageOrg, requireOrgWithRole } from "@/lib/session";
import { logWeb } from "@/db/activity";
import { EncryptionKeyMissingError } from "@/lib/crypto";
import { getCatalogEntry } from "@/lib/integrations/catalog";
import { getProvider } from "@/lib/integrations/registry";
import {
  deleteIntegration,
  getIntegration,
  saveConnection,
  setIntegrationEnabled,
} from "@/lib/integrations/store";
import {
  isIntegrationProviderId,
  type IntegrationCatalogEntry,
  type IntegrationConfig,
  type IntegrationCredentials,
  type IntegrationField,
  type IntegrationProvider,
  type IntegrationProviderId,
  type TestConnectionResult,
} from "@/lib/integrations/types";

/**
 * 設定 › 整合 的 server actions。全部限 owner / admin ——
 * 隱藏按鈕擋得住誤按，擋不住直接呼叫 action，所以每一支都在這裡再檢查一次角色。
 *
 * 回傳值永遠不含憑證：失敗只回錯誤訊息，成功只回 ok。畫面上的狀態靠 revalidatePath
 * 重新渲染 server component 取得（那邊讀的是 IntegrationSummary，型別上就沒有密文）。
 */

export type IntegrationActionState = {
  ok: boolean;
  error?: string;
};

const PAGE = "/dashboard/settings/integrations";

type Manager = { orgId: string; userId: string };

async function requireManager(): Promise<Manager | { error: string }> {
  const t = await getTranslations("integrations");
  const { orgId, userId, role } = await requireOrgWithRole();
  if (!canManageOrg(role)) return { error: t("errors.notAllowed") };
  return { orgId, userId };
}

/** 只收目錄裡宣告過的欄位；其他 key 一律丟掉，不讓 client 塞東西進憑證或 config。 */
function pickFields(
  fields: readonly IntegrationField[] | undefined,
  values: Record<string, unknown>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of fields ?? []) {
    const raw = values[f.key];
    if (typeof raw !== "string") continue;
    // 密碼不修剪（前後空白可能是密碼的一部分）；其餘欄位修掉貼上時夾帶的空白。
    const v = f.type === "password" ? raw : raw.trim();
    if (v !== "") out[f.key] = v;
  }
  return out;
}

/** 回傳第一個沒填的必填欄位；都有填就回 null。 */
function findMissingRequiredField(
  entry: IntegrationCatalogEntry,
  credentials: IntegrationCredentials,
  configInput: IntegrationConfig,
): IntegrationField | null {
  for (const f of [...entry.credentialFields, ...(entry.configFields ?? [])]) {
    if (f.required && !(f.key in credentials) && !(f.key in configInput)) return f;
  }
  return null;
}

type TestOutcome =
  | { ok: true; result: Extract<TestConnectionResult, { ok: true }> }
  | { ok: false; error: string };

/** 跑 provider.testConnection，把丟出的例外與 ok:false 都收斂成錯誤字串。 */
async function runConnectionTest(
  impl: IntegrationProvider,
  credentials: IntegrationCredentials,
  config: IntegrationConfig,
): Promise<TestOutcome> {
  let result: TestConnectionResult;
  try {
    result = await impl.testConnection(credentials, config);
  } catch (e) {
    // provider 自己沒處理好的例外（網路錯之類）。訊息照樣給人看，provider 有責任
    // 不把憑證放進錯誤訊息裡。
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, result };
}

async function connectOrReconnect(
  providerArg: string,
  values: Record<string, unknown>,
  mode: "connect" | "reconnect",
): Promise<IntegrationActionState> {
  const t = await getTranslations("integrations");
  // 在 try 外面：未登入時 requireOrg() 會 redirect，那個例外不能被吞掉。
  const me = await requireManager();
  if ("error" in me) return { ok: false, error: me.error };
  try {
    if (!isIntegrationProviderId(providerArg)) {
      return { ok: false, error: t("errors.unknownProvider", { provider: String(providerArg) }) };
    }
    const provider: IntegrationProviderId = providerArg;
    const name = t(`providers.${provider}.name`);
    const impl = getProvider(provider);
    if (!impl) return { ok: false, error: t("errors.notImplemented", { name }) };

    const entry = getCatalogEntry(provider);
    const credentials: IntegrationCredentials = pickFields(entry.credentialFields, values);
    const configInput: IntegrationConfig = pickFields(entry.configFields, values);
    const missing = findMissingRequiredField(entry, credentials, configInput);
    if (missing) {
      return { ok: false, error: t("errors.requiredField", { field: t(`fields.${missing.labelKey}`) }) };
    }

    // 重新連接時把既有 config 一起給 provider：有些 provider 需要之前發現的 id 才能測。
    const existing = await getIntegration(me.orgId, provider);
    const config: IntegrationConfig = { ...existing?.config, ...configInput };

    const outcome = await runConnectionTest(impl, credentials, config);
    if (!outcome.ok) return { ok: false, error: t("errors.testFailed", { error: outcome.error }) };
    const { result } = outcome;

    await saveConnection({
      orgId: me.orgId,
      provider,
      userId: me.userId,
      credentials,
      config: { ...configInput, ...result.config },
      tokenCache: result.tokenCache,
    });

    const isNew = !existing;
    await logWeb(
      me.orgId,
      isNew ? "create" : "update",
      "integration",
      null,
      isNew || mode === "connect"
        ? t("activity.connected", { name })
        : t("activity.reconnected", { name }),
    );
    revalidatePath(PAGE);
    return { ok: true };
  } catch (e) {
    if (e instanceof EncryptionKeyMissingError) {
      return { ok: false, error: t("errors.encryptionKeyMissing") };
    }
    return { ok: false, error: e instanceof Error ? e.message : t("toast.failed") };
  }
}

/**
 * 連接：驗必填 → provider.testConnection 實測 → 加密存入，enabled = false。
 * 若這個組織其實已經連接過（兩個分頁同時操作），行為等同重新連接：保留開關狀態。
 */
export async function connectIntegration(
  provider: string,
  values: Record<string, string>,
): Promise<IntegrationActionState> {
  return connectOrReconnect(provider, values, "connect");
}

/** 重新連接：同連接，但保留原本的 enabled，並把狀態恢復為 connected。 */
export async function reconnectIntegration(
  provider: string,
  values: Record<string, string>,
): Promise<IntegrationActionState> {
  return connectOrReconnect(provider, values, "reconnect");
}

/** 開 / 關。開啟只允許在 status = connected 時；關閉永遠允許。 */
export async function setIntegrationEnabledAction(
  providerArg: string,
  enabled: boolean,
): Promise<IntegrationActionState> {
  const t = await getTranslations("integrations");
  // 在 try 外面：未登入時 requireOrg() 會 redirect，那個例外不能被吞掉。
  const me = await requireManager();
  if ("error" in me) return { ok: false, error: me.error };
  try {
    if (!isIntegrationProviderId(providerArg)) {
      return { ok: false, error: t("errors.unknownProvider", { provider: String(providerArg) }) };
    }
    const provider: IntegrationProviderId = providerArg;
    const name = t(`providers.${provider}.name`);
    const row = await getIntegration(me.orgId, provider);
    if (!row) return { ok: false, error: t("errors.notConnected", { name }) };
    if (enabled && row.status !== "connected") {
      return { ok: false, error: t("errors.cannotEnable", { name }) };
    }
    if (row.enabled !== enabled) {
      await setIntegrationEnabled(me.orgId, provider, enabled);
      await logWeb(
        me.orgId,
        "update",
        "integration",
        null,
        enabled ? t("activity.enabled", { name }) : t("activity.disabled", { name }),
      );
    }
    revalidatePath(PAGE);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : t("toast.failed") };
  }
}

/** 中斷連接 = 刪列（連同加密憑證與 token）。 */
export async function disconnectIntegration(
  providerArg: string,
): Promise<IntegrationActionState> {
  const t = await getTranslations("integrations");
  // 在 try 外面：未登入時 requireOrg() 會 redirect，那個例外不能被吞掉。
  const me = await requireManager();
  if ("error" in me) return { ok: false, error: me.error };
  try {
    if (!isIntegrationProviderId(providerArg)) {
      return { ok: false, error: t("errors.unknownProvider", { provider: String(providerArg) }) };
    }
    const provider: IntegrationProviderId = providerArg;
    const removed = await deleteIntegration(me.orgId, provider);
    if (removed > 0) {
      await logWeb(
        me.orgId,
        "delete",
        "integration",
        null,
        t("activity.disconnected", { name: t(`providers.${provider}.name`) }),
      );
    }
    revalidatePath(PAGE);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : t("toast.failed") };
  }
}

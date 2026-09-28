import { and, eq, sql } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { getDb } from "@/db";
import { orgIntegrations } from "@/db/schema";
import { user } from "@/db/auth-schema";
import { decryptField, decryptJson, encryptField, encryptJson } from "@/lib/crypto";
import type {
  IntegrationConfig,
  IntegrationCredentials,
  IntegrationProviderId,
  IntegrationStatus,
  IntegrationSummary,
  TokenCache,
} from "./types";

/**
 * org_integrations 的唯一存取點（server only —— 會碰 DB 與 FIELD_ENCRYPTION_KEY）。
 *
 * 讀：getIntegration / listIntegrations 回傳 IntegrationSummary，型別上就不含密文。
 * 真的要憑證的只有 provider 的實作，走 loadCredentials / requireEnabledIntegration。
 * 解密後的值只能留在 server 記憶體裡：不可回傳給 client、不可放進 MCP 結果、不可寫 log。
 */

/** 整合沒連接 / 沒開啟 / 憑證失效時丟這個。message 就是給人看的修法。 */
export class IntegrationUnavailableError extends Error {
  constructor(
    readonly provider: IntegrationProviderId,
    readonly reason: "not_connected" | "disabled" | "needs_reauth" | "error",
    message: string,
  ) {
    super(message);
    this.name = "IntegrationUnavailableError";
  }
}

const summaryColumns = {
  provider: orgIntegrations.provider,
  enabled: orgIntegrations.enabled,
  status: orgIntegrations.status,
  config: orgIntegrations.config,
  connectedAt: orgIntegrations.connectedAt,
  connectedByUserId: orgIntegrations.connectedByUserId,
  connectedByName: sql<string | null>`coalesce(nullif(${user.name}, ''), ${user.email})`,
  tokenExpiresAt: orgIntegrations.tokenExpiresAt,
  lastSyncedAt: orgIntegrations.lastSyncedAt,
  lastError: orgIntegrations.lastError,
  lastErrorAt: orgIntegrations.lastErrorAt,
  updatedAt: orgIntegrations.updatedAt,
};

type SummaryRow = {
  provider: string;
  status: string;
} & Omit<IntegrationSummary, "provider" | "status">;

function toSummary(r: SummaryRow): IntegrationSummary {
  return {
    ...r,
    provider: r.provider as IntegrationProviderId,
    status: r.status as IntegrationStatus,
    config: r.config ?? {},
  };
}

function whereRow(orgId: string, provider: IntegrationProviderId) {
  return and(
    eq(orgIntegrations.organizationId, orgId),
    eq(orgIntegrations.provider, provider),
  );
}

/** 整合在目前語系下的顯示名稱（integrations.providers.<id>.name）。 */
export async function integrationDisplayName(provider: IntegrationProviderId): Promise<string> {
  const t = await getTranslations("integrations");
  return t(`providers.${provider}.name`);
}

// ---------------------------------------------------------------------------
// 讀（不含秘密）
// ---------------------------------------------------------------------------

/** 這個組織某個整合的狀態；沒連接回 null。不含任何密文。 */
export async function getIntegration(
  orgId: string,
  provider: IntegrationProviderId,
): Promise<IntegrationSummary | null> {
  const [row] = await getDb()
    .select(summaryColumns)
    .from(orgIntegrations)
    .leftJoin(user, eq(user.id, orgIntegrations.connectedByUserId))
    .where(whereRow(orgId, provider))
    .limit(1);
  return row ? toSummary(row) : null;
}

/** 這個組織所有已連接的整合。不含任何密文。 */
export async function listIntegrations(orgId: string): Promise<IntegrationSummary[]> {
  const rows = await getDb()
    .select(summaryColumns)
    .from(orgIntegrations)
    .leftJoin(user, eq(user.id, orgIntegrations.connectedByUserId))
    .where(eq(orgIntegrations.organizationId, orgId));
  return rows.map(toSummary);
}

// ---------------------------------------------------------------------------
// 讀（含秘密 —— 只給 provider 實作用）
// ---------------------------------------------------------------------------

/** 解密後的憑證；沒連接回 null。只能在 server 端使用，結果不得外傳。 */
export async function loadCredentials(
  orgId: string,
  provider: IntegrationProviderId,
): Promise<IntegrationCredentials | null> {
  const [row] = await getDb()
    .select({ credentialsEnc: orgIntegrations.credentialsEnc })
    .from(orgIntegrations)
    .where(whereRow(orgId, provider))
    .limit(1);
  if (!row?.credentialsEnc) return null;
  return decryptJson<IntegrationCredentials>(row.credentialsEnc);
}

/** 快取的 session token；沒有或已過期（預留 60 秒緩衝）回 null。 */
export async function loadTokenCache(
  orgId: string,
  provider: IntegrationProviderId,
): Promise<TokenCache | null> {
  const [row] = await getDb()
    .select({
      tokenCacheEnc: orgIntegrations.tokenCacheEnc,
      tokenExpiresAt: orgIntegrations.tokenExpiresAt,
    })
    .from(orgIntegrations)
    .where(whereRow(orgId, provider))
    .limit(1);
  if (!row?.tokenCacheEnc || !row.tokenExpiresAt) return null;
  const expiresAt = new Date(row.tokenExpiresAt);
  if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() - 60_000 <= Date.now()) {
    return null;
  }
  return { value: await decryptField(row.tokenCacheEnc), expiresAt };
}

/**
 * 業務邏輯執行前的關卡：整合必須已連接、已開啟、狀態 connected，否則丟
 * IntegrationUnavailableError（訊息會告訴使用者去哪裡修）。通過則回傳狀態與憑證。
 */
export async function requireEnabledIntegration(
  orgId: string,
  provider: IntegrationProviderId,
): Promise<{ row: IntegrationSummary; credentials: IntegrationCredentials }> {
  const row = await getIntegration(orgId, provider);
  const t = await getTranslations("integrations");
  const name = t(`providers.${provider}.name`);
  if (!row) {
    throw new IntegrationUnavailableError(provider, "not_connected", t("errors.unavailable", { name }));
  }
  if (row.status !== "connected") {
    throw new IntegrationUnavailableError(
      provider,
      row.status === "needs_reauth" ? "needs_reauth" : "error",
      t("errors.needsReauth", { name, error: row.lastError ?? t("status.unknownError") }),
    );
  }
  if (!row.enabled) {
    throw new IntegrationUnavailableError(provider, "disabled", t("errors.unavailable", { name }));
  }
  const credentials = await loadCredentials(orgId, provider);
  if (!credentials) {
    throw new IntegrationUnavailableError(provider, "not_connected", t("errors.unavailable", { name }));
  }
  return { row, credentials };
}

// ---------------------------------------------------------------------------
// 寫：provider 執行期回報
// ---------------------------------------------------------------------------

/** 存 provider 換來的 session token（加密）。 */
export async function saveTokenCache(
  orgId: string,
  provider: IntegrationProviderId,
  value: string,
  expiresAt: Date,
): Promise<void> {
  await getDb()
    .update(orgIntegrations)
    .set({
      tokenCacheEnc: await encryptField(value),
      tokenExpiresAt: expiresAt.toISOString(),
      updatedAt: sql`now()`,
    })
    .where(whereRow(orgId, provider));
}

/** 丟掉快取的 token（例如外部服務說它失效了，但帳密本身可能還能用）。 */
export async function clearTokenCache(
  orgId: string,
  provider: IntegrationProviderId,
): Promise<void> {
  await getDb()
    .update(orgIntegrations)
    .set({ tokenCacheEnc: null, tokenExpiresAt: null, updatedAt: sql`now()` })
    .where(whereRow(orgId, provider));
}

/**
 * 外部服務拒絕了憑證（密碼改了、token 被撤銷）。狀態改為 needs_reauth、清掉 token，
 * 之後 requireEnabledIntegration 會擋下並請使用者重新連接。enabled 不動 ——
 * 重新連接後會回到原本的開關狀態。error 會顯示給成員看，不得含憑證。
 */
export async function markNeedsReauth(
  orgId: string,
  provider: IntegrationProviderId,
  error: string,
): Promise<void> {
  await getDb()
    .update(orgIntegrations)
    .set({
      status: "needs_reauth",
      tokenCacheEnc: null,
      tokenExpiresAt: null,
      lastError: error,
      lastErrorAt: sql`now()`,
      updatedAt: sql`now()`,
    })
    .where(whereRow(orgId, provider));
}

/** 一次性失敗（網路、對方 5xx）：只記下錯誤，不改狀態。 */
export async function recordSyncFailure(
  orgId: string,
  provider: IntegrationProviderId,
  error: string,
): Promise<void> {
  await getDb()
    .update(orgIntegrations)
    .set({ lastError: error, lastErrorAt: sql`now()`, updatedAt: sql`now()` })
    .where(whereRow(orgId, provider));
}

/** 外部呼叫成功：記下時間並清掉上一次的錯誤。 */
export async function recordSyncSuccess(
  orgId: string,
  provider: IntegrationProviderId,
): Promise<void> {
  await getDb()
    .update(orgIntegrations)
    .set({
      lastSyncedAt: sql`now()`,
      lastError: null,
      lastErrorAt: null,
      updatedAt: sql`now()`,
    })
    .where(whereRow(orgId, provider));
}

/** 淺層合併非機密設定（jsonb ||），回傳合併後的 config；沒連接回 null。 */
export async function updateConfig(
  orgId: string,
  provider: IntegrationProviderId,
  patch: IntegrationConfig,
): Promise<IntegrationConfig | null> {
  const [row] = await getDb()
    .update(orgIntegrations)
    .set({
      config: sql`${orgIntegrations.config} || ${JSON.stringify(patch)}::jsonb`,
      updatedAt: sql`now()`,
    })
    .where(whereRow(orgId, provider))
    .returning({ config: orgIntegrations.config });
  return row?.config ?? null;
}

// ---------------------------------------------------------------------------
// 寫：設定頁的連接 / 開關 / 中斷（權限檢查在 server action，這裡不判斷角色）
// ---------------------------------------------------------------------------

/**
 * 寫入一次成功的連接。新連接 enabled = false；重新連接保留原本的 enabled。
 * config 與既有設定淺層合併（重新連接不會洗掉帳戶對應之類的設定）。
 */
export async function saveConnection(args: {
  orgId: string;
  provider: IntegrationProviderId;
  userId: string;
  credentials: IntegrationCredentials;
  config: IntegrationConfig;
  tokenCache?: TokenCache;
}): Promise<void> {
  const credentialsEnc = await encryptJson(args.credentials);
  const tokenCacheEnc = args.tokenCache ? await encryptField(args.tokenCache.value) : null;
  const tokenExpiresAt = args.tokenCache ? args.tokenCache.expiresAt.toISOString() : null;
  const configJson = JSON.stringify(args.config);
  await getDb()
    .insert(orgIntegrations)
    .values({
      organizationId: args.orgId,
      provider: args.provider,
      enabled: false,
      status: "connected",
      config: args.config,
      credentialsEnc,
      tokenCacheEnc,
      tokenExpiresAt,
      connectedByUserId: args.userId,
    })
    .onConflictDoUpdate({
      target: [orgIntegrations.organizationId, orgIntegrations.provider],
      set: {
        status: "connected",
        config: sql`${orgIntegrations.config} || ${configJson}::jsonb`,
        credentialsEnc,
        tokenCacheEnc,
        tokenExpiresAt,
        lastError: null,
        lastErrorAt: null,
        connectedByUserId: args.userId,
        connectedAt: sql`now()`,
        updatedAt: sql`now()`,
      },
    });
}

/** 開 / 關。回傳更新後的列數（0 = 沒連接）。 */
export async function setIntegrationEnabled(
  orgId: string,
  provider: IntegrationProviderId,
  enabled: boolean,
): Promise<number> {
  const rows = await getDb()
    .update(orgIntegrations)
    .set({ enabled, updatedAt: sql`now()` })
    .where(whereRow(orgId, provider))
    .returning({ id: orgIntegrations.id });
  return rows.length;
}

/** 中斷連接 = 刪列（連同密文）。回傳刪掉的列數。 */
export async function deleteIntegration(
  orgId: string,
  provider: IntegrationProviderId,
): Promise<number> {
  const rows = await getDb()
    .delete(orgIntegrations)
    .where(whereRow(orgId, provider))
    .returning({ id: orgIntegrations.id });
  return rows.length;
}

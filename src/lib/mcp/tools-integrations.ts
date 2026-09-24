import { getTranslations } from "next-intl/server";
import { logMcp, type ActivityAction } from "@/db/activity";
import { INTEGRATION_ORDER } from "@/lib/integrations/catalog";
import { getProvider } from "@/lib/integrations/registry";
import { listIntegrations, requireEnabledIntegration } from "@/lib/integrations/store";
import type {
  IntegrationCredentials,
  IntegrationProviderId,
  IntegrationSummary,
} from "@/lib/integrations/types";
import { INTEGRATION_PROVIDER_IDS } from "@/lib/integrations/types";
import {
  listResult,
  listSchema,
  ORG_ARG,
  resolveOrg,
  rowSchema,
  type ToolContext,
  type ToolDef,
} from "./shared";

// ---- 外部整合（org_integrations）----
//
// 這裡只有「看狀態」的 list_integrations。連接 / 開關 / 中斷一律在 web 的
// 設定 › 整合 做：要輸入憑證，而憑證不該經過 AI 對話。
//
// 各 provider 的業務工具（開發票、抓 Wise 交易…）放在各自的 tools-<provider>.ts，
// 並遵守同一套規則：
// - tools/list 是靜態的 —— 整合沒連接時工具照樣列出，execute 時才用
//   requireIntegrationForTool() 擋下，丟出清楚的中文錯誤（比照 sync_billing_calendar）。
// - 每一次打到外部服務都用 auditIntegrationCall() 記一筆操作紀錄。
// - 回傳值永遠不含憑證、token 或密文。

/** ISO 8601；DB 讀回來的 timestamptz 字串（`2026-09-24 10:00:00+00`）統一轉掉。 */
function iso(v: string | null): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toISOString();
}

/**
 * 給其他 tools-*.ts 用的關卡：整合必須已連接、已開啟、狀態正常，否則丟錯，訊息會
 * 告訴使用者請 owner / admin 到 設定 › 整合 處理。通過則回傳狀態與解密後的憑證 ——
 * 憑證只能拿去打外部服務，絕不可放進工具的回傳值。
 */
export async function requireIntegrationForTool(
  orgId: string,
  provider: IntegrationProviderId,
): Promise<{ row: IntegrationSummary; credentials: IntegrationCredentials }> {
  return requireEnabledIntegration(orgId, provider);
}

/**
 * 記錄一次對外部服務的呼叫（操作紀錄，channel = mcp，entity = integration）。
 *
 * handler 的 deriveMcpAudit 只會依工具名稱記「寫入了哪個 entity」；整合工具真正要追的
 * 是「代表這個組織打了哪個外部服務、做了什麼」，所以由工具自己在呼叫成功（或失敗）後
 * 明確記一筆。detail 會原樣顯示在操作紀錄，不得含憑證、token 或完整個資。
 * 記錄失敗不影響工具結果（logMcp 自己吞錯）。
 */
export async function auditIntegrationCall(
  ctx: ToolContext,
  orgId: string,
  provider: IntegrationProviderId,
  action: ActivityAction,
  detail: string,
): Promise<void> {
  await logMcp(orgId, ctx.userId, action, "integration", null, `${provider}: ${detail}`);
}

const INTEGRATION_ROW = rowSchema({
  provider: { type: "string", enum: [...INTEGRATION_PROVIDER_IDS] },
  name: { type: "string", description: "Display name." },
  available: {
    type: "boolean",
    description: "Whether this server has an implementation for the provider yet. False means it cannot be connected at all for now.",
  },
  connected: { type: "boolean", description: "Credentials are stored for this organization." },
  enabled: { type: "boolean", description: "Switched on by an owner/admin. New connections start off." },
  usable: {
    type: "boolean",
    description: "connected AND enabled AND status = connected — integration tools will run. Otherwise they fail with a message telling an owner/admin what to fix in 設定 › 整合.",
  },
  status: {
    type: ["string", "null"],
    enum: ["connected", "needs_reauth", "error", null],
    description: "null when not connected. needs_reauth = the service rejected the stored credentials; reconnect in the web app.",
  },
  config: {
    type: "object",
    description: "Non-secret settings (e.g. a discovered company id). Never contains credentials.",
  },
  connectedAt: { type: ["string", "null"], description: "ISO 8601 timestamp." },
  connectedBy: { type: ["string", "null"], description: "Name or email of the member who connected it." },
  tokenExpiresAt: {
    type: ["string", "null"],
    description: "ISO 8601; when the cached session token expires (it is refreshed automatically).",
  },
  lastSyncedAt: { type: ["string", "null"], description: "ISO 8601; last successful call to the service." },
  lastError: { type: ["string", "null"], description: "Most recent failure message, if any." },
});

export const integrationTools: Record<string, ToolDef> = {
  list_integrations: {
    description:
      "List this organization's external integrations (e.g. Simpany e-invoice, Wise) and whether each is connected, switched on and healthy. Never returns credentials. Connecting, switching on/off and disconnecting are done by an owner/admin in the web app under 設定 › 整合 (Settings › Integrations) — credentials are never entered over MCP.",
    inputSchema: {
      type: "object",
      properties: { ...ORG_ARG },
      additionalProperties: false,
    },
    outputSchema: listSchema(INTEGRATION_ROW),
    execute: async (args, ctx) => {
      const orgId = await resolveOrg(args, ctx);
      const [summaries, t] = await Promise.all([
        listIntegrations(orgId),
        getTranslations("integrations"),
      ]);
      return listResult(
        INTEGRATION_ORDER.map((provider) => {
          const s = summaries.find((x) => x.provider === provider);
          return {
            provider,
            name: t(`providers.${provider}.name`),
            available: getProvider(provider) !== null,
            connected: Boolean(s),
            enabled: s?.enabled ?? false,
            usable: Boolean(s?.enabled && s.status === "connected"),
            status: s?.status ?? null,
            config: s?.config ?? {},
            connectedAt: iso(s?.connectedAt ?? null),
            connectedBy: s?.connectedByName ?? null,
            tokenExpiresAt: iso(s?.tokenExpiresAt ?? null),
            lastSyncedAt: iso(s?.lastSyncedAt ?? null),
            lastError: s?.lastError ?? null,
          };
        }),
      );
    },
  },
};

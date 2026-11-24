import { getTranslations } from "next-intl/server";
import { logApi, logMcp, type ActivityAction } from "@/db/activity";
import { canManageOrg, getOrgRole } from "@/lib/session";
import { runScheduledSync } from "@/lib/integrations/autosync";
import {
  isAutoSyncOn,
  parseLastAutoSync,
  supportsAutoSync,
} from "@/lib/integrations/autosync-config";
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
// 這裡有「看狀態」的 list_integrations，與「立即跑一次每日自動同步」的
// run_integration_sync（owner / admin、只跑目前組織，與 cron 同一條程式碼路徑）。
// 開關、自動同步、中斷、計費範圍等設定工具在 tools-settings.ts（與網頁共用
// src/lib/integrations/settings-service.ts）。需要秘密的連接一律在 web 的 設定 › 整合 做：
// 憑證不經過 MCP / API；get_integration_connect_link 給出直接打開連接視窗的網址。
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
  const summary = `${provider}: ${detail}`;
  if (ctx.apiKey) {
    await logApi(orgId, ctx.userId, ctx.apiKey.name, action, "integration", null, summary);
    return;
  }
  await logMcp(orgId, ctx.userId, action, "integration", null, summary);
}

/**
 * 工具版的操作紀錄：依呼叫來源記成 mcp 或 api（API key 時 summary 帶金鑰名稱）。
 * 給共用 service（例如 src/lib/integrations/settings-service.ts 的 SettingsActor.log）用。
 */
export function toolAuditLog(ctx: ToolContext, orgId: string) {
  return async (action: ActivityAction, entityType: string, entityId: number | null, summary: string) => {
    if (ctx.apiKey) {
      await logApi(orgId, ctx.userId, ctx.apiKey.name, action, entityType, entityId, summary);
      return;
    }
    await logMcp(orgId, ctx.userId, action, entityType, entityId, summary);
  };
}

/** owner / admin 才能改組織層級設定；工具裡統一用這個擋（訊息給人看）。 */
export async function assertToolManager(orgId: string, ctx: ToolContext, what = "變更整合設定"): Promise<void> {
  const role = await getOrgRole(orgId, ctx.userId);
  if (!canManageOrg(role)) {
    throw new Error(`只有組織的擁有者或管理員可以${what}，請找 owner 或 admin 操作。`);
  }
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
  autoSync: {
    type: ["boolean", "null"],
    description:
      "Daily auto-sync switch (06:00 Asia/Taipei). true = on (the default), false = an owner/admin switched it off. null when the provider has no auto-sync or is not connected. Only runs while the integration is also enabled and healthy.",
  },
  lastAutoSync: {
    anyOf: [
      {
        type: "object",
        properties: {
          at: { type: "string", description: "ISO 8601." },
          ok: { type: "boolean" },
          summary: { type: "string", description: "What was synced (zh-TW)." },
          error: { type: ["string", "null"] },
          trigger: { type: "string", enum: ["cron", "manual"] },
        },
        required: ["at", "ok", "summary", "error", "trigger"],
        additionalProperties: false,
      },
      { type: "null" },
    ],
    description: "Result of the most recent auto-sync run for this integration (scheduled or manual); null if it never ran.",
  },
});

const AUTO_SYNC_ITEM = rowSchema({
  organizationId: { type: "string" },
  provider: { type: "string", enum: [...INTEGRATION_PROVIDER_IDS] },
  ok: { type: "boolean" },
  summary: { type: "string", description: "What was synced (zh-TW), one clause per step." },
  error: { type: ["string", "null"], description: "First failure message, if any." },
  durationMs: { type: "number" },
});

export const integrationTools: Record<string, ToolDef> = {
  list_integrations: {
    description:
      "List this organization's external integrations (e.g. Simpany e-invoice, Wise) and whether each is connected, switched on and healthy. Never returns credentials. Owners/admins can switch an integration on/off (set_integration_enabled), toggle its daily auto-sync (set_integration_auto_sync) and disconnect it (disconnect_integration) over MCP. Connecting with a secret (password, token, key) is web-only — get_integration_connect_link returns the URL that opens the connect sheet; secret-free connections (GCP workload identity) can use connect_integration.",
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
            autoSync: s && supportsAutoSync(provider) ? isAutoSyncOn(s.config) : null,
            lastAutoSync: s ? parseLastAutoSync(s.config) : null,
          };
        }),
      );
    },
  },

  run_integration_sync: {
    description:
      "Run the daily integration auto-sync right now for THIS organization only (owner/admin only) — exactly what the 06:00 Asia/Taipei scheduled run does, same code path. For each integration that is switched on, healthy and has auto-sync on: Simpany → import e-invoices of the last 90 days into invoices (+ auto-link) and this year's salary declarations (January: last year too); Wise → import balance-statement transactions into the ledger for mapped balances (deduped by Wise reference, never before the cutover date, new rows flagged needsReview). Azure / GCP billing → sync the billing accounts, resources, payment cards (Azure), invoices and monthly costs within the scope an owner/admin ticked in 設定 › 整合 (nothing when the scope is empty), then reconcile invoices against existing ledger rows (writes the ledger only when an account is set to create_unmatched and an invoice stayed unmatched for 45+ days, and — GCP accounts with bookPromotionCredits on, the default — two management-books-only (book = internal) entries per closed month for the cost covered by Google promotion credits: an expense and an equal 抵用點數 income, deduped, never re-created once deleted). Reads the third parties (Simpany GET-only for this, Wise GET-only, Azure/GCP read-only) and writes only this organization's own books; it NEVER issues or voids invoices and moves no money. Idempotent. Results are also stored per integration as lastAutoSync (see list_integrations). Can take a while (sequential, gentle on Simpany).",
    inputSchema: {
      type: "object",
      properties: { ...ORG_ARG },
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        trigger: { type: "string", enum: ["cron", "manual"] },
        startedAt: { type: "string", description: "ISO 8601." },
        finishedAt: { type: "string", description: "ISO 8601." },
        results: { type: "array", items: AUTO_SYNC_ITEM },
        skippedAutoSyncOff: {
          type: "array",
          description: "Enabled integrations skipped because an owner/admin switched auto-sync off.",
          items: rowSchema({
            organizationId: { type: "string" },
            provider: { type: "string", enum: [...INTEGRATION_PROVIDER_IDS] },
          }),
        },
      },
      required: ["trigger", "startedAt", "finishedAt", "results", "skippedAutoSyncOff"],
      additionalProperties: false,
    },
    annotations: {
      title: "Run the integration auto-sync now",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    execute: async (args, ctx) => {
      const orgId = await resolveOrg(args, ctx);
      const role = await getOrgRole(orgId, ctx.userId);
      if (!canManageOrg(role)) {
        throw new Error("只有組織的擁有者或管理員可以執行整合自動同步，請找 owner 或 admin 操作。");
      }
      return runScheduledSync(new Date(), {
        orgId,
        trigger: "manual",
        audit: (auditOrgId, provider, ok, summary) =>
          auditIntegrationCall(
            ctx,
            auditOrgId,
            provider,
            "update",
            `手動執行自動同步${ok ? "" : "（失敗）"}：${summary}`,
          ),
      });
    },
  },
};

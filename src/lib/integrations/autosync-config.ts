import type { IntegrationConfig, IntegrationProviderId } from "./types";

// 每日自動同步在 org_integrations.config 裡的兩個非機密欄位。client 與 server 都會
// import 這支（設定頁、MCP、autosync.ts），所以只能有純函式與型別，不能碰 DB。
//
//   config.autoSync      false = 關閉自動同步；沒有這個欄位或 true = 開啟（預設開）。
//   config.lastAutoSync  最近一次自動同步的結果（見 LastAutoSync），由 autosync.ts 寫入。

/** 有自動同步可跑的整合（其他整合的列不顯示開關）。 */
export const AUTO_SYNC_PROVIDERS: readonly IntegrationProviderId[] = ["simpany", "wise"];

export function supportsAutoSync(provider: IntegrationProviderId): boolean {
  return AUTO_SYNC_PROVIDERS.includes(provider);
}

/** 預設開啟：只有明確存了 false 才算關。 */
export function isAutoSyncOn(config: IntegrationConfig | null | undefined): boolean {
  return config?.autoSync !== false;
}

export type AutoSyncTrigger = "cron" | "manual";

/** config.lastAutoSync 的形狀。summary / error 是給人看的 zh-TW 文字，不含憑證。 */
export type LastAutoSync = {
  /** ISO 8601。 */
  at: string;
  ok: boolean;
  summary: string;
  error: string | null;
  /** cron = Cloudflare 排程；manual = owner / admin 按「立即執行自動同步」或 MCP run_integration_sync。 */
  trigger: AutoSyncTrigger;
};

/** 防禦式讀 config.lastAutoSync（jsonb，形狀不保證）；認不得就回 null。 */
export function parseLastAutoSync(config: IntegrationConfig | null | undefined): LastAutoSync | null {
  const raw = config?.lastAutoSync;
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.at !== "string" || typeof r.ok !== "boolean") return null;
  return {
    at: r.at,
    ok: r.ok,
    summary: typeof r.summary === "string" ? r.summary : "",
    error: typeof r.error === "string" ? r.error : null,
    trigger: r.trigger === "manual" ? "manual" : "cron",
  };
}

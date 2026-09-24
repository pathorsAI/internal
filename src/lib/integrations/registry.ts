import type { IntegrationProvider, IntegrationProviderId } from "./types";
import { simpanyProvider } from "./simpany";

/**
 * 已實作的整合。Simpany 已接上（src/lib/integrations/simpany.ts）。
 *
 * ── 如何新增一個整合的實作 ──────────────────────────────────────────────
 * 1. 在 src/lib/integrations/<id>.ts 寫一個 IntegrationProvider：
 *
 *      import type { IntegrationProvider } from "./types";
 *
 *      export const simpanyProvider: IntegrationProvider = {
 *        id: "simpany",
 *        async testConnection(creds, config) {
 *          // 用 creds.account / creds.password 實際登入一次。
 *          // 憑證錯 → return { ok: false, error: "帳號或密碼錯誤" }
 *          // 成功   → return { ok: true, config: { companyId }, tokenCache: { value, expiresAt } }
 *        },
 *      };
 *
 * 2. 在下面的 PROVIDERS 加一行：`simpany: simpanyProvider,`
 *    （這支只會被 server 端 import：actions、store、MCP 工具。）
 *
 * 3. 業務邏輯（開發票、抓交易…）寫在同一支或旁邊的檔案，執行前一律先
 *    `requireEnabledIntegration(orgId, "simpany")`（MCP 工具用
 *    `requireIntegrationForTool`）拿到 { row, credentials }，外部呼叫成功後
 *    `recordSyncSuccess`，憑證被拒時 `markNeedsReauth`。詳見 docs/integrations.md。
 *
 * 顯示用的資料（名稱、欄位、logo）不在這裡，在 catalog.ts 與 i18n。
 * ─────────────────────────────────────────────────────────────────────
 */
const PROVIDERS: Partial<Record<IntegrationProviderId, IntegrationProvider>> = {
  simpany: simpanyProvider,
};

/** 取實作；還沒實作的回 null（設定頁據此停用「連接」）。 */
export function getProvider(id: IntegrationProviderId): IntegrationProvider | null {
  return PROVIDERS[id] ?? null;
}

/** 有實作的整合代號，給設定頁判斷哪些能連接。 */
export function implementedProviderIds(): IntegrationProviderId[] {
  return (Object.keys(PROVIDERS) as IntegrationProviderId[]).filter((id) => PROVIDERS[id]);
}

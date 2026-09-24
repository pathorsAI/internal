import type { IntegrationCatalogEntry, IntegrationProviderId } from "./types";

/**
 * 整合的靜態目錄：設定頁要畫出一列所需的全部資訊（logo、要輸入哪些欄位），
 * 與「有沒有實作」無關。設定頁會列出這裡的每一筆；還沒在 registry.ts 登記實作的，
 * 連接按鈕會停用並註明「尚未開放連接」。
 *
 * 名稱與描述不寫在這裡，走 i18n：integrations.providers.<id>.name / .description。
 * 欄位標籤同理：integrations.fields.<labelKey>。
 *
 * client 與 server 都會 import 這支，不能碰 DB / crypto。
 */
export const INTEGRATION_CATALOG: Record<IntegrationProviderId, IntegrationCatalogEntry> = {
  simpany: {
    id: "simpany",
    logo: { letter: "S", className: "bg-emerald-600 text-white" },
    credentialFields: [
      { key: "account", labelKey: "account", type: "email", required: true, autoComplete: "username" },
      { key: "password", labelKey: "password", type: "password", required: true, autoComplete: "current-password" },
    ],
  },
  wise: {
    id: "wise",
    logo: { letter: "W", className: "bg-lime-400 text-emerald-950" },
    credentialFields: [
      { key: "apiToken", labelKey: "apiToken", type: "token", required: true, autoComplete: "off" },
    ],
  },
};

/** 設定頁的排列順序。 */
export const INTEGRATION_ORDER: readonly IntegrationProviderId[] = ["simpany", "wise"];

export function getCatalogEntry(id: IntegrationProviderId): IntegrationCatalogEntry {
  return INTEGRATION_CATALOG[id];
}

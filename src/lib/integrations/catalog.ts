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
    // 帳號底下只有一家公司時自動選；多家才需要填（連接失敗訊息會列出可選的 ID）。
    configFields: [
      { key: "companyId", labelKey: "companyId", type: "text", required: false, autoComplete: "off" },
    ],
    website: "https://simpany.co",
  },
  wise: {
    id: "wise",
    logo: { letter: "W", className: "bg-lime-400 text-emerald-950" },
    credentialFields: [
      { key: "apiToken", labelKey: "apiToken", type: "token", required: true, autoComplete: "off" },
    ],
  },
  // 唯讀：billing profile、subscription、付款卡、發票、Cost Management 費用。
  // 要同步哪些 billing profile 由設定頁的「計費範圍」勾選（config.billingProfileIds）。
  azure: {
    id: "azure",
    logo: { letter: "A", className: "bg-sky-600 text-white" },
    credentialFields: [
      { key: "tenantId", labelKey: "tenantId", type: "text", required: true, autoComplete: "off" },
      { key: "clientId", labelKey: "clientId", type: "text", required: true, autoComplete: "off" },
      { key: "clientSecret", labelKey: "clientSecret", type: "password", required: true, autoComplete: "off" },
    ],
    // service principal 只有 profile 層級角色時列不出 billing account，所以要人填。
    configFields: [
      { key: "billingAccountId", labelKey: "billingAccountId", type: "text", required: true, autoComplete: "off" },
    ],
    website: "https://portal.azure.com",
  },
  // 唯讀：billing account、底下專案；費用要另外開 BigQuery billing export（選填，填專案 + dataset，
  // 資料表 gcp_billing_export_v1_<帳號> 自動偵測）。
  // 要同步哪些 billing account 由設定頁的「計費範圍」勾選（config.billingAccountIds）。
  gcp: {
    id: "gcp",
    logo: { letter: "G", className: "bg-amber-400 text-amber-950" },
    // 兩種驗證方式（config.authMode）：
    //   key               貼 service account JSON key（加密存放）
    //   workload_identity 不存任何金鑰：平台用 OIDC_SIGNING_KEY 簽「這個組織」的 JWT，
    //                     經 GCP Workload Identity Federation 換 token 再 impersonate SA（src/lib/oidc.ts）
    credentialFields: [
      {
        key: "serviceAccountJson",
        labelKey: "serviceAccountJson",
        type: "token",
        required: true,
        autoComplete: "off",
        when: { key: "authMode", equals: "key" },
      },
    ],
    configFields: [
      {
        key: "authMode",
        labelKey: "authMode",
        type: "select",
        required: true,
        defaultValue: "key",
        options: [
          { value: "key", labelKey: "authModeKey" },
          { value: "workload_identity", labelKey: "authModeWorkloadIdentity" },
        ],
      },
      {
        key: "wifAudience",
        labelKey: "wifAudience",
        type: "text",
        required: true,
        autoComplete: "off",
        when: { key: "authMode", equals: "workload_identity" },
      },
      {
        key: "serviceAccountEmail",
        labelKey: "serviceAccountEmail",
        type: "email",
        required: true,
        autoComplete: "off",
        when: { key: "authMode", equals: "workload_identity" },
      },
      { key: "bigQueryProjectId", labelKey: "bigQueryProjectId", type: "text", required: false, autoComplete: "off" },
      { key: "bigQueryDataset", labelKey: "bigQueryDataset", type: "text", required: false, autoComplete: "off" },
    ],
    website: "https://console.cloud.google.com/billing",
  },
  discord: {
    id: "discord",
    logo: { letter: "D", className: "bg-indigo-500 text-white" },
    // webhook 網址本身就是憑證（含 token），所以放 credentialFields 加密存放。
    credentialFields: [
      { key: "webhookUrl", labelKey: "webhookUrl", type: "token", required: true, autoComplete: "off" },
    ],
    // 解析與預設值見 discord-config.ts；不合法的值在連接時就擋下。
    configFields: [
      { key: "mentionRoleId", labelKey: "mentionRoleId", type: "text", required: false, autoComplete: "off" },
      { key: "recapDay", labelKey: "recapDay", type: "text", required: false, autoComplete: "off" },
      { key: "reminderDays", labelKey: "reminderDays", type: "text", required: false, autoComplete: "off" },
    ],
    website: "https://discord.com",
  },
};

/** 設定頁的排列順序。 */
export const INTEGRATION_ORDER: readonly IntegrationProviderId[] = ["simpany", "wise", "azure", "gcp", "discord"];

export function getCatalogEntry(id: IntegrationProviderId): IntegrationCatalogEntry {
  return INTEGRATION_CATALOG[id];
}

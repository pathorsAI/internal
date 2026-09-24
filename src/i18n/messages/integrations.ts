import type { Dictionary } from "./dictionary";

/**
 * 設定 › 整合（/dashboard/settings/integrations）與 src/lib/integrations 共用的字串。
 *
 * 新增 provider 時要補：providers.<id>（name / description），以及它每個欄位在
 * fields.<key> 的標籤（catalog.ts 的 labelKey 就是這裡的 key，型別會檢查）。
 */
const integrations = {
  title: { "zh-TW": "整合", en: "Integrations" },
  description: {
    "zh-TW": "把這個組織接上外部服務。每個整合預設關閉：先連接（輸入憑證並實測），再手動開啟。",
    en: "Connect this organization to external services. Every integration starts off: connect it first (credentials are tested), then switch it on.",
  },
  readOnlyNote: {
    "zh-TW": "只有組織的擁有者或管理員可以連接、開關或中斷整合。",
    en: "Only organization owners or admins can connect, toggle or disconnect integrations.",
  },
  providers: {
    simpany: {
      name: { "zh-TW": "Simpany 電子發票", en: "Simpany e-invoice" },
      description: {
        "zh-TW": "用 Simpany 帳號開立與查詢電子發票。",
        en: "Issue and look up e-invoices with your Simpany account.",
      },
    },
    wise: {
      name: { "zh-TW": "Wise", en: "Wise" },
      description: {
        "zh-TW": "讀取 Wise 帳戶的餘額與交易，用來對帳。",
        en: "Read Wise balances and transactions for reconciliation.",
      },
    },
    googleCalendar: {
      name: { "zh-TW": "Google 日曆", en: "Google Calendar" },
      description: {
        "zh-TW": "把請款、收款與開發票的日期推到專屬日曆，提醒由 Google 發送。",
        en: "Pushes billing, payment and invoicing dates to a dedicated calendar; Google sends the reminders.",
      },
    },
  },
  fields: {
    account: { "zh-TW": "帳號（Email）", en: "Account (email)" },
    password: { "zh-TW": "密碼", en: "Password" },
    apiToken: { "zh-TW": "API Token", en: "API token" },
    companyId: { "zh-TW": "公司 ID（選填，帳號有多家公司時才需要）", en: "Company ID (optional; only if the account has several companies)" },
  },
  status: {
    notConnected: { "zh-TW": "未連接", en: "Not connected" },
    connectedOff: { "zh-TW": "已連接 · 已關閉", en: "Connected · off" },
    connected: { "zh-TW": "已連接", en: "Connected" },
    needsReauth: { "zh-TW": "需要重新連接：{error}", en: "Needs reconnecting: {error}" },
    error: { "zh-TW": "發生錯誤：{error}", en: "Error: {error}" },
    unknownError: { "zh-TW": "外部服務拒絕了憑證", en: "the service rejected the credentials" },
    connectedBy: { "zh-TW": "由 {name} 於 {date} 連接", en: "Connected by {name} on {date}" },
    lastSynced: { "zh-TW": "上次成功呼叫：{date}", en: "Last successful call: {date}" },
    calendarConnected: { "zh-TW": "已連接（由 {owner} 連結）", en: "Connected (by {owner})" },
    unknownMember: { "zh-TW": "某位成員", en: "a member" },
  },
  actions: {
    connect: { "zh-TW": "連接", en: "Connect" },
    reconnect: { "zh-TW": "重新連接", en: "Reconnect" },
    disconnect: { "zh-TW": "中斷連接", en: "Disconnect" },
    manage: { "zh-TW": "管理", en: "Manage" },
    toggleLabel: { "zh-TW": "開啟 {name}", en: "Enable {name}" },
  },
  notImplemented: { "zh-TW": "尚未開放連接", en: "Not available yet" },
  sheet: {
    connectTitle: { "zh-TW": "連接 {name}", en: "Connect {name}" },
    reconnectTitle: { "zh-TW": "重新連接 {name}", en: "Reconnect {name}" },
    description: {
      "zh-TW": "按下「測試並連接」後，系統會先用這組憑證實際登入一次，通過才會儲存。連接後預設是關閉的。",
      en: "\"Test and connect\" signs in with these credentials first and only saves them if that works. The integration stays off until you switch it on.",
    },
    reconnectDescription: {
      "zh-TW": "輸入新的憑證並實測；通過後會取代舊的，開關狀態維持不變。",
      en: "Enter new credentials to test; if they work they replace the old ones and the on/off state is kept.",
    },
    securityNote: {
      "zh-TW": "憑證只會加密存在伺服器，之後任何人（包含你）都看不到原值。",
      en: "Credentials are stored encrypted on the server; nobody, including you, can view them again.",
    },
    submit: { "zh-TW": "測試並連接", en: "Test and connect" },
    submitting: { "zh-TW": "測試中…", en: "Testing…" },
    cancel: { "zh-TW": "取消", en: "Cancel" },
  },
  discard: {
    title: { "zh-TW": "放棄輸入的內容？", en: "Discard what you entered?" },
    description: {
      "zh-TW": "關閉後剛才輸入的憑證不會保留。",
      en: "The credentials you typed will not be kept.",
    },
    confirm: { "zh-TW": "放棄", en: "Discard" },
    keepEditing: { "zh-TW": "繼續編輯", en: "Keep editing" },
  },
  disconnectConfirm: {
    title: { "zh-TW": "中斷 {name} 的連接？", en: "Disconnect {name}?" },
    description: {
      "zh-TW": "會刪除這個組織存的 {name} 憑證與設定，相關功能立即停用。要再使用需重新輸入憑證。",
      en: "This deletes the {name} credentials and settings stored for this organization and stops the integration immediately. You will need to re-enter credentials to use it again.",
    },
    confirm: { "zh-TW": "中斷連接", en: "Disconnect" },
    cancel: { "zh-TW": "取消", en: "Cancel" },
  },
  toast: {
    connected: {
      "zh-TW": "{name} 已連接。確認無誤後再打開開關。",
      en: "{name} connected. Switch it on when you're ready.",
    },
    reconnected: { "zh-TW": "{name} 已重新連接", en: "{name} reconnected" },
    disconnected: { "zh-TW": "已中斷 {name}", en: "{name} disconnected" },
    failed: { "zh-TW": "操作失敗", en: "Operation failed" },
  },
  errors: {
    notAllowed: {
      "zh-TW": "只有組織的擁有者或管理員可以變更整合",
      en: "Only organization owners or admins can change integrations",
    },
    unknownProvider: { "zh-TW": "不認得的整合：{provider}", en: "Unknown integration: {provider}" },
    notImplemented: {
      "zh-TW": "{name} 整合尚未實作，暫時無法連接",
      en: "The {name} integration is not implemented yet",
    },
    requiredField: { "zh-TW": "請填寫「{field}」", en: "\"{field}\" is required" },
    testFailed: { "zh-TW": "連線測試失敗：{error}", en: "Connection test failed: {error}" },
    notConnected: { "zh-TW": "{name} 尚未連接", en: "{name} is not connected" },
    cannotEnable: {
      "zh-TW": "{name} 需要先重新連接才能開啟",
      en: "{name} must be reconnected before it can be switched on",
    },
    encryptionKeyMissing: {
      "zh-TW": "伺服器尚未設定 FIELD_ENCRYPTION_KEY，無法安全儲存憑證，請聯絡系統管理員",
      en: "FIELD_ENCRYPTION_KEY is not configured on the server, so credentials cannot be stored safely. Contact your administrator.",
    },
    unavailable: {
      "zh-TW": "{name} 整合尚未連接／未開啟，請 owner 或 admin 到 設定 › 整合 開啟",
      en: "The {name} integration is not connected or not switched on. An owner or admin can turn it on under Settings › Integrations.",
    },
    needsReauth: {
      "zh-TW": "{name} 的憑證已失效（{error}），請 owner 或 admin 到 設定 › 整合 重新連接",
      en: "The {name} credentials no longer work ({error}). An owner or admin can reconnect it under Settings › Integrations.",
    },
  },
  activity: {
    connected: { "zh-TW": "連接 {name}", en: "{name} connected" },
    reconnected: { "zh-TW": "重新連接 {name}", en: "{name} reconnected" },
    enabled: { "zh-TW": "開啟 {name}", en: "{name} switched on" },
    disabled: { "zh-TW": "關閉 {name}", en: "{name} switched off" },
    disconnected: { "zh-TW": "中斷 {name}", en: "{name} disconnected" },
  },
} satisfies Dictionary;

export default integrations;

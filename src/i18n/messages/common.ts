import type { Dictionary } from "./dictionary";

const common = {
  meta: {
    description: { "zh-TW": "內部管理後台", en: "Internal management console" },
  },
  locale: {
    label: { "zh-TW": "語言", en: "Language" },
  },
  theme: {
    label: { "zh-TW": "外觀", en: "Appearance" },
    system: { "zh-TW": "跟隨系統", en: "System" },
    light: { "zh-TW": "亮色", en: "Light" },
    dark: { "zh-TW": "深色", en: "Dark" },
  },
  brand: {
    name: { "zh-TW": "內部管理系統", en: "Internal Console" },
  },
  nav: {
    root: { "zh-TW": "內部管理", en: "Internal management" },
    groups: {
      daily: { "zh-TW": "日常", en: "Daily" },
      accounting: { "zh-TW": "會計", en: "Accounting" },
      clients: { "zh-TW": "客戶 / 營運", en: "Clients & operations" },
      hr: { "zh-TW": "人事", en: "HR" },
      org: { "zh-TW": "組織", en: "Organization" },
    },
    items: {
      dashboard: { "zh-TW": "總覽", en: "Overview" },
      ai: { "zh-TW": "AI 助理", en: "AI assistant" },
      account: { "zh-TW": "個人設定", en: "Your profile" },
      billing: { "zh-TW": "請款看板", en: "Billing board" },
      transactions: { "zh-TW": "收支紀錄", en: "Ledger" },
      links: { "zh-TW": "待連結", en: "Pending links" },
      parties: { "zh-TW": "交易對象", en: "Counterparty" },
      categories: { "zh-TW": "分類", en: "Category" },
      advances: { "zh-TW": "代墊", en: "Advance" },
      accountantNotices: { "zh-TW": "待通知會計師", en: "Accountant notices" },
      bankAccounts: { "zh-TW": "銀行帳戶", en: "Bank account" },
      vendorBilling: { "zh-TW": "廠商計費 / 固定支出", en: "Vendor billing" },
      reconciliation: { "zh-TW": "對帳", en: "Reconciliation" },
      projects: { "zh-TW": "專案", en: "Project" },
      subscriptions: { "zh-TW": "訂閱 / 月費", en: "Subscription" },
      contracts: { "zh-TW": "合約", en: "Contract" },
      invoices: { "zh-TW": "發票", en: "Invoice" },
      reports: { "zh-TW": "報表", en: "Reports" },
      spendAnalysis: { "zh-TW": "支出分析", en: "Spend analysis" },
      invoiceReconcile: { "zh-TW": "發票對帳", en: "Invoice reconciliation" },
      employees: { "zh-TW": "員工", en: "Employee" },
      payroll: { "zh-TW": "薪資", en: "Payroll" },
      members: { "zh-TW": "成員", en: "Members" },
      activity: { "zh-TW": "操作紀錄", en: "Activity log" },
      mcp: { "zh-TW": "MCP", en: "MCP" },
      api: { "zh-TW": "API", en: "API" },
      integrations: { "zh-TW": "整合", en: "Integrations" },
      chatAccounts: { "zh-TW": "聊天帳號", en: "Chat accounts" },
      aiRules: { "zh-TW": "規則", en: "Rules" },
      settings: { "zh-TW": "組織設定", en: "Organization settings" },
    },
  },
  currency: {
    TWD: { "zh-TW": "台幣", en: "New Taiwan dollar" },
    USD: { "zh-TW": "美金", en: "US dollar" },
    EUR: { "zh-TW": "歐元", en: "Euro" },
    JPY: { "zh-TW": "日圓", en: "Japanese yen" },
    CNY: { "zh-TW": "人民幣", en: "Chinese yuan" },
  },
  auditMeta: {
    created: { "zh-TW": "建立", en: "Created" },
    updated: { "zh-TW": "最後修改", en: "Last updated" },
  },
  bookBadge: {
    internal: { "zh-TW": "管理帳", en: "Management" },
    external: { "zh-TW": "稅務帳", en: "Tax" },
    both: { "zh-TW": "兩本", en: "Both" },
  },
  combobox: {
    emptyText: { "zh-TW": "查無項目", en: "No matches" },
  },
  addToClaude: {
    label: { "zh-TW": "在 Claude 中連接", en: "Add to Claude" },
  },
  copyButton: {
    label: { "zh-TW": "複製", en: "Copy" },
    copied: { "zh-TW": "已複製", en: "Copied" },
  },
  datePicker: {
    placeholder: { "zh-TW": "選擇日期", en: "Select date" },
  },
  deleteButton: {
    label: { "zh-TW": "刪除", en: "Delete" },
    title: { "zh-TW": "確定要刪除嗎？", en: "Delete this?" },
    description: { "zh-TW": "此動作無法復原。", en: "This action cannot be undone." },
    cancel: { "zh-TW": "取消", en: "Cancel" },
    deleting: { "zh-TW": "刪除中…", en: "Deleting…" },
    toast: {
      success: { "zh-TW": "已刪除", en: "Deleted" },
      failure: { "zh-TW": "刪除失敗", en: "Failed to delete" },
    },
  },
  orgSwitcher: {
    placeholder: { "zh-TW": "選擇組織", en: "Select organization" },
    toast: {
      switchFailed: { "zh-TW": "切換組織失敗", en: "Failed to switch organization" },
    },
  },
  paginationNav: {
    ariaLabel: { "zh-TW": "分頁", en: "Pagination" },
    summary: { "zh-TW": "第 {page} / {totalPages} 頁 · 共 {total} 筆", en: "Page {page} of {totalPages} · {total} total" },
    prev: { "zh-TW": "上一頁", en: "Previous" },
    next: { "zh-TW": "下一頁", en: "Next" },
  },
  partyCombobox: {
    placeholder: { "zh-TW": "輸入或選擇…", en: "Type or select…" },
    emptyText: { "zh-TW": "查無此對象，儲存後會自動新增", en: "No match — will be added on save" },
    exists: { "zh-TW": "已存在，將連結到既有的「{name}」", en: "Already exists — will link to the existing “{name}”" },
    willCreate: { "zh-TW": "系統中沒有，儲存時會新增「{name}」", en: "Not found — will add “{name}” on save" },
  },
  partyField: {
    label: { "zh-TW": "客戶", en: "Client" },
    placeholderRequired: { "zh-TW": "輸入或選擇{label}…", en: "Type or select {label}…" },
    placeholderOptional: { "zh-TW": "輸入或選擇{label}（選填）…", en: "Type or select {label} (optional)…" },
  },
  userMenu: {
    signOut: { "zh-TW": "登出", en: "Sign out" },
    notSignedIn: { "zh-TW": "未登入", en: "Not signed in" },
    currentOrg: { "zh-TW": "組織：{name}", en: "Organization: {name}" },
    account: { "zh-TW": "個人設定", en: "Your profile" },
    invitations: { "zh-TW": "邀請", en: "Invitations" },
    invitationsTitle: { "zh-TW": "你收到的邀請", en: "Your invitations" },
    invitationsDescription: {
      "zh-TW": "接受後會直接切換到該組織",
      en: "Accepting switches you to that organization",
    },
  },
  // 營業稅別（合約／訂閱／請款項目與組織預設共用，migrations/0040）
  tax: {
    treatmentLabel: { "zh-TW": "稅別", en: "VAT treatment" },
    basisLabel: { "zh-TW": "金額基準", en: "Amount basis" },
    treatment: {
      taxable: { "zh-TW": "應稅 5%", en: "Taxable 5%" },
      zero_rated: { "zh-TW": "零稅率", en: "Zero-rated" },
      exempt: { "zh-TW": "免稅", en: "Exempt" },
      none: { "zh-TW": "不加收營業稅", en: "No VAT charged" },
    },
    basis: {
      net: { "zh-TW": "未稅", en: "Excl. tax (net)" },
      gross: { "zh-TW": "含稅", en: "Incl. tax (gross)" },
    },
    inherit: { "zh-TW": "沿用組織預設", en: "Use organization default" },
    inheritWithValue: { "zh-TW": "沿用組織預設（{value}）", en: "Organization default ({value})" },
    followsContract: { "zh-TW": "稅別跟隨合約", en: "VAT treatment follows the contract" },
    breakdown: { "zh-TW": "未稅 {net}＋稅 {tax}", en: "{net} net + {tax} tax" },
  },
} satisfies Dictionary;

export default common;

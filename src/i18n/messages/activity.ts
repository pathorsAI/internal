import type { Dictionary } from "./dictionary";

const activity = {
  title: { "zh-TW": "操作紀錄", en: "Activity log" },
  description: { "zh-TW": "誰在什麼時候新增 / 修改 / 刪除了哪筆資料（含透過 MCP 的操作），用來追查亂紀錄或亂刪除", en: "Who added / updated / deleted which record and when (including actions via MCP) — use this to trace stray edits or deletions" },
  columns: {
    time: { "zh-TW": "時間", en: "Time" },
    actor: { "zh-TW": "操作人", en: "Actor" },
    source: { "zh-TW": "來源", en: "Source" },
    action: { "zh-TW": "動作", en: "Action" },
    entity: { "zh-TW": "對象", en: "Entity" },
    summary: { "zh-TW": "說明", en: "Summary" },
  },
  empty: { "zh-TW": "尚無操作紀錄", en: "No activity yet" },
  source: {
    mcp: { "zh-TW": "MCP", en: "MCP" },
    web: { "zh-TW": "網頁", en: "Web" },
  },
  action: {
    create: { "zh-TW": "新增", en: "Added" },
    update: { "zh-TW": "修改", en: "Updated" },
    delete: { "zh-TW": "刪除", en: "Deleted" },
    read: { "zh-TW": "讀取", en: "Read" },
  },
  entity: {
    transaction: { "zh-TW": "交易", en: "Transaction" },
    party: { "zh-TW": "交易對象", en: "Counterparty" },
    category: { "zh-TW": "分類", en: "Category" },
    bank_account: { "zh-TW": "銀行帳戶", en: "Bank account" },
    employee: { "zh-TW": "員工", en: "Employee" },
    invoice: { "zh-TW": "發票", en: "Invoice" },
    reconciliation: { "zh-TW": "對帳", en: "Reconciliation" },
    project: { "zh-TW": "專案", en: "Project" },
    subscription: { "zh-TW": "訂閱", en: "Subscription" },
    contract: { "zh-TW": "合約", en: "Contract" },
    billing_item: { "zh-TW": "請款項目", en: "Billing item" },
    document: { "zh-TW": "憑證", en: "Document" },
    payroll_run: { "zh-TW": "薪資批次", en: "Payroll run" },
    payslip: { "zh-TW": "薪資單", en: "Payslip" },
  },
} satisfies Dictionary;

export default activity;

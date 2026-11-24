/**
 * 工具分組：每題不帶全部 116 支（工具說明就要 3–4 萬 token，模型也容易選錯），
 * 先依問題選組，每組 10–30 支。同一支工具可以在好幾組（例如 list_parties），合併時去重。
 *
 * 選組分兩段：
 * 1. 伺服器端先用關鍵字猜（pickGroups），最多兩組。猜不到就沿用這段對話上一題的組，
 *    再沒有就給「帳務」。
 * 2. 模型覺得缺工具時呼叫 load_tool_groups 自己再載入其他組（見 LOAD_TOOL_GROUPS_TOOL）。
 *
 * src/lib/ai/tool-groups.test.ts 檢查每一支站內可用的工具至少在一組裡，新工具不會默默消失。
 */

export const TOOL_GROUP_IDS = [
  "ledger",
  "clients",
  "hr",
  "invoices",
  "review",
  "integrations",
  "settings",
  "rules",
] as const;

export type ToolGroupId = (typeof TOOL_GROUP_IDS)[number];

type GroupDef = {
  /** 給模型看的一句話（英文，跟工具說明同語言）。 */
  summary: string;
  tools: readonly string[];
  /** 關鍵字，比對時不分大小寫。 */
  keywords: readonly string[];
};

// 跨組都需要的查詢：建紀錄前要先查 id。
const LOOKUPS = ["list_parties", "list_categories", "list_bank_accounts"] as const;

export const TOOL_GROUPS: Record<ToolGroupId, GroupDef> = {
  ledger: {
    summary:
      "Ledger: transactions (income/expense/transfer/advance), categories, bank accounts, counterparties, advances, financial overview, spend breakdown, and the general-ledger financial statements (government / management books) with their review items.",
    tools: [
      "list_transactions",
      "get_transaction",
      "create_transaction",
      "bulk_create_transactions",
      "update_transaction",
      "delete_transaction",
      "create_reimbursement",
      "submit_advance",
      "list_outstanding_advances",
      "get_financial_overview",
      "monthly_spend_breakdown",
      "list_categories",
      "create_category",
      "update_category",
      "delete_category",
      "list_bank_accounts",
      "get_bank_account",
      "create_bank_account",
      "update_bank_account",
      "delete_bank_account",
      "list_parties",
      "get_party",
      "create_party",
      "list_projects",
      "list_contracts",
      "list_subscriptions",
      "list_unlinked_transactions",
      "resolve_transaction_link",
      "rescan_transaction_links",
      "get_financial_statement",
      "list_ledger_review_items",
    ],
    keywords: [
      "交易", "記帳", "待連結", "連結", "掛上", "對不上", "記一筆", "支出", "收入", "花了", "花費", "付了", "收到", "轉帳", "帳戶", "銀行", "餘額",
      "分類", "代墊", "報帳", "收據", "發票照片", "先墊", "總覽", "淨額", "現金", "信用卡", "廠商", "前五", "前十",
      "財務報表", "資產負債表", "損益表", "現金流量表", "權益變動表", "試算表", "總帳", "政府帳", "管理帳", "股東往來",
      "transaction", "expense", "income", "spend", "balance", "account", "category", "advance", "ledger",
      "unlinked", "link", "balance sheet", "income statement", "cash flow", "trial balance", "financial statement",
    ],
  },
  clients: {
    summary:
      "Customers & contracts: customers and counterparties (incl. merge), contracts, subscriptions and their billing periods, projects, billing items, the billing board and upcoming charges.",
    tools: [
      "list_customers",
      "list_parties",
      "get_party",
      "create_party",
      "update_party",
      "delete_party",
      "merge_parties",
      "list_contracts",
      "create_contract",
      "update_contract",
      "delete_contract",
      "list_subscriptions",
      "get_subscription_schedule",
      "set_subscription_period",
      "delete_subscription_period",
      "create_subscription",
      "update_subscription",
      "delete_subscription",
      "list_projects",
      "create_project",
      "update_project",
      "delete_project",
      "list_upcoming_billing",
      "list_billing_status",
      "set_payment_allocations",
      "list_payment_allocations",
      "create_billing_item",
      "update_billing_item",
      "delete_billing_item",
      "sync_billing_calendar",
    ],
    keywords: [
      "客戶", "合約", "訂閱", "專案", "請款", "收款", "付款", "未收", "分配", "手續費", "匯差", "還沒付", "沒付", "應收", "到期", "逾期", "續約", "報價",
      "customer", "client", "contract", "subscription", "project", "billing", "overdue", "unpaid", "invoice due",
    ],
  },
  hr: {
    summary:
      "People & payroll: employees and their bank accounts, org members, payroll runs, payslips, salary status and arrears, Simpany salary declarations (read and dry-run preparation only).",
    tools: [
      "list_employees",
      "get_employee",
      "create_employee",
      "update_employee",
      "delete_employee",
      "list_org_members",
      "list_payroll_runs",
      "list_payslips",
      "list_salary_status",
      "pay_employee_salary",
      "salary_arrears",
      "list_employee_bank_accounts",
      "create_employee_bank_account",
      "update_employee_bank_account",
      "delete_employee_bank_account",
      "simpany_list_salary_declarations",
      "simpany_sync_salary_declarations",
      "simpany_prepare_salary_filing",
      ...LOOKUPS,
    ],
    keywords: [
      "員工", "薪資", "薪水", "人事", "勞保", "健保", "勞退", "發薪", "薪資單", "成員", "實習",
      "employee", "payroll", "salary", "payslip", "staff", "member",
    ],
  },
  invoices: {
    summary:
      "Invoices & tax: recorded invoices, Simpany e-invoices (list, sync, preview only — issuing and voiding are not available here), zero-rate reasons, tax-file uploads (list and preview only).",
    tools: [
      "list_invoices",
      "get_invoice",
      "create_invoice",
      "delete_invoice",
      "simpany_list_invoices",
      "simpany_get_invoice",
      "simpany_sync_invoices",
      "simpany_preview_invoice",
      "simpany_list_zero_rate_reasons",
      "simpany_list_tax_uploads",
      "simpany_preview_tax_upload",
      "get_vat_report",
      "list_transactions",
      "list_contracts",
      "list_subscriptions",
      "list_billing_status",
      "list_parties",
    ],
    keywords: [
      "發票", "電子發票", "統編", "營業稅", "稅", "申報", "零稅率", "作廢", "開立",
      "invoice", "e-invoice", "tax", "vat", "simpany",
    ],
  },
  review: {
    summary:
      "Review & audit: bank reconciliations, splitting one payment across receivables and absorbing bank fees (payment allocations), notices for the accountant (mark / unmark as sent), and the activity log of who changed what.",
    tools: [
      "set_payment_allocations",
      "list_payment_allocations",
      "list_reconciliations",
      "create_reconciliation",
      "update_reconciliation",
      "delete_reconciliation",
      "list_accountant_notices",
      "mark_accountant_notified",
      "unmark_accountant_notified",
      "list_activity",
      "list_transactions",
      "list_bank_accounts",
    ],
    keywords: [
      "對帳", "會計", "通知會計", "記帳士", "操作紀錄", "誰改", "誰刪", "紀錄", "稽核",
      "reconcil", "accountant", "activity", "audit", "who changed", "who deleted",
    ],
  },
  integrations: {
    summary:
      "Integrations & recurring costs: integration status and sync, Wise balances and statements, vendor billing accounts (cloud and any other vendor; an account with a schedule IS a recurring expense / 固定支出, with next charge date and this period's paid status) / payment methods / cloud invoices, and the Discord charge reminders + monthly recap. Register or edit recurring expenses with upsert_vendor_billing_account; the *_recurring_expense tools are compatibility shims over the same accounts.",
    tools: [
      "list_integrations",
      "run_integration_sync",
      "wise_list_balances",
      "wise_get_statement",
      "wise_sync_transactions",
      "list_vendor_billing_accounts",
      "get_vendor_billing_account",
      "upsert_vendor_billing_account",
      "list_payment_methods",
      "upsert_payment_method",
      "list_vendor_invoices",
      "resolve_vendor_invoice",
      "list_recurring_expenses",
      "create_recurring_expense",
      "update_recurring_expense",
      "delete_recurring_expense",
      "preview_billing_notifications",
      ...LOOKUPS,
    ],
    keywords: [
      "整合", "同步", "wise", "azure", "gcp", "雲端", "固定支出", "定期", "月費", "年費", "扣款", "卡", "discord",
      "integration", "sync", "recurring", "vendor", "cloud", "payment method",
    ],
  },
  settings: {
    summary:
      "Settings (owner/admin): switch integrations on/off, daily auto-sync, disconnect, connect links, Azure/GCP billing scope, Wise balance mappings, Google Calendar reminders, organization name, API keys, and vendor-billing admin (verify/delete accounts and payment methods, reconcile, sync now).",
    tools: [
      // 設定 › 整合 / 日曆 / 基本資料 / API（tools-settings.ts）
      "get_integration_connect_link",
      "connect_integration",
      "set_integration_enabled",
      "set_integration_auto_sync",
      "disconnect_integration",
      "get_cloud_billing_scope",
      "set_cloud_billing_scope",
      "refresh_cloud_billing_discovery",
      "get_wise_account_mappings",
      "set_wise_account_mappings",
      "refresh_wise_balances",
      "get_calendar_settings",
      "set_calendar_reminder_days",
      "disconnect_calendar",
      "update_organization",
      "list_api_keys",
      "revoke_api_key",
      // 廠商計費頁的管理動作（tools-vendor-billing-admin.ts）
      "verify_vendor_billing_account",
      "delete_vendor_billing_account",
      "delete_payment_method",
      "reconcile_vendor_invoices",
      "sync_vendor_billing",
      "list_vendor_invoice_link_candidates",
      "list_integrations",
      "list_vendor_billing_accounts",
      "list_bank_accounts",
    ],
    keywords: [
      "設定", "開關", "開啟", "關閉", "連接", "中斷", "計費範圍", "對應", "日曆", "提醒", "組織名稱", "改名", "金鑰", "對帳",
      "settings", "enable", "disable", "connect", "disconnect", "scope", "mapping", "api key", "calendar", "reconcile",
    ],
  },
  rules: {
    summary:
      "Rules: what users taught the assistant (e.g. counterparty X always goes to category Y, I paid my receipts myself) — list, save, change, disable and remove them.",
    tools: [
      "list_ai_rules",
      "create_ai_rule",
      "update_ai_rule",
      "remove_ai_rule",
      "list_categories",
      "list_parties",
    ],
    keywords: [
      "以後", "規則", "記住", "都歸", "預設", "always", "remember", "rule",
    ],
  },
};

export function isToolGroupId(v: unknown): v is ToolGroupId {
  return typeof v === "string" && (TOOL_GROUP_IDS as readonly string[]).includes(v);
}

/** 依問題的關鍵字挑組，命中最多的排前面，最多 `limit` 組。 */
export function pickGroups(question: string, limit = 2): ToolGroupId[] {
  const q = question.toLowerCase();
  const scored = TOOL_GROUP_IDS.map((id) => ({
    id,
    score: TOOL_GROUPS[id].keywords.filter((k) => q.includes(k.toLowerCase())).length,
  }))
    .filter((g) => g.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((g) => g.id);
}

/** 這一題一開始要帶的組：關鍵字 → 上一題 → 帳務。 */
export function initialGroups(question: string | null, previous: readonly string[]): ToolGroupId[] {
  const picked = question ? pickGroups(question) : [];
  if (picked.length > 0) return picked;
  const prev = previous.filter(isToolGroupId);
  if (prev.length > 0) return prev.slice(0, 2);
  return ["ledger"];
}

/** 幾組合併成去重後的工具名稱清單。 */
export function toolsForGroups(groups: readonly ToolGroupId[]): string[] {
  return [...new Set(groups.flatMap((g) => TOOL_GROUPS[g].tools))];
}

export const LOAD_TOOL_GROUPS = "load_tool_groups";

/** 給模型自己再載入其他組的 meta 工具（OpenAI function 格式）。 */
export function loadToolGroupsTool(loaded: readonly ToolGroupId[]) {
  const lines = TOOL_GROUP_IDS.map(
    (id) => `- ${id}${loaded.includes(id) ? " (loaded)" : ""}: ${TOOL_GROUPS[id].summary}`,
  );
  return {
    type: "function" as const,
    function: {
      name: LOAD_TOOL_GROUPS,
      description: [
        "Load more tool groups when the tools you have cannot answer the question. The new tools are available on your next step.",
        "Groups:",
        ...lines,
      ].join("\n"),
      parameters: {
        type: "object",
        properties: {
          groups: {
            type: "array",
            items: { type: "string", enum: [...TOOL_GROUP_IDS] },
            description: "Group ids to load.",
          },
        },
        required: ["groups"],
        additionalProperties: false,
      },
    },
  };
}

/**
 * 工具分組：每題不帶全部 111 支（工具說明就要 3–4 萬 token，模型也容易選錯），
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
      "Ledger: transactions (income/expense/transfer/advance), categories, bank accounts, counterparties, advances, financial overview and spend breakdown.",
    tools: [
      "list_transactions",
      "get_transaction",
      "create_transaction",
      "bulk_create_transactions",
      "update_transaction",
      "delete_transaction",
      "create_reimbursement",
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
    ],
    keywords: [
      "交易", "記帳", "記一筆", "支出", "收入", "花了", "花費", "付了", "收到", "轉帳", "帳戶", "銀行", "餘額",
      "分類", "代墊", "報帳", "總覽", "淨額", "現金", "信用卡", "廠商", "前五", "前十",
      "transaction", "expense", "income", "spend", "balance", "account", "category", "advance", "ledger",
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
      "create_billing_item",
      "update_billing_item",
      "delete_billing_item",
      "sync_billing_calendar",
    ],
    keywords: [
      "客戶", "合約", "訂閱", "專案", "請款", "收款", "付款", "未收", "還沒付", "沒付", "應收", "到期", "逾期", "續約", "報價",
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
      "Review & audit: bank reconciliations, notices for the accountant (mark / unmark as sent), and the activity log of who changed what.",
    tools: [
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
      "Integrations & recurring costs: integration status and sync, Wise balances and statements, cloud vendor billing accounts / payment methods / cloud invoices, recurring expenses and their Discord notifications.",
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

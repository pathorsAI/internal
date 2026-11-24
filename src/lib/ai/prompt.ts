import type { Locale } from "@/i18n/config";
import { canUseWrites, type OrgRole } from "./tool-policy";
import { LOAD_TOOL_GROUPS } from "./tool-groups";
import { CONFIRM_SUMMARY_ARG } from "./types";

/** 模型可以附連結的頁面（相對路徑，畫面上會變成站內連結）。 */
const PAGES: [path: string, what: string][] = [
  ["/dashboard", "overview"],
  ["/dashboard/billing", "billing board"],
  ["/dashboard/transactions", "transactions"],
  ["/dashboard/parties", "counterparties"],
  ["/dashboard/categories", "categories"],
  ["/dashboard/advances", "advances"],
  ["/dashboard/accountant-notices", "notices for the accountant"],
  ["/dashboard/bank-accounts", "bank accounts"],
  ["/dashboard/vendor-billing", "vendor billing"],
  ["/dashboard/reconciliation", "reconciliation"],
  ["/dashboard/projects", "projects"],
  ["/dashboard/subscriptions", "subscriptions"],
  ["/dashboard/recurring-expenses", "recurring expenses"],
  ["/dashboard/contracts", "contracts"],
  ["/dashboard/invoices", "invoices"],
  ["/dashboard/reports", "reports"],
  ["/dashboard/employees", "employees"],
  ["/dashboard/payroll", "payroll"],
  ["/dashboard/activity", "activity log"],
];

/** 只接受站內 dashboard 路徑，避免把任意字串塞進 system prompt。 */
export function sanitizePage(page: unknown): string | null {
  if (typeof page !== "string") return null;
  return /^\/dashboard(\/[a-z0-9\-/]*)?$/i.test(page) && page.length <= 120 ? page : null;
}

function taipeiToday(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function systemPrompt(opts: {
  orgName: string;
  locale: Locale;
  role: OrgRole;
  page: string | null;
  now?: Date;
}): string {
  const language = opts.locale === "en" ? "English" : "Traditional Chinese as used in Taiwan (繁體中文)";
  const pageList = PAGES.map(([p, w]) => `${p} (${w})`).join(", ");
  const lines = [
    `You are the AI assistant inside Pathors Internal, the bookkeeping system of the organization "${opts.orgName}". Today is ${taipeiToday(opts.now ?? new Date())} (Asia/Taipei). Amounts are TWD unless stated.`,
    `Reply in ${language}. Be brief: lead with the answer, then at most a few bullets or a small Markdown table. Never use emoji.`,
    "The organization is fixed to the one the user is signed in to. Never ask which organization and never pass organizationId.",
    "Use the tools to look things up; never invent numbers, ids or names. Before creating or editing a record that references another entity (categoryId, accountId, partyName/Id, projectId, contractId, subscriptionId), look it up first with the matching list_* tool.",
    "No tool moves money: pay, payment, transfer and salary always mean recording an entry in the books.",
    `Not available here: issuing or voiding e-invoices, emailing payslips, uploading tax files, writing or settling salary filings. For those, tell the user to use the Simpany pages in the app or an external agent connected over MCP.`,
    `If the tools you have cannot answer, call ${LOAD_TOOL_GROUPS} to load another group, then continue.`,
    `When useful, link the page where the user can check the result, with a relative Markdown link such as [交易](/dashboard/transactions). Pages: ${pageList}.`,
  ];
  if (canUseWrites(opts.role)) {
    lines.push(
      `Writes ([write] / [delete] tools): when the user asks for a change, call the tool directly with complete arguments and a ${CONFIRM_SUMMARY_ARG}. The app shows the user a confirmation card and runs the call only after they press Confirm, so do not ask "shall I?" in text first, and never say it is done until you have seen the tool result. If something required is missing or ambiguous (amount, date, account), ask one short question instead of guessing.`,
    );
  } else {
    lines.push(
      "This member has read-only access: you cannot create, edit or delete anything. If asked to, say that an owner or admin of the organization can do it.",
    );
  }
  if (opts.page) lines.push(`The user opened the assistant from the page ${opts.page}.`);
  return lines.join("\n\n");
}

/**
 * 站內 AI 助理能用哪些工具、哪些要先確認。
 *
 * 讀寫分類**不靠** ToolDef 的 readOnlyHint：116 支裡只有少數幾支有標，其他都沒寫。
 * 這裡用名稱前綴另外維護一份清單，預設值是「寫入」——新加的工具名稱沒對到只讀前綴，
 * 就一律先出確認卡，寧可多問一次也不要讓模型自己寫進帳本。
 * src/lib/ai/tool-policy.test.ts 會把 tools 裡的每一支都過一遍，新工具一定會被看到。
 */

/** 只讀：直接執行。 */
const READ_PREFIXES = [
  "list_",
  "get_",
  "wise_list_",
  "wise_get_",
  "simpany_list_",
  "simpany_get_",
  // 只算預覽、存一張 2 小時的草稿，不送出任何東西（送出的那支在 EXCLUDED_TOOLS）。
  "simpany_preview_",
] as const;

const READ_NAMES = new Set(["monthly_spend_breakdown", "salary_arrears"]);

/**
 * 對外生效、做出去就收不回來：開／作廢電子發票、寄薪資單、報稅上傳、薪資申報寫入與結算。
 * 第一版完全不載入給站內 AI，要做請回 Simpany 頁面或用外部 agent。
 */
export const EXCLUDED_TOOLS: ReadonlySet<string> = new Set([
  "simpany_issue_invoice",
  "simpany_void_invoice",
  "simpany_send_payslips",
  "simpany_upload_tax_files",
  "simpany_create_tax_upload_slots",
  "simpany_apply_salary_filing",
  "simpany_settle_salary_filing",
]);

/**
 * 站內 AI 的組織固定是目前登入的組織，所以切換／加入組織的工具不給它。
 * 這幾支不算「對外生效」，只是在這裡沒意義。
 */
export const ORG_SCOPE_TOOLS: ReadonlySet<string> = new Set([
  "list_organizations",
  "list_my_invitations",
  "accept_invitation",
]);

/** 刪除以外、但同樣收不回來的寫入：確認卡也標紅。 */
const IRREVERSIBLE_WRITES = new Set([
  "merge_parties",
  "pay_employee_salary",
  // 刪掉憑證 / 日曆 / 金鑰，要重新在網頁輸入或建立
  "disconnect_integration",
  "disconnect_calendar",
  "revoke_api_key",
]);

export type ToolLevel = "read" | "write" | "danger";

/** 不看參數的基本分類。 */
export function baseToolLevel(name: string): ToolLevel {
  if (READ_NAMES.has(name) || READ_PREFIXES.some((p) => name.startsWith(p))) return "read";
  if (name.startsWith("delete_") || IRREVERSIBLE_WRITES.has(name)) return "danger";
  return "write";
}

/**
 * 依這次呼叫的參數分類。少數工具同一支可以只看、也可以真的送出：
 * - preview_billing_notifications：預設 dry run；send=true 會發到團隊的 Discord。
 * - simpany_prepare_salary_filing：預設只試算；allowCopy=true 會複製上月申報、寫進 Simpany。
 * - rescan_transaction_links：預設 dry run；dryRun=false 才會把交易標成待連結。
 */
export function toolLevel(name: string, args: Record<string, unknown>): ToolLevel {
  if (name === "preview_billing_notifications") return args.send === true ? "write" : "read";
  if (name === "simpany_prepare_salary_filing") return args.allowCopy === true ? "write" : "read";
  if (name === "rescan_transaction_links") return args.dryRun === false ? "write" : "read";
  return baseToolLevel(name);
}

/** 這支工具能不能出現在站內 AI 裡（不看角色）。 */
export function isAssistantTool(name: string): boolean {
  return !EXCLUDED_TOOLS.has(name) && !ORG_SCOPE_TOOLS.has(name);
}

export type OrgRole = string | null;

/** 呼叫從哪個入口來。web = /dashboard/ai；line／whatsapp = 聊天 bot。 */
export type PolicyChannel = "web" | "line" | "whatsapp";

/** owner / admin 可以用全部（寫入仍要確認）；一般成員只開只讀＋MEMBER_WRITES。 */
export function canUseWrites(role: OrgRole): boolean {
  return role === "owner" || role === "admin";
}

/**
 * 一般成員也能用的寫入（仍要按確認卡）。只放「只動得到自己」的工具：
 * - submit_advance：提交自己的代墊（代墊人固定是本人，記成 needs_review）。
 * - 規則工具：成員只能建／改／刪自己的個人規則；組織規則的角色檢查寫在工具裡（MCP 也會用到）。
 * - undo_activity：寫入（要確認），成員只能復原自己的操作。
 */
export const MEMBER_WRITES: ReadonlySet<string> = new Set([
  "submit_advance",
  // 復原：工具裡再檢查一次——成員只能復原自己做的操作（src/lib/undo-rules.ts mayUndo）。
  "undo_activity",
  "create_ai_rule",
  "update_ai_rule",
  "remove_ai_rule",
]);

/**
 * 聊天裡不開放紅色等級（刪除、合併對象、發薪）：手機上誤按的代價太高，請使用者回網頁做。
 * 網頁 AI 不受影響。
 */
function blockedInChannel(name: string, args: Record<string, unknown> | null, channel: PolicyChannel): boolean {
  if (channel === "web") return false;
  return (args ? toolLevel(name, args) : baseToolLevel(name)) === "danger";
}

/**
 * 工具能不能「出現在」這個角色、這個入口的工具清單裡。只讀工具任何成員都能用；
 * 參數決定讀寫的那兩支，一般成員也看得到（只能用只讀的參數，見 canRun）。
 */
export function canOffer(name: string, role: OrgRole, channel: PolicyChannel = "web"): boolean {
  if (!isAssistantTool(name)) return false;
  if (blockedInChannel(name, null, channel)) return false;
  if (canUseWrites(role)) return true;
  if (role && MEMBER_WRITES.has(name)) return true;
  return (
    baseToolLevel(name) === "read" ||
    name === "preview_billing_notifications" ||
    name === "simpany_prepare_salary_filing" ||
    name === "rescan_transaction_links"
  );
}

/** 這次呼叫（含參數）能不能跑。執行前一律再檢查一次，不信任模型給的工具清單。 */
export function canRun(
  name: string,
  args: Record<string, unknown>,
  role: OrgRole,
  channel: PolicyChannel = "web",
): boolean {
  if (!isAssistantTool(name)) return false;
  if (blockedInChannel(name, args, channel)) return false;
  if (toolLevel(name, args) === "read") return true;
  if (canUseWrites(role)) return true;
  return Boolean(role) && MEMBER_WRITES.has(name);
}

/** canRun 不過時給模型看的理由（英文，跟工具說明同語言）。 */
export function refusalReason(name: string, args: Record<string, unknown> | null, channel: PolicyChannel): string {
  if (!isAssistantTool(name)) return "This tool is not available in the in-app assistant.";
  if (blockedInChannel(name, args, channel)) {
    return "Deleting, merging counterparties and paying salaries are not available in chat. Tell the user to do it on the web app and include a link to the page.";
  }
  return "This member has read-only access; writes need an owner or admin (members can only submit their own advances with submit_advance and manage their own rules).";
}

/**
 * 站內 AI 助理能用哪些工具、哪些要先確認。
 *
 * 讀寫分類**不靠** ToolDef 的 readOnlyHint：111 支裡只有少數幾支有標，其他都沒寫。
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
const IRREVERSIBLE_WRITES = new Set(["merge_parties", "pay_employee_salary"]);

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
 */
export function toolLevel(name: string, args: Record<string, unknown>): ToolLevel {
  if (name === "preview_billing_notifications") return args.send === true ? "write" : "read";
  if (name === "simpany_prepare_salary_filing") return args.allowCopy === true ? "write" : "read";
  return baseToolLevel(name);
}

/** 這支工具能不能出現在站內 AI 裡（不看角色）。 */
export function isAssistantTool(name: string): boolean {
  return !EXCLUDED_TOOLS.has(name) && !ORG_SCOPE_TOOLS.has(name);
}

export type OrgRole = string | null;

/** owner / admin 可以用全部（寫入仍要確認）；一般成員只開只讀。 */
export function canUseWrites(role: OrgRole): boolean {
  return role === "owner" || role === "admin";
}

/**
 * 工具能不能「出現在」這個角色的工具清單裡。只讀工具任何成員都能用；
 * 參數決定讀寫的那兩支，一般成員也看得到（只能用只讀的參數，見 canRun）。
 */
export function canOffer(name: string, role: OrgRole): boolean {
  if (!isAssistantTool(name)) return false;
  if (canUseWrites(role)) return true;
  return (
    baseToolLevel(name) === "read" ||
    name === "preview_billing_notifications" ||
    name === "simpany_prepare_salary_filing"
  );
}

/** 這次呼叫（含參數）能不能跑。執行前一律再檢查一次，不信任模型給的工具清單。 */
export function canRun(name: string, args: Record<string, unknown>, role: OrgRole): boolean {
  if (!isAssistantTool(name)) return false;
  return toolLevel(name, args) === "read" || canUseWrites(role);
}

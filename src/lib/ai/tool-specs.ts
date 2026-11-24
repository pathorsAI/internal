import { tools } from "@/lib/mcp/tools";
import type { ChatTool } from "./openrouter";
import { baseToolLevel, canOffer, type OrgRole, type PolicyChannel } from "./tool-policy";
import { loadToolGroupsTool, toolsForGroups, type ToolGroupId } from "./tool-groups";
import { CONFIRM_SUMMARY_ARG } from "./types";

type Schema = {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
};

/** 複製一份物件、拿掉指定的 key（不改原物件）。 */
function omit(obj: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).filter(([k]) => !keys.includes(k)));
}

/**
 * 給模型看的 inputSchema：拿掉 organizationId（站內 AI 的組織固定是目前登入的組織，
 * 執行時由伺服器塞進去），寫入工具多一個 confirmSummary，讓模型寫一句確認卡上的說明。
 */
export function assistantSchema(name: string, schema: Schema): Schema {
  const properties = omit(schema.properties, ["organizationId"]);
  const required = (schema.required ?? []).filter((r) => r !== "organizationId");
  const mayWrite = baseToolLevel(name) !== "read" || name === "preview_billing_notifications" || name === "simpany_prepare_salary_filing";
  if (mayWrite) {
    properties[CONFIRM_SUMMARY_ARG] = {
      type: "string",
      description:
        "One short line in the user's language describing exactly what this call will do, shown on the confirmation card (e.g. 「新增支出 11/24 軟體訂閱 NT$3,000，公司信用卡」).",
    };
    if (baseToolLevel(name) !== "read") required.push(CONFIRM_SUMMARY_ARG);
  }
  return {
    ...schema,
    properties,
    ...(required.length > 0 ? { required } : { required: undefined }),
  };
}

function tag(name: string): string {
  const level = baseToolLevel(name);
  if (level === "read") return "[read]";
  return level === "danger" ? "[delete]" : "[write]";
}

/** 這些組、這個角色、這個入口能用的工具，轉成 OpenAI function 格式，最後加上 load_tool_groups。 */
export function buildToolSpecs(
  groups: readonly ToolGroupId[],
  role: OrgRole,
  channel: PolicyChannel = "web",
): ChatTool[] {
  const specs: ChatTool[] = [];
  for (const name of toolsForGroups(groups)) {
    const def = tools[name];
    if (!def || !canOffer(name, role, channel)) continue;
    specs.push({
      type: "function",
      function: {
        name,
        description: `${tag(name)} ${def.description.replace(/^\s*\[(read|write|delete)\]\s*/i, "")}`,
        parameters: assistantSchema(name, def.inputSchema) as unknown as Record<string, unknown>,
      },
    });
  }
  specs.push(loadToolGroupsTool(groups));
  return specs;
}

/**
 * 模型給的參數字串 → 實際要執行的參數：拿掉 confirmSummary，強制 organizationId 為目前組織
 * （模型就算自己塞了別的組織也會被蓋掉）。JSON 壞掉就丟錯，由呼叫端回成工具錯誤。
 */
export function prepareArgs(
  raw: string,
  orgId: string,
): { args: Record<string, unknown>; summary: string | null } {
  let parsed: unknown = {};
  if (raw.trim()) {
    parsed = JSON.parse(raw);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Tool arguments must be a JSON object.");
  }
  const { [CONFIRM_SUMMARY_ARG]: summary, ...rest } = parsed as Record<string, unknown>;
  return {
    args: { ...rest, organizationId: orgId },
    summary: typeof summary === "string" && summary.trim() ? summary.trim().slice(0, 300) : null,
  };
}

/** 確認卡上要列的參數：拿掉 organizationId 與 confirmSummary。 */
export function displayArgs(args: Record<string, unknown>): Record<string, unknown> {
  return omit(args, ["organizationId", CONFIRM_SUMMARY_ARG]);
}

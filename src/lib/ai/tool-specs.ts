import { tools } from "@/lib/mcp/tools";
import type { ChatTool } from "./openrouter";
import { baseToolLevel, canOffer, type OrgRole } from "./tool-policy";
import { loadToolGroupsTool, toolsForGroups, type ToolGroupId } from "./tool-groups";
import { CONFIRM_SUMMARY_ARG } from "./types";

type Schema = {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
};

/**
 * 給模型看的 inputSchema：拿掉 organizationId（站內 AI 的組織固定是目前登入的組織，
 * 執行時由伺服器塞進去），寫入工具多一個 confirmSummary，讓模型寫一句確認卡上的說明。
 */
export function assistantSchema(name: string, schema: Schema): Schema {
  const { organizationId: _org, ...properties } = schema.properties;
  void _org;
  const required = (schema.required ?? []).filter((r) => r !== "organizationId");
  const mayWrite = baseToolLevel(name) !== "read" || name === "preview_billing_notifications" || name === "simpany_prepare_salary_filing";
  if (mayWrite) {
    properties[CONFIRM_SUMMARY_ARG] = {
      type: "string",
      description:
        "One short line in the user's language describing exactly what this call will do, shown on the confirmation card (e.g. 「新增支出 11/24 Google Workspace NT$3,000，玉山信用卡」).",
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

/** 這些組、這個角色能用的工具，轉成 OpenAI function 格式，最後加上 load_tool_groups。 */
export function buildToolSpecs(groups: readonly ToolGroupId[], role: OrgRole): ChatTool[] {
  const specs: ChatTool[] = [];
  for (const name of toolsForGroups(groups)) {
    const def = tools[name];
    if (!def || !canOffer(name, role)) continue;
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
  const { organizationId: _org, [CONFIRM_SUMMARY_ARG]: _summary, ...rest } = args;
  void _org;
  void _summary;
  return rest;
}

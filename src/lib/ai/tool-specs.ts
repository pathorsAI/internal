import { tools } from "@/lib/mcp/tools";
import type { ChatTool } from "./openrouter";
import { baseToolLevel, canOffer, type OrgRole, type PolicyChannel } from "./tool-policy";
import { loadToolGroupsTool, toolsForGroups, type ToolGroupId } from "./tool-groups";
import { CONFIRM_SUMMARY_ARG, type AssistantOrg } from "./types";

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

/** 站內 AI 這一題的組織範圍：本人所屬的組織，以及目前的組織（沒帶 organizationId 時用它）。 */
export type OrgScope = {
  currentOrgId: string;
  orgs: readonly AssistantOrg[];
};

/** 給模型看、也是 prepareArgs 收的值：有 slug 用 slug（比較好讀），沒有用 id。 */
function orgKey(o: AssistantOrg): string {
  return o.slug ?? o.id;
}

/** organizationId 參數：只在本人屬於兩個以上組織時出現，enum 是那些組織。 */
function orgParam(scope: OrgScope): Record<string, unknown> {
  const current = scope.orgs.find((o) => o.id === scope.currentOrgId);
  const options = scope.orgs.map((o) => `${orgKey(o)} = ${o.name}`).join("; ");
  const currentName = current ? ` (${current.name})` : "";
  return {
    type: "string",
    enum: scope.orgs.map(orgKey),
    description: `Organization to run this call in. Omit for the current organization${currentName}. Pass another one only when the record or the question belongs to it. Options: ${options}.`,
  };
}

/**
 * 給模型看的 inputSchema：organizationId 換成本人所屬組織的 enum（只屬於一個組織時拿掉，
 * 執行時由伺服器補上），寫入工具多一個 confirmSummary，讓模型寫一句確認卡上的說明。
 */
export function assistantSchema(name: string, schema: Schema, scope?: OrgScope): Schema {
  const hadOrg = "organizationId" in schema.properties;
  const properties = omit(schema.properties, ["organizationId"]);
  const required = (schema.required ?? []).filter((r) => r !== "organizationId");
  if (hadOrg && scope && scope.orgs.length > 1) properties.organizationId = orgParam(scope);
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
  scope?: OrgScope,
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
        parameters: assistantSchema(name, def.inputSchema, scope) as unknown as Record<string, unknown>,
      },
    });
  }
  specs.push(loadToolGroupsTool(groups));
  return specs;
}

/** 錯誤訊息裡的組織參數：字串原樣、其他基本型別用 String()，物件用 JSON。 */
function describeRequested(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "object" && v !== null) return JSON.stringify(v) ?? "";
  return String(v as number | boolean | bigint | symbol | undefined);
}

/**
 * 模型（或確認卡的「換到 …」）指定的組織 → 組織 id。id 或 slug 都收，但只收本人所屬的組織；
 * 沒指定就是目前的組織。不是成員就丟錯（呼叫端回成工具錯誤，模型看得到可以選哪些）。
 */
export function resolveTargetOrg(scope: OrgScope, requested: unknown): string {
  if (requested === undefined || requested === null || requested === "") return scope.currentOrgId;
  const found =
    typeof requested === "string" ? scope.orgs.find((o) => o.id === requested || o.slug === requested) : undefined;
  if (!found) {
    const options = scope.orgs.map((o) => `${orgKey(o)} (${o.name})`).join(", ");
    throw new Error(
      `You are not a member of organization "${describeRequested(requested)}". organizationId must be one of: ${options || scope.currentOrgId}.`,
    );
  }
  return found.id;
}

/** 只知道目前組織 id 的舊呼叫方式：範圍就只有它一個。 */
function toScope(scope: OrgScope | string): OrgScope {
  if (typeof scope !== "string") return scope;
  return { currentOrgId: scope, orgs: [{ id: scope, name: "", slug: null, logo: null, role: null }] };
}

/**
 * 模型給的參數字串 → 實際要執行的參數：拿掉 confirmSummary，organizationId 解析成組織 id
 * （沒帶 = 目前的組織；帶了本人不屬於的組織就丟錯，不會默默換掉）。JSON 壞掉也丟錯，
 * 由呼叫端回成工具錯誤。角色由呼叫端用目標組織另外檢查（canRunInOrg）。
 */
export function prepareArgs(
  raw: string,
  scopeOrOrgId: OrgScope | string,
): { args: Record<string, unknown>; summary: string | null } {
  let parsed: unknown = {};
  if (raw.trim()) {
    parsed = JSON.parse(raw);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Tool arguments must be a JSON object.");
  }
  const { [CONFIRM_SUMMARY_ARG]: summary, ...rest } = parsed as Record<string, unknown>;
  const organizationId = resolveTargetOrg(toScope(scopeOrOrgId), rest.organizationId);
  return {
    args: { ...rest, organizationId },
    summary: typeof summary === "string" && summary.trim() ? summary.trim().slice(0, 300) : null,
  };
}

/** 確認卡上要列的參數：拿掉 organizationId 與 confirmSummary。 */
export function displayArgs(args: Record<string, unknown>): Record<string, unknown> {
  return omit(args, ["organizationId", CONFIRM_SUMMARY_ARG]);
}

import * as aiDb from "@/db/ai";
import type { AiMessageRow, AiToolCall } from "@/db/ai";
import { runToolWithAudit } from "@/lib/mcp/handler";
import { MAX_MODEL_ROUNDS, MAX_STORED_TOOL_CHARS } from "./config";
import { loadAttachmentParts, toModelMessages, truncate, uiToolCall, type AttachmentReader } from "./history";
import {
  streamModelTurn,
  type ChatMessage,
  type ChatTool,
  type ContentPart,
  type ModelTurn,
} from "./openrouter";
import { matchCategoryRule, ruleHintText, type RuleLike } from "./rules";
import {
  initialGroups,
  isToolGroupId,
  LOAD_TOOL_GROUPS,
  type ToolGroupId,
} from "./tool-groups";
import { canRun, refusalReason, toolLevel, type OrgRole } from "./tool-policy";
import { buildToolSpecs, prepareArgs } from "./tool-specs";
import type { ChatChannel, ChatEvent, UiToolStatus } from "./types";

/**
 * 站內 AI 助理的一題：呼叫模型 → 執行只讀工具 → 再呼叫模型……直到模型直接回答、
 * 或遇到寫入工具。寫入工具不執行，先存成 status = 'pending' 的工具結果並送出確認卡，
 * 這一題就停在那裡；使用者按確認後由 resolveConfirmation 執行，再接著跑。
 *
 * 工具一律同程序呼叫 src/lib/mcp/tools 的定義（runToolWithAudit），不繞 HTTP 打自己的 /mcp。
 * 組織固定是目前登入的組織：ctx.orgHint 與每次的 organizationId 都由伺服器塞。
 */

export type Owner = { orgId: string; userId: string };

export type EngineDeps = {
  db: Pick<
    typeof aiDb,
    | "listAiMessages"
    | "insertAiMessage"
    | "touchAiConversation"
    | "resolvePendingToolMessage"
    | "claimPendingToolMessage"
    | "setToolMessageResult"
  >;
  runTool: typeof runToolWithAudit;
  model: (opts: {
    messages: ChatMessage[];
    tools: ChatTool[];
    signal?: AbortSignal;
    onText: (d: string) => void;
  }) => Promise<ModelTurn>;
  /**
   * 讀附件內容（圖片／PDF → 模型的內容片段），綁好組織。沒給就所有附件都只放文字佔位。
   * 正式版是 src/lib/ai/attachments.ts 的 readAttachmentParts。
   */
  readAttachments?: (orgId: string, refs: Parameters<AttachmentReader>[0]) => Promise<ReadonlyMap<number, ContentPart>>;
  /** 規則被套用（確認卡按下確認、而且用的就是規則建議的分類）：apply_count + 1。 */
  markRulesApplied?: (ids: number[]) => Promise<void>;
};

export function defaultDeps(apiKey: string): EngineDeps {
  return {
    db: aiDb,
    runTool: runToolWithAudit,
    model: (opts) => streamModelTurn({ apiKey, ...opts }),
  };
}

export type TurnContext = {
  owner: Owner;
  role: OrgRole;
  /** 從哪個入口來；預設 web。決定工具清單（聊天不開紅色等級）與稽核的 channel。 */
  channel?: ChatChannel;
  /** 組織規則＋本人的個人規則：待確認卡的 ruleHint、確認後的 apply_count 用。 */
  rules?: readonly RuleLike[];
  /** 卡片提示的語言。 */
  locale?: "zh-TW" | "en";
  conversationId: string;
  /** 對話目前記著的工具組（上一題用的）。 */
  toolGroups: readonly string[];
  systemPrompt: string;
  emit: (e: ChatEvent) => void;
  signal?: AbortSignal;
  deps: EngineDeps;
};

/** 稽核紀錄的 channel：網頁 AI 記 ai，聊天記 line／whatsapp。 */
function auditChannel(ctx: TurnContext): "ai" | "line" | "whatsapp" {
  return ctx.channel === "line" || ctx.channel === "whatsapp" ? ctx.channel : "ai";
}

function policyChannel(ctx: TurnContext): ChatChannel {
  return ctx.channel ?? "web";
}

/** 會建交易、可以套分類規則的工具。 */
const RULE_TOOLS = new Set(["create_transaction", "submit_advance"]);

/** 這次呼叫對到的分類規則（只看建交易的工具）。 */
function matchedRule(ctx: TurnContext, name: string, args: Record<string, unknown>): RuleLike | null {
  if (!RULE_TOOLS.has(name) || !ctx.rules?.length) return null;
  if (name === "create_transaction" && args.type !== "expense" && args.type !== "advance") return null;
  return matchCategoryRule(
    ctx.rules,
    {
      partyName: typeof args.partyName === "string" ? args.partyName : null,
      taxId: typeof args.taxId === "string" ? args.taxId : null,
      description: typeof args.description === "string" ? args.description : null,
    },
    { userId: ctx.owner.userId },
  );
}

/** 待確認卡的規則提示：規則建議的分類跟模型填的不同（或沒填）時才給。 */
export function ruleHintFor(ctx: TurnContext, name: string, args: Record<string, unknown>): string | undefined {
  const rule = matchedRule(ctx, name, args);
  if (!rule || rule.action.categoryId === args.categoryId) return undefined;
  return ruleHintText(rule, ctx.locale ?? "zh-TW");
}

function stringify(out: unknown): string {
  return truncate(JSON.stringify(out ?? null), MAX_STORED_TOOL_CHARS);
}

/** 執行一支工具（權限已檢查過），回傳要存進 DB 的狀態與內容。 */
async function execute(
  ctx: TurnContext,
  name: string,
  args: Record<string, unknown>,
  summary: string | null,
): Promise<{ status: "ok" | "error"; content: string; error?: string }> {
  const channel = auditChannel(ctx);
  const res = await ctx.deps.runTool(
    name,
    args,
    { userId: ctx.owner.userId, orgHint: ctx.owner.orgId, channel },
    channel,
    summary ?? undefined,
  );
  if (res.ok) return { status: "ok", content: stringify(res.out) };
  return { status: "error", content: JSON.stringify({ error: res.error }), error: res.error };
}

type Prepared = { args: Record<string, unknown>; summary: string | null };
type SaveResult = (status: "ok" | "error" | "pending", content: string | null) => Promise<unknown>;

/** 把這支工具呼叫的結果存成一則 tool 訊息。 */
function saverFor(ctx: TurnContext, call: AiToolCall): SaveResult {
  return (status, content) =>
    ctx.deps.db.insertAiMessage(ctx.conversationId, {
      role: "tool",
      toolCallId: call.id,
      toolName: call.name,
      status,
      content,
    });
}

/** load_tool_groups：把模型選的工具組併進來，回傳新的工具組。 */
async function handleLoadGroups(
  call: AiToolCall,
  groups: ToolGroupId[],
  save: SaveResult,
): Promise<ToolGroupId[]> {
  let requested: unknown[] = [];
  try {
    const parsed = JSON.parse(call.arguments || "{}") as { groups?: unknown };
    requested = Array.isArray(parsed.groups) ? parsed.groups : [];
  } catch {
    // 壞掉的參數當成沒選
  }
  const added = requested.filter(isToolGroupId);
  const nextGroups = [...new Set([...groups, ...added])];
  await save("ok", JSON.stringify({ loaded: nextGroups }));
  return nextGroups;
}

/** 一支一般工具呼叫：檢查參數與權限，只讀就執行，寫入就存成待確認。回傳是否在等確認。 */
async function handleOneCall(ctx: TurnContext, call: AiToolCall, save: SaveResult): Promise<boolean> {
  let prepared: Prepared;
  try {
    prepared = prepareArgs(call.arguments, ctx.owner.orgId);
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await save("error", JSON.stringify({ error: `Invalid arguments: ${error}` }));
    ctx.emit({ t: "tool", call: uiToolCall(call, "error", error) });
    return false;
  }

  if (!canRun(call.name, prepared.args, ctx.role, policyChannel(ctx))) {
    const error = refusalReason(call.name, prepared.args, policyChannel(ctx));
    await save("error", JSON.stringify({ error }));
    ctx.emit({ t: "tool", call: uiToolCall(call, "error", error) });
    return false;
  }

  if (toolLevel(call.name, prepared.args) !== "read") {
    // 規則提示存在 pending 列的 content 裡，網頁重新整理、聊天重畫卡片時都讀得到。
    const ruleHint = ruleHintFor(ctx, call.name, prepared.args);
    await save("pending", ruleHint ? JSON.stringify({ ruleHint }) : null);
    ctx.emit({ t: "tool", call: uiToolCall(call, "pending", undefined, ruleHint) });
    return true;
  }

  ctx.emit({ t: "tool", call: uiToolCall(call, "running") });
  const result = await execute(ctx, call.name, prepared.args, prepared.summary);
  await save(result.status, result.content);
  ctx.emit({ t: "tool_done", id: call.id, status: result.status, error: result.error });
  return false;
}

/** 處理模型這一輪要求的工具呼叫。回傳是否有寫入在等確認、以及新載入的工具組。 */
async function handleToolCalls(
  ctx: TurnContext,
  calls: AiToolCall[],
  groups: ToolGroupId[],
): Promise<{ pending: boolean; groups: ToolGroupId[] }> {
  let pending = false;
  let nextGroups = groups;
  for (const call of calls) {
    const save = saverFor(ctx, call);
    if (call.name === LOAD_TOOL_GROUPS) {
      nextGroups = await handleLoadGroups(call, nextGroups, save);
    } else if (await handleOneCall(ctx, call, save)) {
      pending = true;
    }
  }
  return { pending, groups: nextGroups };
}

/** 一題裡讀過的附件快取：同一題來回幾輪不重讀 STORAGE。 */
const attachmentCache = new WeakMap<TurnContext, Map<number, ContentPart>>();

async function attachmentPartsFor(
  ctx: TurnContext,
  history: Parameters<typeof loadAttachmentParts>[0],
): Promise<ReadonlyMap<number, ContentPart>> {
  const read = ctx.deps.readAttachments;
  if (!read) return new Map();
  let cache = attachmentCache.get(ctx);
  if (!cache) {
    cache = new Map();
    attachmentCache.set(ctx, cache);
  }
  const known = cache;
  const loaded = await loadAttachmentParts(history, async (refs) => {
    const missing = refs.filter((r) => !known.has(r.documentId));
    if (missing.length > 0) {
      for (const [id, part] of await read(ctx.owner.orgId, missing)) known.set(id, part);
    }
    return known;
  });
  return loaded;
}

/**
 * 從目前的歷史接著跑模型，直到回答完或停在確認卡。
 * opts.hasAttachments：這題有附件（照片、PDF）時一定帶「帳務」組（多半是要記帳）。
 */
export async function runModelLoop(
  ctx: TurnContext,
  question: string | null,
  opts: { hasAttachments?: boolean } = {},
): Promise<void> {
  let groups = initialGroups(question, ctx.toolGroups);
  if (opts.hasAttachments && !groups.includes("ledger")) groups = (["ledger", ...groups] as ToolGroupId[]).slice(0, 2);
  for (let round = 0; round < MAX_MODEL_ROUNDS; round++) {
    if (ctx.signal?.aborted) return;
    const history = await ctx.deps.db.listAiMessages(ctx.conversationId);
    const parts = await attachmentPartsFor(ctx, history);
    const messages: ChatMessage[] = [
      { role: "system", content: ctx.systemPrompt },
      ...toModelMessages(history, parts),
    ];
    const tools = buildToolSpecs(groups, ctx.role, policyChannel(ctx));
    ctx.emit({ t: "msg", id: `r${round}-${Date.now()}` });
    const turn = await ctx.deps.model({
      messages,
      tools,
      signal: ctx.signal,
      onText: (d) => ctx.emit({ t: "text", d }),
    });
    await ctx.deps.db.insertAiMessage(ctx.conversationId, {
      role: "assistant",
      content: turn.content || null,
      toolCalls: turn.toolCalls.length > 0 ? turn.toolCalls : null,
      inputTokens: turn.inputTokens,
      outputTokens: turn.outputTokens,
    });
    if (turn.toolCalls.length === 0) {
      await ctx.deps.db.touchAiConversation(ctx.owner, ctx.conversationId, groups);
      return;
    }
    const handled = await handleToolCalls(ctx, turn.toolCalls, groups);
    groups = handled.groups;
    if (handled.pending) {
      await ctx.deps.db.touchAiConversation(ctx.owner, ctx.conversationId, groups);
      return;
    }
  }
  await ctx.deps.db.touchAiConversation(ctx.owner, ctx.conversationId, groups);
  ctx.emit({ t: "error", code: "too_many_rounds" });
}

/** 使用者問新的一題之前：上一題沒按的確認卡一律當成取消。 */
export async function cancelStalePending(
  deps: EngineDeps,
  conversationId: string,
  history: readonly AiMessageRow[],
): Promise<void> {
  for (const r of history) {
    if (r.role === "tool" && r.status === "pending" && r.toolCallId) {
      await deps.db.resolvePendingToolMessage(
        conversationId,
        r.toolCallId,
        "cancelled",
        JSON.stringify({ status: "not_confirmed" }),
      );
    }
  }
}

/** 找出某個 tool_call 所在的那一則 assistant 訊息，以及同一輪的其他工具結果。 */
function findCall(history: readonly AiMessageRow[], toolCallId: string) {
  const assistant = history.find(
    (r) => r.role === "assistant" && (r.toolCalls ?? []).some((c) => c.id === toolCallId),
  );
  const call = assistant?.toolCalls?.find((c) => c.id === toolCallId);
  return { assistant, call };
}

/**
 * 確認卡按下確認：再檢查一次權限（角色可能在這段時間被改）、搶下這張卡、執行、存結果。
 * 卡已經被別的請求搶走時回傳 null。
 */
async function approveCall(
  ctx: TurnContext,
  toolCallId: string,
  call: AiToolCall,
): Promise<{ status: UiToolStatus; error?: string } | null> {
  let prepared: Prepared | null = null;
  try {
    prepared = prepareArgs(call.arguments, ctx.owner.orgId);
  } catch {
    prepared = null;
  }
  if (!prepared || !canRun(call.name, prepared.args, ctx.role, policyChannel(ctx))) {
    const error = prepared ? refusalReason(call.name, prepared.args, policyChannel(ctx)) : "Invalid arguments.";
    await ctx.deps.db.resolvePendingToolMessage(
      ctx.conversationId,
      toolCallId,
      "error",
      JSON.stringify({ error }),
    );
    return { status: "error", error };
  }
  const claimed = await ctx.deps.db.claimPendingToolMessage(ctx.conversationId, toolCallId);
  if (!claimed) return null;
  ctx.emit({ t: "tool_done", id: toolCallId, status: "running" });
  const result = await execute(ctx, call.name, prepared.args, prepared.summary);
  await ctx.deps.db.setToolMessageResult(ctx.conversationId, toolCallId, result.status, result.content);
  if (result.status === "ok") await recordRuleApplied(ctx, call.name, prepared.args);
  return { status: result.status, error: result.error };
}

/** 確認後建成的交易用的就是規則建議的分類：記一次套用（失敗不影響寫入）。 */
async function recordRuleApplied(ctx: TurnContext, name: string, args: Record<string, unknown>) {
  const rule = matchedRule(ctx, name, args);
  if (!rule || rule.action.categoryId !== args.categoryId || !ctx.deps.markRulesApplied) return;
  try {
    await ctx.deps.markRulesApplied([rule.id]);
  } catch (err) {
    console.error("[ai/engine] markRulesApplied failed", err);
  }
}

/**
 * 確認卡按下確認／取消。確認：再檢查一次權限（角色可能在這段時間被改）、搶下這張卡
 * （同一張卡按兩次只會執行一次）、執行、存結果。這一輪的卡都處理完、而且不是全部取消時，
 * 接著讓模型把結果講給使用者聽。
 */
export async function resolveConfirmation(
  ctx: TurnContext,
  toolCallId: string,
  approve: boolean,
): Promise<void> {
  const history = await ctx.deps.db.listAiMessages(ctx.conversationId);
  const { assistant, call } = findCall(history, toolCallId);
  const row = history.find((r) => r.role === "tool" && r.toolCallId === toolCallId);
  if (!assistant || !call || row?.status !== "pending") {
    ctx.emit({ t: "error", code: "not_found" });
    return;
  }

  let outcome: { status: UiToolStatus; error?: string } | null;
  if (approve) {
    outcome = await approveCall(ctx, toolCallId, call);
    if (!outcome) {
      ctx.emit({ t: "error", code: "not_found" });
      return;
    }
  } else {
    await ctx.deps.db.resolvePendingToolMessage(
      ctx.conversationId,
      toolCallId,
      "cancelled",
      JSON.stringify({ status: "cancelled" }),
    );
    outcome = { status: "cancelled" };
  }
  ctx.emit({ t: "tool_done", id: toolCallId, status: outcome.status, error: outcome.error });

  // 同一輪還有別張卡沒按，就等使用者；全部處理完才讓模型接著講。
  const after = await ctx.deps.db.listAiMessages(ctx.conversationId);
  const siblings = (assistant.toolCalls ?? []).map((c) =>
    after.find((r) => r.role === "tool" && r.toolCallId === c.id),
  );
  if (siblings.some((r) => r?.status === "pending")) {
    await ctx.deps.db.touchAiConversation(ctx.owner, ctx.conversationId);
    return;
  }
  if (siblings.every((r) => r?.status === "cancelled")) {
    await ctx.deps.db.touchAiConversation(ctx.owner, ctx.conversationId);
    return;
  }
  await runModelLoop(ctx, null);
}

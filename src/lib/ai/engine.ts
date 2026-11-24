import * as aiDb from "@/db/ai";
import type { AiMessageRow, AiToolCall } from "@/db/ai";
import { runToolWithAudit } from "@/lib/mcp/handler";
import { MAX_MODEL_ROUNDS, MAX_STORED_TOOL_CHARS } from "./config";
import { toModelMessages, truncate, uiToolCall } from "./history";
import { streamModelTurn, type ChatMessage, type ChatTool, type ModelTurn } from "./openrouter";
import {
  initialGroups,
  isToolGroupId,
  LOAD_TOOL_GROUPS,
  type ToolGroupId,
} from "./tool-groups";
import { canRun, isAssistantTool, toolLevel, type OrgRole } from "./tool-policy";
import { buildToolSpecs, prepareArgs } from "./tool-specs";
import type { ChatEvent, UiToolStatus } from "./types";

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
  conversationId: string;
  /** 對話目前記著的工具組（上一題用的）。 */
  toolGroups: readonly string[];
  systemPrompt: string;
  emit: (e: ChatEvent) => void;
  signal?: AbortSignal;
  deps: EngineDeps;
};

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
  const res = await ctx.deps.runTool(
    name,
    args,
    { userId: ctx.owner.userId, orgHint: ctx.owner.orgId },
    "ai",
    summary ?? undefined,
  );
  if (res.ok) return { status: "ok", content: stringify(res.out) };
  return { status: "error", content: JSON.stringify({ error: res.error }), error: res.error };
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
    const save = (status: "ok" | "error" | "pending", content: string | null) =>
      ctx.deps.db.insertAiMessage(ctx.conversationId, {
        role: "tool",
        toolCallId: call.id,
        toolName: call.name,
        status,
        content,
      });

    if (call.name === LOAD_TOOL_GROUPS) {
      let requested: unknown[] = [];
      try {
        const parsed = JSON.parse(call.arguments || "{}") as { groups?: unknown };
        requested = Array.isArray(parsed.groups) ? parsed.groups : [];
      } catch {
        // 壞掉的參數當成沒選
      }
      const added = requested.filter(isToolGroupId);
      nextGroups = [...new Set([...nextGroups, ...added])];
      await save("ok", JSON.stringify({ loaded: nextGroups }));
      continue;
    }

    let prepared: { args: Record<string, unknown>; summary: string | null };
    try {
      prepared = prepareArgs(call.arguments, ctx.owner.orgId);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      await save("error", JSON.stringify({ error: `Invalid arguments: ${error}` }));
      ctx.emit({ t: "tool", call: uiToolCall(call, "error", error) });
      continue;
    }

    if (!isAssistantTool(call.name) || !canRun(call.name, prepared.args, ctx.role)) {
      const error = isAssistantTool(call.name)
        ? "This member has read-only access; writes need an owner or admin."
        : "This tool is not available in the in-app assistant.";
      await save("error", JSON.stringify({ error }));
      ctx.emit({ t: "tool", call: uiToolCall(call, "error", error) });
      continue;
    }

    if (toolLevel(call.name, prepared.args) !== "read") {
      await save("pending", null);
      ctx.emit({ t: "tool", call: uiToolCall(call, "pending") });
      pending = true;
      continue;
    }

    ctx.emit({ t: "tool", call: uiToolCall(call, "running") });
    const result = await execute(ctx, call.name, prepared.args, prepared.summary);
    await save(result.status, result.content);
    ctx.emit({ t: "tool_done", id: call.id, status: result.status, error: result.error });
  }
  return { pending, groups: nextGroups };
}

/** 從目前的歷史接著跑模型，直到回答完或停在確認卡。 */
export async function runModelLoop(ctx: TurnContext, question: string | null): Promise<void> {
  let groups = initialGroups(question, ctx.toolGroups);
  for (let round = 0; round < MAX_MODEL_ROUNDS; round++) {
    if (ctx.signal?.aborted) return;
    const history = await ctx.deps.db.listAiMessages(ctx.conversationId);
    const messages: ChatMessage[] = [
      { role: "system", content: ctx.systemPrompt },
      ...toModelMessages(history),
    ];
    const tools = buildToolSpecs(groups, ctx.role);
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

  let status: UiToolStatus;
  let error: string | undefined;
  if (!approve) {
    await ctx.deps.db.resolvePendingToolMessage(
      ctx.conversationId,
      toolCallId,
      "cancelled",
      JSON.stringify({ status: "cancelled" }),
    );
    status = "cancelled";
  } else {
    let prepared: { args: Record<string, unknown>; summary: string | null } | null = null;
    try {
      prepared = prepareArgs(call.arguments, ctx.owner.orgId);
    } catch {
      prepared = null;
    }
    if (!prepared || !canRun(call.name, prepared.args, ctx.role)) {
      error = prepared
        ? "This member has read-only access; writes need an owner or admin."
        : "Invalid arguments.";
      await ctx.deps.db.resolvePendingToolMessage(
        ctx.conversationId,
        toolCallId,
        "error",
        JSON.stringify({ error }),
      );
      status = "error";
    } else {
      const claimed = await ctx.deps.db.claimPendingToolMessage(ctx.conversationId, toolCallId);
      if (!claimed) {
        ctx.emit({ t: "error", code: "not_found" });
        return;
      }
      ctx.emit({ t: "tool_done", id: toolCallId, status: "running" });
      const result = await execute(ctx, call.name, prepared.args, prepared.summary);
      await ctx.deps.db.setToolMessageResult(ctx.conversationId, toolCallId, result.status, result.content);
      status = result.status;
      error = result.error;
    }
  }
  ctx.emit({ t: "tool_done", id: toolCallId, status, error });

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

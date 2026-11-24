import type { AiMessageRow } from "@/db/ai";
import { MAX_HISTORY_MESSAGES, MAX_TOOL_CHARS_CURRENT, MAX_TOOL_CHARS_HISTORY } from "./config";
import type { ChatMessage } from "./openrouter";
import { LOAD_TOOL_GROUPS } from "./tool-groups";
import { toolLevel } from "./tool-policy";
import { displayArgs } from "./tool-specs";
import type { UiMessage, UiToolCall } from "./types";
import { CONFIRM_SUMMARY_ARG } from "./types";

export function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}\n…[truncated ${s.length - max} chars]`;
}

const NOT_CONFIRMED = JSON.stringify({
  status: "not_confirmed",
  message: "The user did not confirm this action, so it was NOT executed.",
});
const CANCELLED = JSON.stringify({
  status: "cancelled",
  message: "The user pressed Cancel on the confirmation card, so this action was NOT executed.",
});

/**
 * DB 裡的訊息 → 送給模型的 messages。
 * - 只取最後 MAX_HISTORY_MESSAGES 則，而且從一則 user 訊息開始（不能從半截的工具結果開始）。
 * - 最後一題（最後一則 user 之後）的工具結果給長一點，更早的縮短。
 * - 還在等確認、或被取消的寫入，照實告訴模型「沒有執行」。
 */
export function toModelMessages(rows: readonly AiMessageRow[]): ChatMessage[] {
  let start = Math.max(0, rows.length - MAX_HISTORY_MESSAGES);
  while (start < rows.length && rows[start].role !== "user") start++;
  const window = rows.slice(start);
  let lastUser = -1;
  window.forEach((r, i) => {
    if (r.role === "user") lastUser = i;
  });

  // 每個 tool_call 都要有一則對應的 tool 訊息，不然 API 會拒收。
  const answered = new Set(window.filter((r) => r.role === "tool").map((r) => r.toolCallId));

  const out: ChatMessage[] = [];
  window.forEach((r, i) => {
    if (r.role === "user") {
      out.push({ role: "user", content: r.content ?? "" });
      return;
    }
    if (r.role === "assistant") {
      const calls = r.toolCalls ?? [];
      out.push({
        role: "assistant",
        content: r.content || null,
        ...(calls.length > 0
          ? {
              tool_calls: calls.map((c) => ({
                id: c.id,
                type: "function" as const,
                function: { name: c.name, arguments: c.arguments || "{}" },
              })),
            }
          : {}),
      });
      for (const c of calls) {
        if (!answered.has(c.id)) {
          out.push({ role: "tool", tool_call_id: c.id, content: NOT_CONFIRMED });
        }
      }
      return;
    }
    // tool
    let content: string;
    if (r.status === "pending") content = NOT_CONFIRMED;
    else if (r.status === "cancelled") content = CANCELLED;
    else content = truncate(r.content ?? "", i > lastUser ? MAX_TOOL_CHARS_CURRENT : MAX_TOOL_CHARS_HISTORY);
    out.push({ role: "tool", tool_call_id: r.toolCallId ?? "", content });
  });
  return out;
}

function parseArgs(raw: string): Record<string, unknown> {
  try {
    const v = JSON.parse(raw || "{}") as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function errorText(content: string | null): string | undefined {
  if (!content) return undefined;
  try {
    const v = JSON.parse(content) as { error?: unknown };
    return typeof v.error === "string" ? v.error : undefined;
  } catch {
    return undefined;
  }
}

/** 一支工具呼叫在畫面上的樣子（歷史與串流共用）。 */
export function uiToolCall(
  call: { id: string; name: string; arguments: string },
  status: UiToolCall["status"],
  error?: string,
): UiToolCall {
  const args = parseArgs(call.arguments);
  const level = call.name === LOAD_TOOL_GROUPS ? "read" : toolLevel(call.name, args);
  const summary = typeof args[CONFIRM_SUMMARY_ARG] === "string" ? (args[CONFIRM_SUMMARY_ARG] as string) : undefined;
  return {
    id: call.id,
    name: call.name,
    status,
    level,
    ...(summary ? { summary } : {}),
    ...(level === "read" ? {} : { args: displayArgs(args) }),
    ...(error ? { error } : {}),
  };
}

/**
 * DB 裡的訊息 → 畫面。一題裡模型可能來回好幾輪（文字 → 工具 → 文字），畫面上把同一題的
 * assistant 訊息併成一個泡泡：文字接起來、工具依序列在一起。
 */
export function toUiMessages(rows: readonly AiMessageRow[]): UiMessage[] {
  const toolRows = new Map(rows.filter((r) => r.role === "tool").map((r) => [r.toolCallId, r]));
  const out: UiMessage[] = [];
  for (const r of rows) {
    if (r.role === "user") {
      out.push({ kind: "user", id: `m${r.id}`, text: r.content ?? "" });
      continue;
    }
    if (r.role !== "assistant") continue;
    const last = out.at(-1);
    const bubble =
      last?.kind === "assistant"
        ? last
        : (() => {
            const b: UiMessage = { kind: "assistant", id: `m${r.id}`, text: "", tools: [] };
            out.push(b);
            return b;
          })();
    if (bubble.kind !== "assistant") continue;
    if (r.content) bubble.text = bubble.text ? `${bubble.text}\n\n${r.content}` : r.content;
    for (const c of r.toolCalls ?? []) {
      const t = toolRows.get(c.id);
      const status = t?.status ?? "cancelled";
      bubble.tools.push(uiToolCall(c, status, status === "error" ? errorText(t?.content ?? null) : undefined));
    }
  }
  return out;
}

import type { AiMessageRow } from "@/db/ai";
import { parsePgTimestamp } from "@/lib/pg-time";
import { MAX_HISTORY_MESSAGES, MAX_TOOL_CHARS_CURRENT, MAX_TOOL_CHARS_HISTORY } from "./config";
import type { ChatMessage, ContentPart } from "./openrouter";
import { LOAD_TOOL_GROUPS } from "./tool-groups";
import { toolLevel } from "./tool-policy";
import { displayArgs } from "./tool-specs";
import type { AttachmentRef, UiMessage, UiToolCall } from "./types";
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

// ---------------------------------------------------------------------------
// 附件：最近幾則 user 訊息附的圖片／PDF 真的送給模型讀，其他只留一行文字
// ---------------------------------------------------------------------------

/** 最近幾則「帶附件」的 user 訊息會把檔案本身送給模型。 */
export const ATTACH_RECENT_MESSAGES = 3;
/** 超過這個時間的附件只留文字佔位（毫秒）。 */
export const ATTACH_MAX_AGE_MS = 30 * 60_000;
/** 單檔超過這個大小就不送給模型（位元組）。 */
export const ATTACH_MAX_BYTES = 10 * 1024 * 1024;

/** 模型讀得懂、會真的送過去的檔案種類。 */
export function isModelReadable(contentType: string | null | undefined): boolean {
  const t = (contentType ?? "").toLowerCase();
  return t.startsWith("image/") || t === "application/pdf";
}

/** 一個附件在文字裡的樣子：[附件 document #12：receipt.jpg]（模型拿 id 傳 documentIds）。 */
export function attachmentLabel(a: AttachmentRef): string {
  return `[附件 document #${a.documentId}：${a.fileName ?? "file"}]`;
}

/**
 * 這次要真的讀出來送給模型的附件：最近 ATTACH_RECENT_MESSAGES 則帶附件、而且在 ATTACH_MAX_AGE_MS
 * 之內的 user 訊息，只取圖片與 PDF。其他附件（舊的、別的格式）只會出現文字佔位。
 */
export function attachmentsToLoad(rows: readonly AiMessageRow[], now: number = Date.now()): AttachmentRef[] {
  const out: AttachmentRef[] = [];
  let seen = 0;
  for (let i = rows.length - 1; i >= 0 && seen < ATTACH_RECENT_MESSAGES; i--) {
    const r = rows[i];
    if (r.role !== "user" || !r.attachments?.length) continue;
    seen++;
    const at = parsePgTimestamp(r.createdAt);
    if (Number.isFinite(at) && now - at > ATTACH_MAX_AGE_MS) continue;
    for (const a of r.attachments) {
      if (isModelReadable(a.contentType) && !out.some((o) => o.documentId === a.documentId)) out.push(a);
    }
  }
  return out;
}

/** 位元組 → base64（Workers 與 bun 都有 btoa；分段轉避免超長字串爆 call stack）。 */
export function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCodePoint(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

/** 一個讀出來的附件 → 模型的內容片段（圖片用 image_url、PDF 用 file）。不支援的格式回 null。 */
export function attachmentPart(
  a: { fileName: string | null; contentType: string | null },
  bytes: Uint8Array,
): ContentPart | null {
  const type = (a.contentType ?? "").toLowerCase();
  if (bytes.byteLength > ATTACH_MAX_BYTES || !isModelReadable(type)) return null;
  const dataUrl = `data:${type};base64,${bytesToBase64(bytes)}`;
  if (type === "application/pdf") {
    return { type: "file", file: { filename: a.fileName ?? "document.pdf", file_data: dataUrl } };
  }
  return { type: "image_url", image_url: { url: dataUrl } };
}

/** 讀附件內容的函式（測試注入假的；正式版在 src/lib/ai/attachments.ts）。 */
export type AttachmentReader = (refs: AttachmentRef[]) => Promise<ReadonlyMap<number, ContentPart>>;

/** 依 attachmentsToLoad 讀出內容；讀不到的就不在回傳的 Map 裡（之後只放文字佔位）。 */
export async function loadAttachmentParts(
  rows: readonly AiMessageRow[],
  read: AttachmentReader,
  now: number = Date.now(),
): Promise<ReadonlyMap<number, ContentPart>> {
  const refs = attachmentsToLoad(rows, now);
  if (refs.length === 0) return new Map();
  return read(refs);
}

/** 一則 user 訊息送給模型的 content：有附件時文字後面列出每個附件，讀得到的再附上檔案本身。 */
function userContent(r: AiMessageRow, parts: ReadonlyMap<number, ContentPart>): string | ContentPart[] {
  const text = r.content ?? "";
  const attachments = r.attachments ?? [];
  if (attachments.length === 0) return text;
  const labels = attachments.map(attachmentLabel).join("\n");
  const joined = text ? `${text}\n${labels}` : labels;
  const files = attachments.map((a) => parts.get(a.documentId)).filter((p): p is ContentPart => Boolean(p));
  if (files.length === 0) return joined;
  return [{ type: "text", text: joined }, ...files];
}

/**
 * DB 裡的訊息 → 送給模型的 messages。
 * - 只取最後 MAX_HISTORY_MESSAGES 則，而且從一則 user 訊息開始（不能從半截的工具結果開始）。
 * - 最後一題（最後一則 user 之後）的工具結果給長一點，更早的縮短。
 * - 還在等確認、或被取消的寫入，照實告訴模型「沒有執行」。
 */
export function toModelMessages(
  rows: readonly AiMessageRow[],
  /** 已讀出的附件內容（documentId → 片段）；沒給就全部只放文字佔位。 */
  parts: ReadonlyMap<number, ContentPart> = new Map(),
): ChatMessage[] {
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
      out.push({ role: "user", content: userContent(r, parts) });
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

/** 待確認的工具結果 content 裡記著的規則提示（engine 存成 {"ruleHint": "..."}）。 */
export function pendingRuleHint(content: string | null): string | undefined {
  if (!content) return undefined;
  try {
    const v = JSON.parse(content) as { ruleHint?: unknown };
    return typeof v.ruleHint === "string" ? v.ruleHint : undefined;
  } catch {
    return undefined;
  }
}

/**
 * 寫入成功的工具結果：把操作紀錄 id 放在最前面（{"activityId": 123, …}），
 * 結果太長被截斷也還讀得出來（activityIdOf 用前綴比對）。結果不是物件就包一層。
 */
export function withActivityId(out: unknown, activityId: number): Record<string, unknown> {
  if (out && typeof out === "object" && !Array.isArray(out)) {
    const rest = { ...(out as Record<string, unknown>) };
    delete rest.activityId;
    return { activityId, ...rest };
  }
  return { activityId, result: out ?? null };
}

/** 工具結果 content 開頭的操作紀錄 id（engine 用 withActivityId 存的）。 */
export function activityIdOf(content: string | null): number | undefined {
  if (!content) return undefined;
  const m = /^\{"activityId":(\d+)/.exec(content);
  return m ? Number(m[1]) : undefined;
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
  ruleHint?: string,
  activityId?: number,
): UiToolCall {
  const args = parseArgs(call.arguments);
  const level = call.name === LOAD_TOOL_GROUPS ? "read" : toolLevel(call.name, args);
  const rawSummary = args[CONFIRM_SUMMARY_ARG];
  const summary = typeof rawSummary === "string" ? rawSummary : undefined;
  return {
    id: call.id,
    name: call.name,
    status,
    level,
    ...(summary ? { summary } : {}),
    ...(level === "read" ? {} : { args: displayArgs(args) }),
    ...(error ? { error } : {}),
    ...(ruleHint ? { ruleHint } : {}),
    ...(activityId === undefined ? {} : { activityId }),
  };
}

type AssistantBubble = Extract<UiMessage, { kind: "assistant" }>;

/** 同一題接在最後一個 assistant 泡泡後面；最後一則不是 assistant 就開一個新的。 */
function currentBubble(out: UiMessage[], id: string): AssistantBubble {
  const last = out.at(-1);
  if (last?.kind === "assistant") return last;
  const bubble: AssistantBubble = { kind: "assistant", id, text: "", tools: [] };
  out.push(bubble);
  return bubble;
}

/**
 * DB 裡的訊息 → 畫面。一題裡模型可能來回好幾輪（文字 → 工具 → 文字），畫面上把同一題的
 * assistant 訊息併成一個泡泡：文字接起來、工具依序列在一起。
 */
export function toUiMessages(rows: readonly AiMessageRow[]): UiMessage[] {
  const toolRows = new Map(rows.filter((r) => r.role === "tool").map((r) => [r.toolCallId, r]));
  const out: UiMessage[] = [];
  for (const r of rows) {
    if (r.role === "user") out.push(userBubble(r));
    else if (r.role === "assistant") appendAssistant(currentBubble(out, `m${r.id}`), r, toolRows);
  }
  return out;
}

function userBubble(r: AiMessageRow): UiMessage {
  return {
    kind: "user",
    id: `m${r.id}`,
    text: r.content ?? "",
    ...(r.attachments?.length ? { attachments: r.attachments } : {}),
  };
}

/** 一則 assistant 訊息接進泡泡：文字接在後面，工具呼叫依序帶上它的結果狀態。 */
function appendAssistant(
  bubble: AssistantBubble,
  r: AiMessageRow,
  toolRows: ReadonlyMap<string | null, AiMessageRow>,
): void {
  if (r.content) bubble.text = bubble.text ? `${bubble.text}\n\n${r.content}` : r.content;
  for (const c of r.toolCalls ?? []) {
    const t = toolRows.get(c.id);
    const status = t?.status ?? "cancelled";
    const content = t?.content ?? null;
    bubble.tools.push(
      uiToolCall(
        c,
        status,
        status === "error" ? errorText(content) : undefined,
        status === "pending" ? pendingRuleHint(content) : undefined,
        status === "ok" ? activityIdOf(content) : undefined,
      ),
    );
  }
}

/**
 * 前後端共用的型別：/api/ai/chat 串流出去的事件，以及畫面上的訊息。
 * 這支檔案不能 import 任何伺服器端的東西（client component 會用到）。
 */

import type { ToolLevel } from "./tool-policy";

export type UiToolStatus = "running" | "ok" | "error" | "pending" | "cancelled";

export type UiToolCall = {
  id: string;
  name: string;
  status: UiToolStatus;
  level: ToolLevel;
  /** 寫入工具：模型寫給使用者看的一句話（例如「新增支出 11/24 …」）。 */
  summary?: string;
  /** 寫入工具：要送出的參數（確認卡列出來）。 */
  args?: Record<string, unknown>;
  /** 失敗時的錯誤訊息。 */
  error?: string;
};

export type UiMessage =
  | { kind: "user"; id: string; text: string }
  | { kind: "assistant"; id: string; text: string; tools: UiToolCall[] };

export type UiConversation = { id: string; title: string; updatedAt: string };

/** /api/ai/chat 回應是一行一個 JSON（NDJSON）的這些事件。 */
export type ChatEvent =
  | { t: "conv"; id: string; title: string }
  | { t: "msg"; id: string }
  | { t: "text"; d: string }
  | { t: "tool"; call: UiToolCall }
  | { t: "tool_done"; id: string; status: UiToolStatus; error?: string }
  | { t: "error"; code: ChatErrorCode; message?: string }
  | { t: "done" };

export type ChatErrorCode =
  | "not_configured"
  | "model_failed"
  | "not_found"
  | "bad_request"
  | "too_many_rounds"
  | "internal";

export type ChatRequest = {
  conversationId?: string;
  message?: string;
  /** 發問時所在的頁面（例如 /dashboard/transactions），只在新對話的第一題帶。 */
  page?: string;
  confirm?: { toolCallId: string; approve: boolean };
};

/** 確認卡上要另外收起來不列的參數。 */
export const CONFIRM_SUMMARY_ARG = "confirmSummary";

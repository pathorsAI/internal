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
  /**
   * 建交易／提交代墊的待確認卡：組織或個人規則對到的分類跟模型填的不同（或沒填）時，
   * 給使用者看的一句提示，例如「依規則：Google Workspace → 軟體工具」。網頁與聊天卡片都顯示。
   */
  ruleHint?: string;
  /**
   * 這次呼叫要跑在哪個組織：模型帶的 organizationId（id 或 slug）。沒帶 = 目前的組織。
   * 確認卡與只讀工具的小標籤用它對回組織名稱與 logo。
   */
  organizationId?: string;
  /** 只在畫面上：使用者在確認卡按了「換到 …」，確認時要把 organizationId 一起送出。 */
  retargeted?: boolean;
};

/** 站內 AI 看得到的一個組織（本人所屬）。role 只在伺服器端有意義，畫面上可以不帶。 */
export type AssistantOrg = {
  id: string;
  name: string;
  slug: string | null;
  logo: string | null;
  role: string | null;
};

/** 對話從哪個入口來：網頁 /dashboard/ai、LINE、WhatsApp。 */
export type ChatChannel = "web" | "line" | "whatsapp";

export const CHAT_CHANNELS: readonly ChatChannel[] = ["web", "line", "whatsapp"];

/** 聊天 channel（不是網頁）。 */
export function isChatChannel(c: ChatChannel): c is "line" | "whatsapp" {
  return c === "line" || c === "whatsapp";
}

/** user 訊息附的一個檔案（存在 ai_messages.attachments，檔案本身是一列 documents）。 */
export type AttachmentRef = { documentId: number; fileName: string | null; contentType: string | null };

export type UiMessage =
  | { kind: "user"; id: string; text: string; attachments?: AttachmentRef[] }
  | { kind: "assistant"; id: string; text: string; tools: UiToolCall[] };

export type UiConversation = { id: string; title: string; updatedAt: string; channel?: ChatChannel };

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
  /**
   * organizationId：確認卡上按了「換到 …」—— 改在這個組織執行（id，伺服器會再查成員與角色，
   * 並把改過的參數記回對話）。
   */
  confirm?: { toolCallId: string; approve: boolean; organizationId?: string };
};

/** 確認卡上要另外收起來不列的參數。 */
export const CONFIRM_SUMMARY_ARG = "confirmSummary";

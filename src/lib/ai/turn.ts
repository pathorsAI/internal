import * as aiDb from "@/db/ai";
import type { AiConversationRow } from "@/db/ai";
import { listRulesForPrompt, markAiRulesApplied } from "@/db/ai-rules";
import { findLinkedEmployee } from "@/db/chat";
import type { Locale } from "@/i18n/config";
import { readAttachmentParts } from "./attachments";
import {
  cancelStalePending,
  defaultDeps,
  resolveConfirmation,
  runModelLoop,
  type EngineDeps,
  type Owner,
  type TurnContext,
} from "./engine";
import { sanitizePage, systemPrompt } from "./prompt";
import type { RuleLike } from "./rules";
import type { OrgRole } from "./tool-policy";
import { isChatChannel, type AttachmentRef, type ChatChannel, type ChatEvent } from "./types";

/**
 * 站內 AI 的「一題」：網頁（/api/ai/chat）與聊天 bot（src/lib/channels）都呼叫這裡，
 * 之後改規則、改 prompt 只要改一個地方。
 *
 * 做的事：找／建對話 → 問新題目時把上一題沒按的卡當取消、存 user 訊息（含附件）→
 * 組 system prompt（規則、使用者、員工資料、入口）→ runModelLoop；回覆確認卡時改走
 * resolveConfirmation。過程中的事件一律從 emit 送出（網頁轉成 NDJSON、聊天收集起來再送）。
 */

/** 聊天的對話閒置多久就自動開新的一段（毫秒）。 */
export const CHAT_IDLE_MS = 6 * 3_600_000;

/** runTurn 需要的外部依賴。全部可以換成假的（測試用）。 */
export type TurnDeps = {
  engine: EngineDeps;
  conversations: Pick<typeof aiDb, "getAiConversation" | "createAiConversation" | "findRecentAiConversation" | "listAiMessages">;
  /** 放進 prompt 的規則（組織＋本人）。 */
  listRules: (owner: Owner) => Promise<RuleLike[]>;
  /** 這位使用者在這個組織有沒有連到員工資料。 */
  hasEmployee: (owner: Owner) => Promise<boolean>;
  now?: () => Date;
};

/** 正式環境的依賴：DB、OpenRouter、STORAGE。 */
export function defaultTurnDeps(apiKey: string): TurnDeps {
  const engine: EngineDeps = {
    ...defaultDeps(apiKey),
    readAttachments: readAttachmentParts,
    markRulesApplied: (ids) => markAiRulesApplied(ids),
  };
  return {
    engine,
    conversations: aiDb,
    listRules: (owner) => listRulesForPrompt(owner.orgId, owner.userId),
    hasEmployee: async (owner) => (await findLinkedEmployee(owner.orgId, owner.userId)) !== null,
  };
}

export type RunTurnParams = {
  owner: Owner;
  role: OrgRole;
  channel: ChatChannel;
  /**
   * 指定對話。null／不給時：網頁開新的；聊天沿用 6 小時內最近一段同平台的對話，沒有才開新的。
   * 指定了卻找不到（不是本人的、被刪了）會丟 TurnNotFoundError，什麼事件都不送。
   */
  conversationId?: string | null;
  /** 聊天的「新對話」指令：不沿用最近的對話，一定開新的。 */
  forceNewConversation?: boolean;
  /** 問新的一題（與 confirm 二選一）。只有附件沒有字時給空字串。 */
  message?: string;
  /** 這題附的檔案（收件匣 document，已確認屬於這個組織）。 */
  attachments?: AttachmentRef[];
  /** 回覆一張確認卡（與 message 二選一）。 */
  confirm?: { toolCallId: string; approve: boolean };
  /** 網頁：發問時所在的頁面，只在新對話帶進 prompt。 */
  page?: string | null;
  locale: Locale;
  orgName: string;
  userName: string;
  /** 組織統編（知道的話）。 */
  orgTaxId?: string | null;
  /**
   * 教模型在問題最後一行寫 [[選項：…]]。聊天預設開；網頁 /api/ai/chat 傳 true，
   * 畫面把標記拆成可點的 chips（src/app/dashboard/ai/messages.tsx）。
   */
  quickReplies?: boolean;
  emit: (e: ChatEvent) => void;
  signal?: AbortSignal;
  deps: TurnDeps;
};

export type RunTurnResult = { conversationId: string; title: string; isNew: boolean };

export class TurnNotFoundError extends Error {
  constructor() {
    super("Conversation not found.");
  }
}

/** 對話標題：第一題的前 60 字（一行）；只有附件就用「附件」。 */
export function titleFrom(message: string, hasAttachments = false, locale: Locale = "zh-TW"): string {
  const oneLine = message.replaceAll(/\s+/g, " ").trim();
  if (!oneLine) return hasAttachments ? (locale === "en" ? "Attachment" : "附件") : "";
  return oneLine.length > 60 ? `${oneLine.slice(0, 59)}…` : oneLine;
}

async function resolveConversation(
  p: RunTurnParams,
): Promise<{ conversation: AiConversationRow; isNew: boolean }> {
  const db = p.deps.conversations;
  if (p.conversationId) {
    const found = await db.getAiConversation(p.owner, p.conversationId);
    if (!found) throw new TurnNotFoundError();
    return { conversation: found, isNew: false };
  }
  if (p.confirm) throw new TurnNotFoundError(); // 回覆確認卡一定要指定對話
  if (isChatChannel(p.channel) && !p.forceNewConversation) {
    const now = (p.deps.now ?? (() => new Date()))();
    const recent = await db.findRecentAiConversation(p.owner, p.channel, new Date(now.getTime() - CHAT_IDLE_MS));
    if (recent) return { conversation: recent, isNew: false };
  }
  const title = titleFrom(p.message ?? "", Boolean(p.attachments?.length), p.locale);
  return { conversation: await db.createAiConversation(p.owner, title, p.channel), isNew: true };
}

/**
 * 跑一題（或回覆一張確認卡）。回傳對話 id、標題、是不是新開的。
 * 模型失敗會丟 ModelError（呼叫端轉成 model_failed）；其他錯誤照常丟出。
 */
export async function runTurn(p: RunTurnParams): Promise<RunTurnResult> {
  if (Boolean(p.confirm) === (p.message !== undefined)) {
    throw new Error("runTurn needs exactly one of message or confirm.");
  }
  const { conversation, isNew } = await resolveConversation(p);
  const conversationId = conversation.id;
  const engine = p.deps.engine;

  const [rules, hasEmployee] = await Promise.all([
    p.deps.listRules(p.owner),
    p.deps.hasEmployee(p.owner),
  ]);
  const ctx: TurnContext = {
    owner: p.owner,
    role: p.role,
    channel: p.channel,
    rules,
    locale: p.locale,
    conversationId,
    toolGroups: conversation.toolGroups,
    systemPrompt: systemPrompt({
      orgName: p.orgName,
      locale: p.locale,
      role: p.role,
      page: isNew ? sanitizePage(p.page) : null,
      channel: p.channel,
      userName: p.userName,
      hasEmployee,
      rules,
      orgTaxId: p.orgTaxId ?? null,
      ...(p.quickReplies === undefined ? {} : { quickReplies: p.quickReplies }),
    }),
    emit: p.emit,
    signal: p.signal,
    deps: engine,
  };

  if (isNew) p.emit({ t: "conv", id: conversationId, title: conversation.title });
  if (p.message !== undefined) {
    const history = await p.deps.conversations.listAiMessages(conversationId);
    await cancelStalePending(engine, conversationId, history);
    const attachments = p.attachments ?? [];
    await engine.db.insertAiMessage(conversationId, {
      role: "user",
      content: p.message,
      attachments: attachments.length > 0 ? attachments : null,
    });
    await runModelLoop(ctx, p.message || null, { hasAttachments: attachments.length > 0 });
  } else if (p.confirm) {
    await resolveConfirmation(ctx, p.confirm.toolCallId, p.confirm.approve);
  }
  return { conversationId, title: conversation.title, isNew };
}

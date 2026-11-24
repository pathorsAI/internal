import { and, asc, desc, eq, sql } from "drizzle-orm";
import { getDb } from "./index";
import { aiConversations, aiMessages } from "./schema";

/**
 * 站內 AI 助理的對話（migrations/0036）。每個查詢都同時過濾 organization_id 與 user_id：
 * 對話只有本人、而且只在發問當下的組織看得到。
 */

export type AiToolCall = { id: string; name: string; arguments: string };

export type AiMessageRow = {
  id: number;
  role: "user" | "assistant" | "tool";
  content: string | null;
  toolCalls: AiToolCall[] | null;
  toolCallId: string | null;
  toolName: string | null;
  status: "ok" | "error" | "pending" | "cancelled" | null;
  createdAt: string;
};

export type AiConversationRow = {
  id: string;
  title: string;
  toolGroups: string[];
  updatedAt: string;
};

type Owner = { orgId: string; userId: string };

function ownedBy(owner: Owner) {
  return and(
    eq(aiConversations.organizationId, owner.orgId),
    eq(aiConversations.userId, owner.userId),
  );
}

export async function listAiConversations(owner: Owner, limit = 50): Promise<AiConversationRow[]> {
  return getDb()
    .select({
      id: aiConversations.id,
      title: aiConversations.title,
      toolGroups: aiConversations.toolGroups,
      updatedAt: aiConversations.updatedAt,
    })
    .from(aiConversations)
    .where(ownedBy(owner))
    .orderBy(desc(aiConversations.updatedAt))
    .limit(limit);
}

export async function getAiConversation(
  owner: Owner,
  id: string,
): Promise<AiConversationRow | null> {
  const [row] = await getDb()
    .select({
      id: aiConversations.id,
      title: aiConversations.title,
      toolGroups: aiConversations.toolGroups,
      updatedAt: aiConversations.updatedAt,
    })
    .from(aiConversations)
    .where(and(ownedBy(owner), eq(aiConversations.id, id)))
    .limit(1);
  return row ?? null;
}

export async function createAiConversation(owner: Owner, title: string): Promise<AiConversationRow> {
  const id = crypto.randomUUID();
  const [row] = await getDb()
    .insert(aiConversations)
    .values({ id, organizationId: owner.orgId, userId: owner.userId, title })
    .returning({
      id: aiConversations.id,
      title: aiConversations.title,
      toolGroups: aiConversations.toolGroups,
      updatedAt: aiConversations.updatedAt,
    });
  return row;
}

/** 碰一下 updated_at（排在列表最上面），順便更新已載入的工具組。 */
export async function touchAiConversation(
  owner: Owner,
  id: string,
  toolGroups?: string[],
): Promise<void> {
  await getDb()
    .update(aiConversations)
    .set({ updatedAt: sql`now()`, ...(toolGroups ? { toolGroups } : {}) })
    .where(and(ownedBy(owner), eq(aiConversations.id, id)));
}

export async function deleteAiConversation(owner: Owner, id: string): Promise<boolean> {
  const rows = await getDb()
    .delete(aiConversations)
    .where(and(ownedBy(owner), eq(aiConversations.id, id)))
    .returning({ id: aiConversations.id });
  return rows.length > 0;
}

/**
 * 一段對話的全部訊息（舊到新）。呼叫端必須先用 getAiConversation 確認這段對話屬於 owner ——
 * 這裡只拿 conversationId 查，不重複驗證。
 */
export async function listAiMessages(conversationId: string): Promise<AiMessageRow[]> {
  const rows = await getDb()
    .select({
      id: aiMessages.id,
      role: aiMessages.role,
      content: aiMessages.content,
      toolCalls: aiMessages.toolCalls,
      toolCallId: aiMessages.toolCallId,
      toolName: aiMessages.toolName,
      status: aiMessages.status,
      createdAt: aiMessages.createdAt,
    })
    .from(aiMessages)
    .where(eq(aiMessages.conversationId, conversationId))
    .orderBy(asc(aiMessages.id));
  return rows as AiMessageRow[];
}

export async function insertAiMessage(
  conversationId: string,
  m: {
    role: "user" | "assistant" | "tool";
    content?: string | null;
    toolCalls?: AiToolCall[] | null;
    toolCallId?: string | null;
    toolName?: string | null;
    status?: AiMessageRow["status"];
    inputTokens?: number | null;
    outputTokens?: number | null;
  },
): Promise<number> {
  const [row] = await getDb()
    .insert(aiMessages)
    .values({
      conversationId,
      role: m.role,
      content: m.content ?? null,
      toolCalls: m.toolCalls ?? null,
      toolCallId: m.toolCallId ?? null,
      toolName: m.toolName ?? null,
      status: m.status ?? null,
      inputTokens: m.inputTokens ?? null,
      outputTokens: m.outputTokens ?? null,
    })
    .returning({ id: aiMessages.id });
  return row.id;
}

/**
 * 把一筆等待確認的工具結果改成最終狀態。只改 status = 'pending' 的列：同一張確認卡
 * 被按兩次（或兩個分頁同時按）時，第二次改不到任何列，呼叫端據此不再執行第二次。
 */
export async function resolvePendingToolMessage(
  conversationId: string,
  toolCallId: string,
  status: "ok" | "error" | "cancelled",
  content: string,
): Promise<boolean> {
  const rows = await getDb()
    .update(aiMessages)
    .set({ status, content })
    .where(
      and(
        eq(aiMessages.conversationId, conversationId),
        eq(aiMessages.toolCallId, toolCallId),
        eq(aiMessages.role, "tool"),
        eq(aiMessages.status, "pending"),
      ),
    )
    .returning({ id: aiMessages.id });
  return rows.length > 0;
}

/**
 * 搶下一張確認卡：pending → 執行中。用一個 UPDATE … WHERE status='pending' 當鎖，
 * 只有搶到的那個請求會真的執行寫入。content 暫時寫成 running 標記，執行完再覆寫。
 */
export async function claimPendingToolMessage(
  conversationId: string,
  toolCallId: string,
): Promise<boolean> {
  const rows = await getDb()
    .update(aiMessages)
    .set({ status: "ok", content: '{"running":true}' })
    .where(
      and(
        eq(aiMessages.conversationId, conversationId),
        eq(aiMessages.toolCallId, toolCallId),
        eq(aiMessages.role, "tool"),
        eq(aiMessages.status, "pending"),
      ),
    )
    .returning({ id: aiMessages.id });
  return rows.length > 0;
}

export async function setToolMessageResult(
  conversationId: string,
  toolCallId: string,
  status: "ok" | "error",
  content: string,
): Promise<void> {
  await getDb()
    .update(aiMessages)
    .set({ status, content })
    .where(
      and(
        eq(aiMessages.conversationId, conversationId),
        eq(aiMessages.toolCallId, toolCallId),
        eq(aiMessages.role, "tool"),
      ),
    );
}

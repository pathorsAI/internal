import { and, asc, eq, gt, inArray, isNull, lt, ne, sql } from "drizzle-orm";
import { parsePgTimestamp } from "@/lib/pg-time";
import { getDb } from "./index";
import {
  chatBuffer,
  chatCards,
  chatIdentities,
  chatInboundEvents,
  chatLinkCodes,
  chatMessageRefs,
  documents,
  employees,
} from "./schema";

/**
 * LINE／WhatsApp bot 的資料存取（migrations/0042）。轉接層（src/lib/channels/*）與網頁設定頁
 * （/dashboard/settings/chat）都直接用這裡的函式，不自己寫 SQL。
 *
 * 安全相關的約定：
 * - 綁定碼只存 sha256(code)，原碼只在產生當下回給網頁顯示一次。
 * - 收件匣 document 掛上交易前一律檢查「同組織、還沒掛在任何交易或發票上」（assertInboxDocuments）。
 * - 「同一人同時只跑一題」靠 busy_until 這個欄位的條件 UPDATE 當鎖，沒有長連線、也不靠記憶體。
 */

export type ChatProvider = "line" | "whatsapp";

export const CHAT_PROVIDERS: readonly ChatProvider[] = ["line", "whatsapp"];

export function isChatProvider(v: unknown): v is ChatProvider {
  return v === "line" || v === "whatsapp";
}

// ---------------------------------------------------------------------------
// chat_identities：聊天平台帳號 ↔ internal 使用者
// ---------------------------------------------------------------------------

export type ChatIdentityRow = {
  id: string;
  provider: ChatProvider;
  /** 平台上的使用者 id（LINE userId、WhatsApp wa_id）。 */
  externalId: string;
  userId: string;
  /** bot 目前替這個人操作的組織；NULL = 還沒選或組織被刪了。 */
  activeOrgId: string | null;
  displayName: string | null;
  busyUntil: string | null;
  createdAt: string;
  lastSeenAt: string;
};

const IDENTITY_SELECT = {
  id: chatIdentities.id,
  provider: chatIdentities.provider,
  externalId: chatIdentities.externalId,
  userId: chatIdentities.userId,
  activeOrgId: chatIdentities.activeOrgId,
  displayName: chatIdentities.displayName,
  busyUntil: chatIdentities.busyUntil,
  createdAt: chatIdentities.createdAt,
  lastSeenAt: chatIdentities.lastSeenAt,
};

/** webhook 收到訊息時：這個平台帳號綁的是誰；沒綁回 null。 */
export async function findChatIdentity(
  provider: ChatProvider,
  externalId: string,
): Promise<ChatIdentityRow | null> {
  const [row] = await getDb()
    .select(IDENTITY_SELECT)
    .from(chatIdentities)
    .where(and(eq(chatIdentities.provider, provider), eq(chatIdentities.externalId, externalId)))
    .limit(1);
  return (row as ChatIdentityRow | undefined) ?? null;
}

/** 用 identity id 找（確認卡、flush 排程只帶 id）。 */
export async function getChatIdentity(id: string): Promise<ChatIdentityRow | null> {
  const [row] = await getDb()
    .select(IDENTITY_SELECT)
    .from(chatIdentities)
    .where(eq(chatIdentities.id, id))
    .limit(1);
  return (row as ChatIdentityRow | undefined) ?? null;
}

/** 設定頁：這個人在各平台綁了什麼（最多每個平台一筆）。 */
export async function listChatIdentitiesForUser(userId: string): Promise<ChatIdentityRow[]> {
  const rows = await getDb()
    .select(IDENTITY_SELECT)
    .from(chatIdentities)
    .where(eq(chatIdentities.userId, userId))
    .orderBy(asc(chatIdentities.provider));
  return rows as ChatIdentityRow[];
}

/** 收到這個人的訊息：更新 last_seen_at，有拿到新的顯示名稱就一起更新。 */
export async function touchChatIdentity(id: string, displayName?: string | null): Promise<void> {
  await getDb()
    .update(chatIdentities)
    .set({
      lastSeenAt: sql`now()`,
      ...(displayName ? { displayName: displayName.slice(0, 120) } : {}),
    })
    .where(eq(chatIdentities.id, id));
}

/** 「切換組織」：改 bot 替這個人操作的組織。是不是那個組織的成員由呼叫端先查（getOrgRole）。 */
export async function setChatIdentityOrg(id: string, orgId: string | null): Promise<void> {
  await getDb().update(chatIdentities).set({ activeOrgId: orgId }).where(eq(chatIdentities.id, id));
}

/** 「解除綁定」（聊天裡）：刪掉這筆 identity，連帶刪掉它的卡片、暫存與訊息對照（FK cascade）。 */
export async function deleteChatIdentity(id: string): Promise<boolean> {
  const rows = await getDb()
    .delete(chatIdentities)
    .where(eq(chatIdentities.id, id))
    .returning({ id: chatIdentities.id });
  return rows.length > 0;
}

/** 設定頁的「解除」：只刪得到本人在這個平台的綁定。 */
export async function unlinkChatIdentityForUser(userId: string, provider: ChatProvider): Promise<boolean> {
  const rows = await getDb()
    .delete(chatIdentities)
    .where(and(eq(chatIdentities.userId, userId), eq(chatIdentities.provider, provider)))
    .returning({ id: chatIdentities.id });
  return rows.length > 0;
}

/** 一題最長跑多久就當作卡死，讓下一題可以搶鎖（秒）。 */
export const CHAT_BUSY_TTL_SECONDS = 180;

/**
 * 搶「這個人正在跑一題」的鎖。搶到回 true；別的 flush 正在跑（busy_until 還沒過）回 false。
 * 用一句條件 UPDATE … RETURNING，兩個請求同時搶只會有一個成功。程式中途掛掉時，
 * busy_until 過了 ttl 秒就自動失效。
 */
export async function tryAcquireChatBusy(
  identityId: string,
  ttlSeconds = CHAT_BUSY_TTL_SECONDS,
): Promise<boolean> {
  const rows = await getDb()
    .update(chatIdentities)
    .set({ busyUntil: sql`now() + make_interval(secs => ${ttlSeconds})` })
    .where(
      and(
        eq(chatIdentities.id, identityId),
        sql`(${chatIdentities.busyUntil} IS NULL OR ${chatIdentities.busyUntil} < now())`,
      ),
    )
    .returning({ id: chatIdentities.id });
  return rows.length > 0;
}

/** 跑完放鎖。 */
export async function releaseChatBusy(identityId: string): Promise<void> {
  await getDb().update(chatIdentities).set({ busyUntil: null }).where(eq(chatIdentities.id, identityId));
}

// ---------------------------------------------------------------------------
// chat_link_codes：網頁產生的 6 位數綁定碼
// ---------------------------------------------------------------------------

/** 綁定碼有效時間（分鐘）。 */
export const LINK_CODE_TTL_MINUTES = 10;

/** 產生一組 6 位數綁定碼（000000–999999，均勻分布，用 crypto 亂數）。 */
export function generateLinkCode(): string {
  // 拒絕取樣：2^32 不是 10^6 的倍數，丟掉尾巴那段避免偏差。
  const limit = Math.floor(0x1_0000_0000 / 1_000_000) * 1_000_000;
  const buf = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0] < limit) return String(buf[0] % 1_000_000).padStart(6, "0");
  }
}

/** sha256(code) 的十六進位字串。只存這個，不存原碼。 */
export async function hashLinkCode(code: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(code));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * 網頁「產生綁定碼」：作廢這個人在這個平台還沒用掉的舊碼，再建一組新的。
 * 回傳原碼（只顯示這一次）與到期時間。orgId 是產生時所在的組織，綁定後當 active_org_id。
 */
export async function createChatLinkCode(input: {
  userId: string;
  orgId: string;
  provider: ChatProvider;
}): Promise<{ code: string; expiresAt: string }> {
  const db = getDb();
  await db
    .delete(chatLinkCodes)
    .where(
      and(
        eq(chatLinkCodes.userId, input.userId),
        eq(chatLinkCodes.provider, input.provider),
        isNull(chatLinkCodes.usedAt),
      ),
    );
  const expiresAt = new Date(Date.now() + LINK_CODE_TTL_MINUTES * 60_000).toISOString();
  // 6 位數只有一百萬組，同時有效的碼撞到的機率很低，但撞到 PK 就換一組重試。
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateLinkCode();
    const rows = await db
      .insert(chatLinkCodes)
      .values({
        codeHash: await hashLinkCode(code),
        userId: input.userId,
        orgId: input.orgId,
        provider: input.provider,
        expiresAt,
      })
      .onConflictDoNothing()
      .returning({ codeHash: chatLinkCodes.codeHash });
    if (rows.length > 0) return { code, expiresAt };
  }
  throw new Error("Could not allocate a link code; try again.");
}

/**
 * 兌換綁定碼前的判斷（純函式，方便測）：
 * - already = 這組碼已經用過，而且就是這個聊天帳號綁給同一個人用掉的（重傳同一句），當成功。
 * - used／expired／taken = 失敗原因；redeem = 可以兌換。
 */
export function checkLinkCode(
  found: { userId: string; usedAt: string | null; expiresAt: string },
  existing: Pick<ChatIdentityRow, "userId"> | null,
  now = Date.now(),
): "redeem" | "already" | "used" | "expired" | "taken" {
  if (found.usedAt) return existing?.userId === found.userId ? "already" : "used";
  if (parsePgTimestamp(found.expiresAt) <= now) return "expired";
  if (existing && existing.userId !== found.userId) return "taken";
  return "redeem";
}

export type RedeemLinkCodeResult =
  | { ok: true; identity: ChatIdentityRow; orgId: string }
  /**
   * invalid = 沒有這組碼（或平台不對）；expired = 過期；used = 已經用過；
   * taken = 這個聊天帳號已經綁給別人了（要先在那邊解除）。
   */
  | { ok: false; reason: "invalid" | "expired" | "used" | "taken" };

/**
 * 聊天裡收到「綁定 123456」：驗碼、標成已用、建立（或更新）綁定。
 * - 同一個人換了一個新的 LINE 帳號綁：舊的那筆會被換掉（每個平台每人一筆）。
 * - 這個聊天帳號已經綁給別人：回 taken，碼不會被用掉。
 * 綁定成功後 active_org_id = 產生碼時所在的組織。
 */
export async function redeemChatLinkCode(input: {
  provider: ChatProvider;
  code: string;
  externalId: string;
  displayName?: string | null;
}): Promise<RedeemLinkCodeResult> {
  const db = getDb();
  const codeHash = await hashLinkCode(input.code.trim());
  const [found] = await db
    .select({
      userId: chatLinkCodes.userId,
      orgId: chatLinkCodes.orgId,
      provider: chatLinkCodes.provider,
      expiresAt: chatLinkCodes.expiresAt,
      usedAt: chatLinkCodes.usedAt,
    })
    .from(chatLinkCodes)
    .where(eq(chatLinkCodes.codeHash, codeHash))
    .limit(1);
  if (!found || found.provider !== input.provider) return { ok: false, reason: "invalid" };

  const existing = await findChatIdentity(input.provider, input.externalId);
  const check = checkLinkCode(found, existing);
  if (check === "already") {
    // 同一個人把同一句「綁定 123456」又傳了一次（點了兩次連結、佇列重送）：已經綁好了，照樣回成功，
    // 不動目前選的組織。
    return { ok: true, identity: existing!, orgId: existing!.activeOrgId ?? found.orgId };
  }
  if (check !== "redeem") return { ok: false, reason: check };

  // 用掉這組碼（條件 UPDATE：兩個請求同時兌換只有一個成功）。
  const consumed = await db
    .update(chatLinkCodes)
    .set({ usedAt: sql`now()` })
    .where(
      and(
        eq(chatLinkCodes.codeHash, codeHash),
        isNull(chatLinkCodes.usedAt),
        gt(chatLinkCodes.expiresAt, sql`now()`),
      ),
    )
    .returning({ codeHash: chatLinkCodes.codeHash });
  if (consumed.length === 0) return { ok: false, reason: "used" };

  // 這個人在這個平台原本綁的是別的帳號：換掉。
  await db
    .delete(chatIdentities)
    .where(
      and(
        eq(chatIdentities.provider, input.provider),
        eq(chatIdentities.userId, found.userId),
        ne(chatIdentities.externalId, input.externalId),
      ),
    );

  const displayName = input.displayName ? input.displayName.slice(0, 120) : null;
  const [row] = await db
    .insert(chatIdentities)
    .values({
      id: crypto.randomUUID(),
      provider: input.provider,
      externalId: input.externalId,
      userId: found.userId,
      activeOrgId: found.orgId,
      displayName,
    })
    .onConflictDoUpdate({
      target: [chatIdentities.provider, chatIdentities.externalId],
      set: {
        activeOrgId: found.orgId,
        lastSeenAt: sql`now()`,
        ...(displayName ? { displayName } : {}),
      },
    })
    .returning(IDENTITY_SELECT);
  return { ok: true, identity: row as ChatIdentityRow, orgId: found.orgId };
}

// ---------------------------------------------------------------------------
// chat_inbound_events：webhook 去重
// ---------------------------------------------------------------------------

/**
 * 記下一個 webhook 事件。第一次看到回 true（要處理）；平台重送、已經處理過的回 false。
 */
export async function recordInboundEvent(provider: ChatProvider, eventId: string): Promise<boolean> {
  const rows = await getDb()
    .insert(chatInboundEvents)
    .values({ provider, eventId })
    .onConflictDoNothing()
    .returning({ eventId: chatInboundEvents.eventId });
  return rows.length > 0;
}

/** 送進佇列失敗時撤回去重紀錄，讓平台重送時能再處理一次。 */
export async function forgetInboundEvents(provider: ChatProvider, eventIds: string[]): Promise<void> {
  if (eventIds.length === 0) return;
  await getDb()
    .delete(chatInboundEvents)
    .where(and(eq(chatInboundEvents.provider, provider), inArray(chatInboundEvents.eventId, eventIds)));
}

/** 每日 cron：刪掉 days 天前的去重紀錄（預設 7 天）。回傳刪了幾筆。 */
export async function purgeInboundEvents(days = 7): Promise<number> {
  const rows = await getDb()
    .delete(chatInboundEvents)
    .where(lt(chatInboundEvents.receivedAt, sql`now() - make_interval(days => ${days})`))
    .returning({ eventId: chatInboundEvents.eventId });
  return rows.length;
}

// ---------------------------------------------------------------------------
// chat_cards：送到聊天裡的確認卡
// ---------------------------------------------------------------------------

export type ChatCardStatus = "open" | "done" | "expired";

export type ChatCardRow = {
  id: string;
  identityId: string;
  conversationId: string;
  /** 對回 ai_messages 的 pending 工具結果（tool_call_id）。 */
  toolCallIds: string[];
  status: ChatCardStatus;
  createdAt: string;
  expiresAt: string;
};

/** 確認卡多久過期（小時）。 */
export const CHAT_CARD_TTL_HOURS = 24;

const CARD_ID_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

/** 10 字元 base36 隨機 id（按鈕 payload `c:<id>:<action>` 要短；LINE postback data 上限 300 字）。 */
export function newCardId(): string {
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  // 256 % 36 ≠ 0 有一點點偏差；卡片 id 只要難猜、不撞，不需要完全均勻。
  return [...bytes].map((b) => CARD_ID_ALPHABET[b % 36]).join("");
}

const CARD_SELECT = {
  id: chatCards.id,
  identityId: chatCards.identityId,
  conversationId: chatCards.conversationId,
  toolCallIds: chatCards.toolCallIds,
  status: chatCards.status,
  createdAt: chatCards.createdAt,
  expiresAt: chatCards.expiresAt,
};

/** 送出一張確認卡前先建這一列；按鈕 payload 只帶回傳的 id。 */
export async function createChatCard(input: {
  identityId: string;
  conversationId: string;
  toolCallIds: string[];
  ttlHours?: number;
}): Promise<ChatCardRow> {
  const expiresAt = new Date(Date.now() + (input.ttlHours ?? CHAT_CARD_TTL_HOURS) * 3_600_000).toISOString();
  const [row] = await getDb()
    .insert(chatCards)
    .values({
      id: newCardId(),
      identityId: input.identityId,
      conversationId: input.conversationId,
      toolCallIds: input.toolCallIds,
      expiresAt,
    })
    .returning(CARD_SELECT);
  return row as ChatCardRow;
}

export async function getChatCard(id: string): Promise<ChatCardRow | null> {
  const [row] = await getDb().select(CARD_SELECT).from(chatCards).where(eq(chatCards.id, id)).limit(1);
  return (row as ChatCardRow | undefined) ?? null;
}

/** 這張卡現在能不能按：open 且還沒過期。 */
export function isCardActionable(card: Pick<ChatCardRow, "status" | "expiresAt">, now = new Date()): boolean {
  return card.status === "open" && parsePgTimestamp(card.expiresAt) > now.getTime();
}

/**
 * 收掉一張卡（按完、取消、或發現已過期）。只改 status = 'open' 的列，回傳是否改到 ——
 * 同一張卡被按兩次時第二次改不到，呼叫端據此不再執行第二次。
 */
export async function closeChatCard(id: string, status: "done" | "expired" = "done"): Promise<boolean> {
  const rows = await getDb()
    .update(chatCards)
    .set({ status })
    .where(and(eq(chatCards.id, id), eq(chatCards.status, "open")))
    .returning({ id: chatCards.id });
  return rows.length > 0;
}

/** 問新的一題前：這段對話還開著的卡一律收掉（舊卡在引擎裡已被當成取消）。回傳收掉的卡 id。 */
export async function closeOpenCardsForConversation(
  conversationId: string,
  status: "done" | "expired" = "done",
): Promise<string[]> {
  const rows = await getDb()
    .update(chatCards)
    .set({ status })
    .where(and(eq(chatCards.conversationId, conversationId), eq(chatCards.status, "open")))
    .returning({ id: chatCards.id });
  return rows.map((r) => r.id);
}

/** 這個人還開著（未過期）的卡，新的在前。 */
export async function listOpenChatCards(identityId: string): Promise<ChatCardRow[]> {
  const rows = await getDb()
    .select(CARD_SELECT)
    .from(chatCards)
    .where(
      and(
        eq(chatCards.identityId, identityId),
        eq(chatCards.status, "open"),
        gt(chatCards.expiresAt, sql`now()`),
      ),
    )
    .orderBy(sql`${chatCards.createdAt} DESC`);
  return rows as ChatCardRow[];
}

/** 每日 cron：過期但還是 open 的卡標成 expired。回傳改了幾張。 */
export async function expireChatCards(): Promise<number> {
  const rows = await getDb()
    .update(chatCards)
    .set({ status: "expired" })
    .where(and(eq(chatCards.status, "open"), lt(chatCards.expiresAt, sql`now()`)))
    .returning({ id: chatCards.id });
  return rows.length;
}

// ---------------------------------------------------------------------------
// chat_buffer：幾則訊息安靜幾秒後才合成一題
// ---------------------------------------------------------------------------

export type ChatBufferKind = "text" | "media" | "button";

export type ChatBufferRow = {
  id: number;
  identityId: string;
  provider: ChatProvider;
  externalMessageId: string | null;
  kind: ChatBufferKind;
  text: string | null;
  /** media：收件匣 document 的 id。 */
  documentId: number | null;
  /** 這則訊息引用（回覆）的平台訊息 id（LINE quotedMessageId、WhatsApp context.id）。 */
  quotedExternalId: string | null;
  receivedAt: string;
  consumedAt: string | null;
};

const BUFFER_SELECT = {
  id: chatBuffer.id,
  identityId: chatBuffer.identityId,
  provider: chatBuffer.provider,
  externalMessageId: chatBuffer.externalMessageId,
  kind: chatBuffer.kind,
  text: chatBuffer.text,
  documentId: chatBuffer.documentId,
  quotedExternalId: chatBuffer.quotedExternalId,
  receivedAt: chatBuffer.receivedAt,
  consumedAt: chatBuffer.consumedAt,
};

/**
 * 收到一則文字／檔案：先存進暫存區，回傳這一列（receivedAt 當這次 flush 的錨點）。
 * 按鈕（確認卡）不進暫存區，直接處理。
 */
export async function appendChatBuffer(input: {
  identityId: string;
  provider: ChatProvider;
  externalMessageId?: string | null;
  kind: ChatBufferKind;
  text?: string | null;
  documentId?: number | null;
  quotedExternalId?: string | null;
}): Promise<ChatBufferRow> {
  const [row] = await getDb()
    .insert(chatBuffer)
    .values({
      identityId: input.identityId,
      provider: input.provider,
      externalMessageId: input.externalMessageId ?? null,
      kind: input.kind,
      text: input.text ?? null,
      documentId: input.documentId ?? null,
      quotedExternalId: input.quotedExternalId ?? null,
    })
    .returning(BUFFER_SELECT);
  return row as ChatBufferRow;
}

/**
 * 暫存區裡這個人最新一則還沒用掉的訊息時間（沒有回 null）。flush 開始時拿來跟錨點比：
 * 比錨點晚就代表之後又有新訊息，這次 flush 直接結束，交給較晚的那次。
 */
export async function latestPendingBufferAt(identityId: string): Promise<string | null> {
  const [row] = await getDb()
    .select({ at: sql<string | null>`max(${chatBuffer.receivedAt})` })
    .from(chatBuffer)
    .where(and(eq(chatBuffer.identityId, identityId), isNull(chatBuffer.consumedAt)));
  return row?.at ?? null;
}

/** 還沒用掉的訊息（舊到新），不改狀態。 */
export async function peekChatBuffer(identityId: string): Promise<ChatBufferRow[]> {
  const rows = await getDb()
    .select(BUFFER_SELECT)
    .from(chatBuffer)
    .where(and(eq(chatBuffer.identityId, identityId), isNull(chatBuffer.consumedAt)))
    .orderBy(asc(chatBuffer.receivedAt), asc(chatBuffer.id));
  return rows as ChatBufferRow[];
}

/**
 * 取出這個人所有還沒用掉的訊息並標成 consumed（一句 UPDATE … RETURNING，兩個 flush 同時取
 * 也不會重複拿到同一則）。回傳舊到新。拿去 mergeChatBuffer 合成一題。
 */
export async function takeChatBuffer(identityId: string): Promise<ChatBufferRow[]> {
  const rows = (await getDb()
    .update(chatBuffer)
    .set({ consumedAt: sql`now()` })
    .where(and(eq(chatBuffer.identityId, identityId), isNull(chatBuffer.consumedAt)))
    .returning(BUFFER_SELECT)) as ChatBufferRow[];
  return rows.sort((a, b) => parsePgTimestamp(a.receivedAt) - parsePgTimestamp(b.receivedAt) || a.id - b.id);
}

/** 只把指定的幾列標成 consumed（先 peek、處理成功才標的寫法用）。 */
export async function markChatBufferConsumed(ids: readonly number[]): Promise<void> {
  if (ids.length === 0) return;
  await getDb()
    .update(chatBuffer)
    .set({ consumedAt: sql`now()` })
    .where(and(inArray(chatBuffer.id, [...ids]), isNull(chatBuffer.consumedAt)));
}

export type MergedChatBuffer = {
  /** 文字依序換行串起來（沒有文字就是空字串）。 */
  text: string;
  /** 所有 media 的 document id（依時間、去重）。 */
  documentIds: number[];
  /** 被引用的平台訊息 id（依時間、去重）；呼叫端用 getChatMessageRef 查出內容放在最前面。 */
  quotedExternalIds: string[];
  /** 這一題包含的平台訊息 id（記 chat_message_refs 用）。 */
  externalMessageIds: string[];
  /** 最後一則的時間（reply token 還能不能用、flush 錨點）。 */
  lastReceivedAt: string | null;
  /** 最後一則是不是檔案（決定等 10 秒還是 4 秒）。 */
  lastKind: ChatBufferKind | null;
};

/** 把暫存區的幾則訊息合成一題（純函式）。按鈕列會被略過（它們不該在暫存區）。 */
export function mergeChatBuffer(rows: readonly ChatBufferRow[]): MergedChatBuffer {
  const texts: string[] = [];
  const documentIds: number[] = [];
  const quoted: string[] = [];
  const external: string[] = [];
  for (const r of rows) {
    if (r.externalMessageId && !external.includes(r.externalMessageId)) external.push(r.externalMessageId);
    if (r.quotedExternalId && !quoted.includes(r.quotedExternalId)) quoted.push(r.quotedExternalId);
    if (r.kind === "text" && r.text?.trim()) texts.push(r.text.trim());
    if (r.kind === "media") {
      if (r.documentId !== null && !documentIds.includes(r.documentId)) documentIds.push(r.documentId);
      if (r.text?.trim()) texts.push(r.text.trim()); // 照片的說明文字（WhatsApp caption）
    }
  }
  const last = rows.at(-1) ?? null;
  return {
    text: texts.join("\n"),
    documentIds,
    quotedExternalIds: quoted,
    externalMessageIds: external,
    lastReceivedAt: last?.receivedAt ?? null,
    lastKind: last?.kind ?? null,
  };
}

/** 每日 cron：刪掉 days 天前已經用掉的暫存訊息（預設 7 天）。 */
export async function purgeChatBuffer(days = 7): Promise<number> {
  const rows = await getDb()
    .delete(chatBuffer)
    .where(lt(chatBuffer.receivedAt, sql`now() - make_interval(days => ${days})`))
    .returning({ id: chatBuffer.id });
  return rows.length;
}

// ---------------------------------------------------------------------------
// chat_message_refs：平台訊息 id ↔ 我們的資料（解析「回覆某一則」）
// ---------------------------------------------------------------------------

export type ChatMessageRefRow = {
  provider: ChatProvider;
  externalMessageId: string;
  identityId: string;
  conversationId: string | null;
  direction: "in" | "out";
  aiMessageId: number | null;
  documentId: number | null;
  cardId: string | null;
  /** 訊息前 200 字。 */
  snippet: string | null;
  createdAt: string;
};

/** 一則訊息的摘要長度。 */
export const SNIPPET_CHARS = 200;

/**
 * 記一筆訊息對照：進來的每則（in）與送出的每則（out，LINE sentMessages[].id、WhatsApp messages[0].id）。
 * 同一個平台訊息 id 只記第一次（平台重送時不覆寫）。
 */
export async function recordChatMessageRef(input: {
  provider: ChatProvider;
  externalMessageId: string;
  identityId: string;
  conversationId?: string | null;
  direction: "in" | "out";
  aiMessageId?: number | null;
  documentId?: number | null;
  cardId?: string | null;
  snippet?: string | null;
}): Promise<void> {
  await getDb()
    .insert(chatMessageRefs)
    .values({
      provider: input.provider,
      externalMessageId: input.externalMessageId,
      identityId: input.identityId,
      conversationId: input.conversationId ?? null,
      direction: input.direction,
      aiMessageId: input.aiMessageId ?? null,
      documentId: input.documentId ?? null,
      cardId: input.cardId ?? null,
      snippet: input.snippet ? input.snippet.slice(0, SNIPPET_CHARS) : null,
    })
    .onConflictDoNothing();
}

/** 引用解析：這則平台訊息對到什麼。只回同一個 identity 的（不讓人引用別人的訊息拿到內容）。 */
export async function getChatMessageRef(
  provider: ChatProvider,
  externalMessageId: string,
  identityId: string,
): Promise<ChatMessageRefRow | null> {
  const [row] = await getDb()
    .select()
    .from(chatMessageRefs)
    .where(
      and(
        eq(chatMessageRefs.provider, provider),
        eq(chatMessageRefs.externalMessageId, externalMessageId),
        eq(chatMessageRefs.identityId, identityId),
      ),
    )
    .limit(1);
  return (row as ChatMessageRefRow | undefined) ?? null;
}

/** 每日 cron：刪掉 days 天前的訊息對照（預設 90 天）。 */
export async function purgeChatMessageRefs(days = 90): Promise<number> {
  const rows = await getDb()
    .delete(chatMessageRefs)
    .where(lt(chatMessageRefs.createdAt, sql`now() - make_interval(days => ${days})`))
    .returning({ id: chatMessageRefs.externalMessageId });
  return rows.length;
}

// ---------------------------------------------------------------------------
// 收件匣 documents：聊天收到、還沒掛上交易的檔案
// ---------------------------------------------------------------------------

/** 交易附件的種類（與網頁新增交易的「類型」下拉相同）。 */
export type DocKind = "e_invoice" | "paper_invoice" | "receipt" | "other";

export const DOC_KINDS: readonly DocKind[] = ["e_invoice", "paper_invoice", "receipt", "other"];

/** docKind → (doc_type, invoice_kind)。跟 src/db/mutations.ts 的 DOC_KIND_MAP 同一套對照。 */
export const DOC_KIND_MAP: Record<DocKind, { docType: string; invoiceKind: string | null }> = {
  e_invoice: { docType: "invoice", invoiceKind: "electronic" },
  paper_invoice: { docType: "invoice", invoiceKind: "paper" },
  receipt: { docType: "receipt", invoiceKind: null },
  other: { docType: "other", invoiceKind: null },
};

export type DocumentSource = "web" | "line" | "whatsapp" | "mcp";

export type InboxDocumentRow = {
  id: number;
  organizationId: string | null;
  r2Key: string;
  fileName: string | null;
  contentType: string | null;
  sizeBytes: number | null;
  uploadedBy: string | null;
  source: string | null;
  uploadedAt: string;
};

const INBOX_SELECT = {
  id: documents.id,
  organizationId: documents.organizationId,
  r2Key: documents.r2Key,
  fileName: documents.fileName,
  contentType: documents.contentType,
  sizeBytes: documents.sizeBytes,
  uploadedBy: documents.uploadedBy,
  source: documents.source,
  uploadedAt: documents.uploadedAt,
};

/**
 * 檔案已經存進 STORAGE（key 由呼叫端決定，例如 chat/<orgId>/<uuid>-<name>）之後，建一列
 * 還沒掛在任何交易或發票上的 document（收件匣）。doc_type 先記 other，掛上交易時再依 docKind 改。
 */
export async function createInboxDocument(input: {
  orgId: string;
  r2Key: string;
  fileName: string | null;
  contentType: string | null;
  sizeBytes: number | null;
  uploadedBy: string;
  source: DocumentSource;
}): Promise<InboxDocumentRow> {
  const [row] = await getDb()
    .insert(documents)
    .values({
      organizationId: input.orgId,
      docType: "other",
      r2Key: input.r2Key,
      fileName: input.fileName,
      contentType: input.contentType,
      sizeBytes: input.sizeBytes,
      uploadedBy: input.uploadedBy,
      source: input.source,
    })
    .returning(INBOX_SELECT);
  return row as InboxDocumentRow;
}

/** 用 id 拿 document（只回這個組織、未刪除的；不限是否已掛上）。 */
export async function getOrgDocuments(orgId: string, ids: readonly number[]): Promise<
  (InboxDocumentRow & { transactionId: number | null; invoiceId: number | null })[]
> {
  if (ids.length === 0) return [];
  const rows = await getDb()
    .select({ ...INBOX_SELECT, transactionId: documents.transactionId, invoiceId: documents.invoiceId })
    .from(documents)
    .where(
      and(eq(documents.organizationId, orgId), inArray(documents.id, [...ids]), isNull(documents.deletedAt)),
    );
  return rows as (InboxDocumentRow & { transactionId: number | null; invoiceId: number | null })[];
}

/** 工具參數 documentIds → 去重後的正整數陣列；格式不對就丟錯（給模型看的英文訊息）。 */
export function parseDocumentIds(v: unknown): number[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw new Error('"documentIds" must be an array of document ids.');
  const ids: number[] = [];
  for (const x of v) {
    const n = typeof x === "string" && x.trim() !== "" ? Number(x) : x;
    if (typeof n !== "number" || !Number.isInteger(n) || n <= 0) {
      throw new Error('"documentIds" must contain positive integer document ids.');
    }
    if (!ids.includes(n)) ids.push(n);
  }
  if (ids.length > 20) throw new Error('"documentIds" can attach at most 20 files at once.');
  return ids;
}

/** 工具參數 docKind → DocKind（沒給回 undefined）。 */
export function parseDocKind(v: unknown): DocKind | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  if (typeof v !== "string" || !(DOC_KINDS as readonly string[]).includes(v)) {
    throw new Error(`"docKind" must be one of: ${DOC_KINDS.join(", ")}.`);
  }
  return v as DocKind;
}

/**
 * 掛附件前的檢查：每一個 id 都要是這個組織、未刪除、而且還沒掛在任何交易或發票上的 document。
 * 任何一個不合格就丟錯，訊息說是哪一個（交易還沒建，不會留下半套資料）。
 */
export async function assertInboxDocuments(orgId: string, ids: readonly number[]): Promise<void> {
  if (ids.length === 0) return;
  const rows = await getOrgDocuments(orgId, ids);
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const id of ids) {
    const r = byId.get(id);
    if (!r) throw new Error(`Document ${id} not found in your organization.`);
    if (r.transactionId !== null || r.invoiceId !== null) {
      throw new Error(`Document ${id} is already attached to a record.`);
    }
  }
}

/**
 * 把收件匣的檔案掛到交易上（同時依 docKind 設 doc_type / invoice_kind）。
 * 只改「同組織、還沒掛上」的列；改到的數量跟 ids 不一樣（被別的請求搶先掛走）就丟錯。
 * 呼叫前先 assertInboxDocuments，這裡是第二道防線。
 */
export async function attachInboxDocuments(
  orgId: string,
  ids: readonly number[],
  transactionId: number,
  docKind: DocKind = "other",
): Promise<number[]> {
  if (ids.length === 0) return [];
  const { docType, invoiceKind } = DOC_KIND_MAP[docKind];
  const rows = await getDb()
    .update(documents)
    .set({ transactionId, docType, invoiceKind })
    .where(
      and(
        eq(documents.organizationId, orgId),
        inArray(documents.id, [...ids]),
        isNull(documents.transactionId),
        isNull(documents.invoiceId),
        isNull(documents.deletedAt),
      ),
    )
    .returning({ id: documents.id });
  if (rows.length !== ids.length) {
    throw new Error("Some documents were attached elsewhere in the meantime; check the transaction's attachments.");
  }
  return rows.map((r) => r.id);
}

/** 每日 cron：超過 days 天（預設 30）還沒掛上的聊天檔案。呼叫端先刪 STORAGE 檔，再 deleteDocumentRows。 */
export async function listStaleInboxDocuments(days = 30, limit = 200): Promise<{ id: number; r2Key: string }[]> {
  return getDb()
    .select({ id: documents.id, r2Key: documents.r2Key })
    .from(documents)
    .where(
      and(
        isNull(documents.transactionId),
        isNull(documents.invoiceId),
        inArray(documents.source, ["line", "whatsapp"]),
        lt(documents.uploadedAt, sql`now() - make_interval(days => ${days})`),
      ),
    )
    .limit(limit);
}

/** 硬刪 document 列（cron 清收件匣用；只刪還沒掛上的，避免誤刪交易附件）。 */
export async function deleteInboxDocumentRows(ids: readonly number[]): Promise<number> {
  if (ids.length === 0) return 0;
  const rows = await getDb()
    .delete(documents)
    .where(and(inArray(documents.id, [...ids]), isNull(documents.transactionId), isNull(documents.invoiceId)))
    .returning({ id: documents.id });
  return rows.length;
}

// ---------------------------------------------------------------------------
// 員工連結（submit_advance、prompt 的「員工資料：有／無」）
// ---------------------------------------------------------------------------

/** 這位使用者在這個組織連到的員工紀錄（employees.user_id）；沒有回 null。 */
export async function findLinkedEmployee(
  orgId: string,
  userId: string,
): Promise<{ id: number; name: string } | null> {
  const [row] = await getDb()
    .select({ id: employees.id, name: employees.name })
    .from(employees)
    .where(and(eq(employees.organizationId, orgId), eq(employees.userId, userId), isNull(employees.deletedAt)))
    .orderBy(sql`${employees.isActive} DESC`, asc(employees.id))
    .limit(1);
  return row ?? null;
}

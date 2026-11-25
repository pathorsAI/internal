/**
 * 聊天轉接層的主流程（平台無關，所有外部依賴都從 deps 注入，方便測試）。
 *
 * 一則 webhook 事件（handleEvent）：
 *   群組 → 回「請私訊我」並離開
 *   → 找綁定：沒綁定只處理「綁定 123456」，其他一律回綁定說明（不呼叫 AI、不下載檔案）
 *   → 按鈕（確認卡、組織選單）直接處理（要搶鎖）
 *   → 文字、檔案先進暫存區（chat_buffer），排一次 flush：最後一則是文字等 4 秒、是檔案等 10 秒
 *
 * 一次 flush（handleFlush）：
 *   暫存區在排程之後又有新訊息 → 交給較晚那次
 *   → 搶「這個人正在跑一題」的鎖，搶不到 5 秒後重排
 *   → 取出所有未用的訊息合成一題；整則就是指令（切換組織、新對話、解除綁定、說明、綁定）就當指令
 *   → 解析引用（被引用的文字放最前面、被引用的檔案帶進附件、被引用的確認卡當成修改）
 *   → runTurn → 最終文字（`[[選項：…]]` 拆成快速選項；LINE 另把表格、站內連結拆成 Flex）＋待確認的寫入變成確認卡
 *
 * 確認卡按下確認、寫入成功：先回收據卡（已記帳＋重點＋「在 internal 查看」），再送 AI 的文字。
 * 「說明」與綁定成功之後送說明卡組。
 *   → 放鎖；暫存區還有訊息就 2 秒後再 flush 一次
 */
import {
  mergeChatBuffer,
  type ChatBufferRow,
  type ChatCardRow,
  type ChatIdentityRow,
  type ChatMessageRefRow,
  type DocumentSource,
  type InboxDocumentRow,
  type MergedChatBuffer,
  type RedeemLinkCodeResult,
} from "@/db/chat";
import type { Locale } from "@/i18n/config";
import { MAX_USER_MESSAGE_CHARS } from "@/lib/ai/config";
import type { RunTurnParams, RunTurnResult } from "@/lib/ai/turn";
import type { AttachmentRef, ChatEvent, ToolDoneInfo, UiToolCall } from "@/lib/ai/types";
import { parsePgTimestamp } from "@/lib/pg-time";
import {
  batchCard,
  collectTurn,
  doneReceipt,
  helpMessage,
  replyToMessages,
  toConfirmCard,
  type TurnOutput,
} from "./render";
import { CHAT_MEDIA_MAX_BYTES, isAcceptedMime, normalizeMime, safeFileName } from "./media";
import { botStrings, parseBindCommand, parseCommand, type BotCommand, type BotStrings } from "./strings";
import {
  parseCardPayload,
  parseOrgPayload,
  type ChannelAdapter,
  type ChannelJob,
  type ChatProvider,
  type ConfirmCard,
  type DoneReceipt,
  type InboundEvent,
  type OutboundMessage,
} from "./types";

export { CHAT_MEDIA_MAX_BYTES, isAcceptedMime, normalizeMime } from "./media";

/** 安靜多久才合成一題（秒）。 */
export const FLUSH_DELAY_TEXT_S = 4;
export const FLUSH_DELAY_MEDIA_S = 10;
/** 搶不到鎖幾秒後重試、跑完後還有訊息幾秒後再 flush。 */
export const FLUSH_RETRY_S = 5;
export const FLUSH_FOLLOWUP_S = 2;
/** 搶不到鎖最多重排幾次（5 秒 × 40 ≈ 鎖的 TTL 180 秒再多一點）。 */
export const FLUSH_MAX_ATTEMPTS = 40;
/** 按確認卡時等鎖：每次等多久、最多等幾次。 */
export const BUTTON_LOCK_WAIT_MS = 2_000;
export const BUTTON_LOCK_TRIES = 8;

/** 「新對話」指令在暫存區留的記號：下一題強制開新對話。 */
export const NEW_CONVERSATION_MARK = "__new_conversation__";

/** runTurn 綁好依賴之後的樣子（沒設 OpenRouter 金鑰時是 null）。 */
export type TurnRunner = (p: Omit<RunTurnParams, "deps">) => Promise<RunTurnResult>;

export type DispatcherDeps = {
  adapter: (p: ChatProvider) => ChannelAdapter | null;
  db: {
    findChatIdentity: (p: ChatProvider, externalId: string) => Promise<ChatIdentityRow | null>;
    getChatIdentity: (id: string) => Promise<ChatIdentityRow | null>;
    touchChatIdentity: (id: string, displayName?: string | null) => Promise<void>;
    setChatIdentityOrg: (id: string, orgId: string | null) => Promise<void>;
    deleteChatIdentity: (id: string) => Promise<boolean>;
    redeemChatLinkCode: (input: {
      provider: ChatProvider;
      code: string;
      externalId: string;
      displayName?: string | null;
    }) => Promise<RedeemLinkCodeResult>;
    tryAcquireChatBusy: (identityId: string) => Promise<boolean>;
    releaseChatBusy: (identityId: string) => Promise<void>;
    appendChatBuffer: (input: {
      identityId: string;
      provider: ChatProvider;
      externalMessageId?: string | null;
      kind: ChatBufferRow["kind"];
      text?: string | null;
      documentId?: number | null;
      quotedExternalId?: string | null;
    }) => Promise<ChatBufferRow>;
    latestPendingBufferAt: (identityId: string) => Promise<string | null>;
    peekChatBuffer: (identityId: string) => Promise<ChatBufferRow[]>;
    markChatBufferConsumed: (ids: readonly number[]) => Promise<void>;
    createChatCard: (input: { identityId: string; conversationId: string; toolCallIds: string[] }) => Promise<ChatCardRow>;
    getChatCard: (id: string) => Promise<ChatCardRow | null>;
    closeChatCard: (id: string, status?: "done" | "expired") => Promise<boolean>;
    listOpenChatCards: (identityId: string) => Promise<ChatCardRow[]>;
    recordChatMessageRef: (input: {
      provider: ChatProvider;
      externalMessageId: string;
      identityId: string;
      conversationId?: string | null;
      direction: "in" | "out";
      documentId?: number | null;
      cardId?: string | null;
      snippet?: string | null;
    }) => Promise<void>;
    getChatMessageRef: (
      p: ChatProvider,
      externalMessageId: string,
      identityId: string,
    ) => Promise<ChatMessageRefRow | null>;
    createInboxDocument: (input: {
      orgId: string;
      r2Key: string;
      fileName: string | null;
      contentType: string | null;
      sizeBytes: number | null;
      uploadedBy: string;
      source: DocumentSource;
    }) => Promise<InboxDocumentRow>;
    getOrgDocuments: (orgId: string, ids: readonly number[]) => Promise<InboxDocumentRow[]>;
  };
  directory: {
    getOrgName: (orgId: string) => Promise<string | null>;
    getUserName: (userId: string) => Promise<string | null>;
    listUserOrgs: (userId: string) => Promise<{ id: string; name: string }[]>;
    /** 確認卡把分類 id 換成名稱（沒給就照原樣顯示 id）。 */
    getCategoryName?: (orgId: string, id: number) => Promise<string | null>;
  };
  getOrgRole: (orgId: string, userId: string) => Promise<string | null>;
  /**
   * 使用者目前的組織（"user".current_org_id，仍是成員才回）。沒給（測試）就只看
   * chat_identities.active_org_id。
   */
  currentOrgId?: (userId: string) => Promise<string | null>;
  /** 在聊天裡切換組織時一併改使用者目前的組織（網頁、MCP 跟著換）。 */
  setCurrentOrgId?: (userId: string, orgId: string) => Promise<unknown>;
  putObject: (key: string, body: Uint8Array, contentType: string) => Promise<void>;
  runTurn: TurnRunner | null;
  /** 排一個工作（flush）在 delaySeconds 秒後執行。 */
  schedule: (job: ChannelJob, delaySeconds: number) => Promise<void>;
  /** internal 的網址（綁定說明、站內連結）。 */
  baseUrl: string;
  /** 這個人的 bot 語系（目前沒有存使用者偏好，一律 zh-TW）。 */
  locale?: (identity: ChatIdentityRow | null) => Locale;
  /** 模型失敗的錯誤（ModelError）判斷；沒給就一律當內部錯誤。 */
  isModelError?: (err: unknown) => boolean;
  isTurnNotFound?: (err: unknown) => boolean;
  sleep?: (ms: number) => Promise<void>;
  newId?: () => string;
};

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------

function localeOf(deps: DispatcherDeps, identity: ChatIdentityRow | null): Locale {
  return deps.locale?.(identity) ?? "zh-TW";
}

function settingsUrl(deps: DispatcherDeps): string {
  return `${deps.baseUrl}/dashboard/settings/chat`;
}

function ts(s: string | null | undefined): number {
  return parsePgTimestamp(s);
}

/** 卡片還開著且沒過期（expiresAt 解析不了就當過期）。 */
function isLiveCard(card: ChatCardRow): boolean {
  return card.status === "open" && ts(card.expiresAt) > Date.now();
}

function isMark(r: ChatBufferRow): boolean {
  return r.kind === "button" && r.text === NEW_CONVERSATION_MARK;
}

function extFor(mime: string): string {
  if (mime === "application/pdf") return "pdf";
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  if (mime === "image/heic") return "heic";
  if (mime === "image/gif") return "gif";
  return "jpg";
}


/** 送訊息的小幫手：記著 reply token（只能用一次），送出的每一則都記進 chat_message_refs。 */
class Replier {
  private replyToken?: string;
  private readonly replyTokenAt?: number;

  constructor(
    private readonly deps: DispatcherDeps,
    private readonly adapter: ChannelAdapter,
    private readonly to: string,
    private readonly locale: Locale,
    private readonly identityId: string | null,
    reply?: { token?: string; at?: number },
  ) {
    this.replyToken = reply?.token;
    this.replyTokenAt = reply?.at;
  }

  async send(msgs: OutboundMessage[], conversationId?: string | null, record = true): Promise<void> {
    if (msgs.length === 0) return;
    const sent = await this.adapter.send(this.to, msgs, {
      ...(this.replyToken ? { replyToken: this.replyToken, replyTokenAt: this.replyTokenAt } : {}),
      locale: this.locale,
    });
    this.replyToken = undefined;
    if (!record || !this.identityId) return;
    for (const m of sent) {
      try {
        await this.deps.db.recordChatMessageRef({
          provider: this.adapter.provider,
          externalMessageId: m.externalId,
          identityId: this.identityId,
          conversationId: conversationId ?? null,
          direction: "out",
          cardId: m.cardId ?? null,
          snippet: m.snippet,
        });
      } catch (err) {
        console.error("[channels] recordChatMessageRef(out) failed", err);
      }
    }
  }

  text(text: string, conversationId?: string | null): Promise<void> {
    return this.send([{ type: "text", text }], conversationId);
  }

  /** 這個平台畫得出表格、連結按鈕（LINE Flex）。 */
  get rich(): boolean {
    return this.adapter.richReplies === true;
  }
}

// ---------------------------------------------------------------------------
// 進入點
// ---------------------------------------------------------------------------

/** 佇列（或 waitUntil）裡的一個工作。 */
export async function processJob(job: ChannelJob, deps: DispatcherDeps): Promise<void> {
  if (job.kind === "event") await handleEvent(job.event, deps);
  else await handleFlush(job, deps);
}

/** 一則 webhook 事件（已驗簽、已去重）。 */
export async function handleEvent(event: InboundEvent, deps: DispatcherDeps): Promise<void> {
  const adapter = deps.adapter(event.provider);
  if (!adapter) return;

  if (event.isGroup) {
    await handleGroup(event, adapter, deps);
    return;
  }

  const identity = await deps.db.findChatIdentity(event.provider, event.externalUserId);
  const locale = localeOf(deps, identity);
  const s = botStrings(locale);
  const replier = new Replier(deps, adapter, event.externalUserId, locale, identity?.id ?? null, {
    token: event.replyToken,
    at: event.receivedAt,
  });

  if (!identity) {
    await handleUnlinked(event, adapter, replier, s, deps);
    return;
  }

  await deps.db.touchChatIdentity(identity.id, event.displayName ?? null);

  switch (event.kind) {
    case "follow": {
      const org = identity.activeOrgId ? await deps.directory.getOrgName(identity.activeOrgId) : null;
      const user = (await deps.directory.getUserName(identity.userId)) ?? identity.displayName ?? "";
      // 第一次聯絡就附圖解說明，不然不知道要從哪裡開始。
      await replier.send(
        [
          { type: "text", text: org ? s.welcomeBack(user, org) : s.noActiveOrg },
          helpMessage(s, deps.baseUrl, settingsUrl(deps)),
        ],
        null,
        false,
      );
      return;
    }
    case "unsupported":
      await recordIn(deps, event, identity, null);
      await replier.text(s.unsupported);
      return;
    case "button":
      await handleButton(event.payload, identity, adapter, replier, s, deps);
      return;
    case "text": {
      await recordIn(deps, event, identity, null);
      // 整則就是指令（說明、切換組織、新對話、解除綁定…）：馬上處理，不進暫存區等合併。
      // 回覆用這則事件自己的 reply token，不算推播則數。暫存區裡先前的訊息照原本的 flush 處理。
      const command = event.quotedMessageId ? null : parseCommand(event.text);
      if (command) {
        await runCommand(command, identity, adapter, replier, s, deps);
        return;
      }
      const row = await deps.db.appendChatBuffer({
        identityId: identity.id,
        provider: event.provider,
        externalMessageId: event.messageId ?? null,
        kind: "text",
        text: event.text,
        quotedExternalId: event.quotedMessageId ?? null,
      });
      await adapter.showTyping(event.externalUserId, { messageId: event.messageId });
      await scheduleFlush(deps, identity, row.receivedAt, FLUSH_DELAY_TEXT_S, event);
      return;
    }
    case "media":
      await handleMedia(event, identity, adapter, replier, s, deps);
      return;
  }
}

async function recordIn(
  deps: DispatcherDeps,
  event: InboundEvent,
  identity: ChatIdentityRow,
  documentId: number | null,
): Promise<void> {
  if (!event.messageId) return;
  let snippet: string | null = null;
  if (event.kind === "text") snippet = event.text;
  else if (event.kind === "media") snippet = event.caption ?? event.media.fileName ?? null;
  try {
    await deps.db.recordChatMessageRef({
      provider: event.provider,
      externalMessageId: event.messageId,
      identityId: identity.id,
      direction: "in",
      documentId,
      snippet,
    });
  } catch (err) {
    console.error("[channels] recordChatMessageRef(in) failed", err);
  }
}

function scheduleFlush(
  deps: DispatcherDeps,
  identity: ChatIdentityRow,
  anchor: string,
  delaySeconds: number,
  event?: InboundEvent,
  attempt = 0,
): Promise<void> {
  return deps.schedule(
    {
      kind: "flush",
      provider: identity.provider,
      identityId: identity.id,
      anchor,
      ...(event?.replyToken ? { replyToken: event.replyToken, replyTokenAt: event.receivedAt } : {}),
      ...(attempt > 0 ? { attempt } : {}),
    },
    delaySeconds,
  );
}

async function handleGroup(event: InboundEvent, adapter: ChannelAdapter, deps: DispatcherDeps): Promise<void> {
  const s = botStrings(localeOf(deps, null));
  const to = event.group?.id ?? event.externalUserId;
  if (event.replyToken || event.group) {
    try {
      await adapter.send(to, [{ type: "text", text: s.groupNotSupported }], {
        replyToken: event.replyToken,
        replyTokenAt: event.receivedAt,
      });
    } catch (err) {
      console.error("[channels] group reply failed", err);
    }
  }
  if (event.group && adapter.leaveGroup) {
    try {
      await adapter.leaveGroup(event.group);
    } catch (err) {
      console.error("[channels] leave group failed", err);
    }
  }
}

async function handleUnlinked(
  event: InboundEvent,
  adapter: ChannelAdapter,
  replier: Replier,
  s: BotStrings,
  deps: DispatcherDeps,
): Promise<void> {
  const code = event.kind === "text" ? parseBindCommand(event.text) : null;
  if (!code) {
    // 第一次聯絡：歡迎＋怎麼綁定，再附圖解說明，讓人知道綁好之後能做什麼。
    const messages: OutboundMessage[] =
      event.kind === "follow"
        ? [{ type: "text", text: s.welcome(settingsUrl(deps)) }, helpMessage(s, deps.baseUrl, settingsUrl(deps))]
        : [{ type: "text", text: s.notLinked(settingsUrl(deps)) }];
    await replier.send(messages, null, false);
    return;
  }
  await bind(
    { code, provider: event.provider, externalId: event.externalUserId, displayName: event.displayName ?? null },
    { adapter, replier, s, deps },
  );
}

type BindRequest = { code: string; provider: ChatProvider; externalId: string; displayName: string | null };
type BindContext = { adapter: ChannelAdapter; replier: Replier; s: BotStrings; deps: DispatcherDeps };

async function bind(
  { code, provider, externalId, displayName }: BindRequest,
  { adapter, replier, s, deps }: BindContext,
): Promise<void> {
  const name = displayName ?? (adapter.profileName ? await adapter.profileName(externalId) : null);
  const result = await deps.db.redeemChatLinkCode({ provider, code, externalId, displayName: name });
  if (!result.ok) {
    const msg = {
      invalid: s.bindInvalid,
      expired: s.bindExpired,
      used: s.bindUsed,
      taken: s.bindTaken,
    }[result.reason];
    await replier.send([{ type: "text", text: msg }], null, false);
    return;
  }
  const [userName, orgName] = await Promise.all([
    deps.directory.getUserName(result.identity.userId),
    deps.directory.getOrgName(result.orgId),
  ]);
  // 網頁那頭的「兩邊都通知」：設定頁讀 chat_identities 就會看到已綁定，不需要另外推。
  await replier.send(
    [{ type: "text", text: s.linked(userName ?? "", orgName ?? "") }, helpMessage(s, deps.baseUrl, settingsUrl(deps))],
    null,
    false,
  );
}

// ---------------------------------------------------------------------------
// 檔案
// ---------------------------------------------------------------------------

type OrgContext = { orgId: string; role: string; orgName: string };

/**
 * 這個人現在操作的組織與角色（每題都重查）。沒選組織、或已不在那個組織時直接回覆並回 null。
 * 只屬於一個組織時自動選好。
 */
async function resolveOrg(
  identity: ChatIdentityRow,
  replier: Replier,
  s: BotStrings,
  deps: DispatcherDeps,
): Promise<OrgContext | null> {
  // 以使用者「目前的組織」為準（網頁切換器、MCP 共用，src/db/current-org.ts）；
  // 沒設才看這個聊天帳號自己記的 active_org_id。
  let orgId = (deps.currentOrgId ? await deps.currentOrgId(identity.userId) : null) ?? identity.activeOrgId;
  if (!orgId) {
    const orgs = await deps.directory.listUserOrgs(identity.userId);
    if (orgs.length === 1) {
      orgId = orgs[0].id;
      await deps.db.setChatIdentityOrg(identity.id, orgId);
    } else {
      await sendOrgPicker(identity, replier, s, deps, s.noActiveOrg, orgs);
      return null;
    }
  }
  const role = await deps.getOrgRole(orgId, identity.userId);
  if (!role) {
    await sendOrgPicker(identity, replier, s, deps, s.notMember);
    return null;
  }
  const orgName = (await deps.directory.getOrgName(orgId)) ?? "";
  return { orgId, role, orgName };
}

async function sendOrgPicker(
  identity: ChatIdentityRow,
  replier: Replier,
  s: BotStrings,
  deps: DispatcherDeps,
  text: string,
  known?: { id: string; name: string }[],
): Promise<void> {
  const orgs = known ?? (await deps.directory.listUserOrgs(identity.userId));
  if (orgs.length === 0) {
    await replier.text(s.noOrgs);
    return;
  }
  await replier.send([
    {
      type: "orgPicker",
      text: text === s.pickOrg ? text : `${text}\n${s.pickOrg}`,
      orgs: orgs.map((o) => ({ ...o, ...(o.id === identity.activeOrgId ? { current: true } : {}) })),
    },
  ]);
}

async function handleMedia(
  event: Extract<InboundEvent, { kind: "media" }>,
  identity: ChatIdentityRow,
  adapter: ChannelAdapter,
  replier: Replier,
  s: BotStrings,
  deps: DispatcherDeps,
): Promise<void> {
  const org = await resolveOrg(identity, replier, s, deps);
  if (!org) return;
  const declared = event.media.mime ? normalizeMime(event.media.mime, event.media.fileName) : null;
  if (declared && !isAcceptedMime(declared)) {
    await recordIn(deps, event, identity, null);
    await replier.text(s.mediaType);
    return;
  }
  if (typeof event.media.size === "number" && event.media.size > CHAT_MEDIA_MAX_BYTES) {
    await recordIn(deps, event, identity, null);
    await replier.text(s.mediaTooLarge(`${deps.baseUrl}/dashboard/transactions`));
    return;
  }
  await adapter.showTyping(event.externalUserId, { messageId: event.messageId });

  let downloaded: Awaited<ReturnType<ChannelAdapter["downloadMedia"]>>;
  try {
    downloaded = await adapter.downloadMedia(event.media, CHAT_MEDIA_MAX_BYTES);
  } catch (err) {
    console.error("[channels] media download failed", err);
    await recordIn(deps, event, identity, null);
    await replier.text(s.mediaFailed);
    return;
  }
  if (!downloaded) {
    await recordIn(deps, event, identity, null);
    await replier.text(s.mediaTooLarge(`${deps.baseUrl}/dashboard/transactions`));
    return;
  }
  const fileName = downloaded.fileName ?? event.media.fileName;
  const mime = normalizeMime(downloaded.mime, fileName);
  if (!isAcceptedMime(mime)) {
    await recordIn(deps, event, identity, null);
    await replier.text(s.mediaType);
    return;
  }
  const name = fileName ?? `${event.provider}-${event.media.id.slice(-12)}.${extFor(mime)}`;
  const key = `chat/${org.orgId}/${(deps.newId ?? (() => crypto.randomUUID()))()}-${safeFileName(name)}`;
  await deps.putObject(key, downloaded.bytes, mime);
  const doc = await deps.db.createInboxDocument({
    orgId: org.orgId,
    r2Key: key,
    fileName: name,
    contentType: mime,
    sizeBytes: downloaded.bytes.byteLength,
    uploadedBy: identity.userId,
    source: event.provider,
  });
  await recordIn(deps, event, identity, doc.id);
  const row = await deps.db.appendChatBuffer({
    identityId: identity.id,
    provider: event.provider,
    externalMessageId: event.messageId ?? null,
    kind: "media",
    text: event.caption ?? null,
    documentId: doc.id,
    quotedExternalId: event.quotedMessageId ?? null,
  });
  await scheduleFlush(deps, identity, row.receivedAt, FLUSH_DELAY_MEDIA_S, event);
}

// ---------------------------------------------------------------------------
// flush：合成一題
// ---------------------------------------------------------------------------

export async function handleFlush(job: Extract<ChannelJob, { kind: "flush" }>, deps: DispatcherDeps): Promise<void> {
  const identity = await deps.db.getChatIdentity(job.identityId);
  if (!identity) return;
  const adapter = deps.adapter(identity.provider);
  if (!adapter) return;

  const latest = await deps.db.latestPendingBufferAt(identity.id);
  if (!latest) return;
  // 排這次之後又有新訊息：交給較晚的那次 flush。
  if (ts(latest) > ts(job.anchor)) return;

  if (!(await deps.db.tryAcquireChatBusy(identity.id))) {
    const attempt = (job.attempt ?? 0) + 1;
    if (attempt <= FLUSH_MAX_ATTEMPTS) await deps.schedule({ ...job, attempt }, FLUSH_RETRY_S);
    return;
  }
  try {
    await runFlush(job, identity, adapter, deps);
  } finally {
    await deps.db.releaseChatBusy(identity.id);
    await followUp(identity, deps);
  }
}

/** 放鎖之後：暫存區還有真的訊息（不只是「新對話」記號）就再排一次 flush。 */
async function followUp(identity: ChatIdentityRow, deps: DispatcherDeps): Promise<void> {
  try {
    const rest = await deps.db.peekChatBuffer(identity.id);
    const real = rest.filter((r) => !isMark(r));
    if (real.length === 0) return;
    await deps.schedule(
      { kind: "flush", provider: identity.provider, identityId: identity.id, anchor: rest.at(-1)!.receivedAt },
      FLUSH_FOLLOWUP_S,
    );
  } catch (err) {
    console.error("[channels] follow-up flush failed", err);
  }
}

/** 暫存區幾則訊息 → 一題（純函式部分放在 db/chat 的 mergeChatBuffer）。 */
async function runFlush(
  job: Extract<ChannelJob, { kind: "flush" }>,
  identity: ChatIdentityRow,
  adapter: ChannelAdapter,
  deps: DispatcherDeps,
): Promise<void> {
  const locale = localeOf(deps, identity);
  const s = botStrings(locale);
  const replier = new Replier(deps, adapter, identity.externalId, locale, identity.id, {
    token: job.replyToken,
    at: job.replyTokenAt,
  });

  const rows = await deps.db.peekChatBuffer(identity.id);
  const real = rows.filter((r) => !isMark(r));
  if (real.length === 0) return; // 只有「新對話」記號：等下一則真的訊息
  await deps.db.markChatBufferConsumed(rows.map((r) => r.id));
  const forceNew = rows.some(isMark);
  const merged = mergeChatBuffer(real);

  const command = merged.documentIds.length === 0 && merged.quotedExternalIds.length === 0
    ? parseCommand(merged.text)
    : null;
  if (command) {
    await runCommand(command, identity, adapter, replier, s, deps);
    return;
  }
  if (!merged.text.trim() && merged.documentIds.length === 0 && merged.quotedExternalIds.length === 0) return;

  const org = await resolveOrg(identity, replier, s, deps);
  if (!org) return;
  if (!deps.runTurn) {
    await replier.text(s.aiNotConfigured);
    return;
  }

  const question = await buildQuestion(merged, identity, org, s, deps);
  // 問新的一題：還開著的卡一律收掉（引擎會把它們當成取消）。
  for (const card of await deps.db.listOpenChatCards(identity.id)) await deps.db.closeChatCard(card.id);

  await adapter.showTyping(identity.externalId, { messageId: merged.externalMessageIds.at(-1) });
  const userName = (await deps.directory.getUserName(identity.userId)) ?? identity.displayName ?? "";
  const events: ChatEvent[] = [];
  let conversationId: string | null = null;
  try {
    const result = await deps.runTurn({
      owner: { orgId: org.orgId, userId: identity.userId },
      role: org.role,
      channel: identity.provider,
      ...(forceNew ? { forceNewConversation: true } : {}),
      message: question.message,
      attachments: question.attachments,
      locale,
      orgName: org.orgName,
      userName,
      emit: (e) => events.push(e),
    });
    conversationId = result.conversationId;
  } catch (err) {
    await replyTurnError(err, events, replier, s, deps);
    return;
  }
  await deliver(collectTurn(events), { conversationId, identity, org, actorName: userName, replier, s, locale, deps });
}

type Merged = MergedChatBuffer;

/** 合成的文字＋引用前綴＋附件。 */
async function buildQuestion(
  merged: Merged,
  identity: ChatIdentityRow,
  org: OrgContext,
  s: BotStrings,
  deps: DispatcherDeps,
): Promise<{ message: string; attachments: AttachmentRef[] }> {
  const prefixes: string[] = [];
  const docIds = [...merged.documentIds];
  for (const quotedId of merged.quotedExternalIds) {
    const ref = await deps.db.getChatMessageRef(identity.provider, quotedId, identity.id);
    if (!ref) {
      prefixes.push(s.quotedMissing);
      continue;
    }
    if (ref.cardId) {
      const card = await deps.db.getChatCard(ref.cardId);
      if (card && isLiveCard(card)) {
        // 回覆一張還開著的確認卡：當成要修改它，舊卡先收掉。
        await deps.db.closeChatCard(card.id);
        prefixes.push(s.quotedCard((ref.snippet ?? "").replaceAll("\n", "；")));
        continue;
      }
    }
    if (ref.documentId !== null) {
      if (!docIds.includes(ref.documentId)) docIds.push(ref.documentId);
      prefixes.push(s.quotedAttachment(ref.snippet ?? `#${ref.documentId}`));
      continue;
    }
    prefixes.push(s.quoted(ref.snippet ?? ""));
  }
  // 只帶這個組織的檔案（被引用的舊檔案可能是在別的組織傳的）。
  const docs = docIds.length > 0 ? await deps.db.getOrgDocuments(org.orgId, docIds) : [];
  const byId = new Map(docs.map((d) => [d.id, d]));
  const attachments: AttachmentRef[] = docIds
    .map((id) => byId.get(id))
    .filter((d): d is InboxDocumentRow => Boolean(d))
    .map((d) => ({ documentId: d.id, fileName: d.fileName, contentType: d.contentType }));
  const message = [...prefixes, merged.text].filter(Boolean).join("\n");
  return { message: message.slice(0, MAX_USER_MESSAGE_CHARS), attachments };
}

async function replyTurnError(
  err: unknown,
  events: readonly ChatEvent[],
  replier: Replier,
  s: BotStrings,
  deps: DispatcherDeps,
): Promise<void> {
  console.error("[channels] runTurn failed", err);
  const partial = collectTurn(events);
  const text = deps.isModelError?.(err) ? s.modelFailed : s.error;
  try {
    await replier.text(text, partial.conversationId ?? null);
  } catch (sendErr) {
    console.error("[channels] error reply failed", sendErr);
  }
}

function errorText(code: TurnOutput["error"], s: BotStrings): string | null {
  if (!code) return null;
  if (code === "model_failed") return s.modelFailed;
  if (code === "too_many_rounds") return s.tooManyRounds;
  if (code === "not_configured") return s.aiNotConfigured;
  if (code === "not_found") return s.cardGone;
  return s.error;
}

type DeliverContext = {
  conversationId: string | null;
  identity: ChatIdentityRow;
  org: OrgContext;
  actorName: string;
  replier: Replier;
  s: BotStrings;
  locale: Locale;
  deps: DispatcherDeps;
  /** 接在模型文字與錯誤之後的固定訊息（「已取消」等）。 */
  extra?: readonly string[];
  /** 確認後寫入成功的收據卡（放在最前面，AI 的文字接在後面）。 */
  receipts?: readonly DoneReceipt[];
};

/** 一題的結果送出去：文字（含快速選項）＋確認卡（3 張以上多一張「全部確認」）。 */
async function deliver(out: TurnOutput, ctx: DeliverContext): Promise<void> {
  const { conversationId, identity, org, actorName, replier, s, locale, deps, extra = [], receipts = [] } = ctx;
  const msgs: OutboundMessage[] = [];
  if (receipts.length > 0) msgs.push({ type: "done", receipts: [...receipts] });
  const body = out.texts.join("\n\n");
  if (body) msgs.push(...replyToMessages(body, deps.baseUrl, replier.rich, s.emptyReply));
  const err = errorText(out.error, s);
  if (err) msgs.push({ type: "text", text: err });
  for (const line of extra) msgs.push({ type: "text", text: line });

  if (conversationId && out.pending.length > 0) {
    const cards = await makeCards(out.pending, conversationId, identity, org, actorName, locale, deps);
    msgs.push({ type: "cards", cards });
  }
  if (msgs.length === 0) msgs.push({ type: "text", text: s.emptyReply });
  await replier.send(msgs, conversationId);
}

async function makeCards(
  pending: readonly UiToolCall[],
  conversationId: string,
  identity: ChatIdentityRow,
  org: OrgContext,
  actorName: string,
  locale: Locale,
  deps: DispatcherDeps,
): Promise<ConfirmCard[]> {
  const meta = { orgName: org.orgName, actorName, locale };
  const cards: ConfirmCard[] = [];
  for (const call of pending) {
    const row = await deps.db.createChatCard({ identityId: identity.id, conversationId, toolCallIds: [call.id] });
    // AI 可以寫進本人的其他組織（引擎已解析成組織 id）：卡片上的組織名稱、分類名稱都用那個組織的。
    const callOrgId = call.organizationId ?? org.orgId;
    const orgName =
      callOrgId === org.orgId ? org.orgName : ((await deps.directory.getOrgName(callOrgId)) ?? org.orgName);
    cards.push(toConfirmCard(await withCategoryName(call, callOrgId, deps), { ...meta, orgName, cardId: row.id }));
  }
  if (cards.length >= 3) {
    const row = await deps.db.createChatCard({
      identityId: identity.id,
      conversationId,
      toolCallIds: pending.map((c) => c.id),
    });
    cards.push(batchCard(cards, { ...meta, cardId: row.id }));
  }
  return cards;
}

/**
 * 卡片上的「分類」顯示名稱而不是 id（手機上看到「分類 12」沒有意義）。
 * 只改顯示用的那份參數，送回引擎的 toolCallId 不變；查不到就保留 id。
 */
async function withCategoryName(call: UiToolCall, orgId: string, deps: DispatcherDeps): Promise<UiToolCall> {
  const id = call.args?.categoryId;
  if (typeof id !== "number" || !deps.directory.getCategoryName) return call;
  try {
    const name = await deps.directory.getCategoryName(orgId, id);
    return name ? { ...call, args: { ...call.args, categoryId: name } } : call;
  } catch (err) {
    console.error("[channels] getCategoryName failed", err);
    return call;
  }
}

// ---------------------------------------------------------------------------
// 指令
// ---------------------------------------------------------------------------

async function runCommand(
  command: BotCommand,
  identity: ChatIdentityRow,
  adapter: ChannelAdapter,
  replier: Replier,
  s: BotStrings,
  deps: DispatcherDeps,
): Promise<void> {
  switch (command.kind) {
    case "bind":
      await bind(
        { code: command.code, provider: identity.provider, externalId: identity.externalId, displayName: null },
        { adapter, replier, s, deps },
      );
      return;
    case "switchOrg":
      await sendOrgPicker(identity, replier, s, deps, s.pickOrg);
      return;
    case "newConversation":
      for (const card of await deps.db.listOpenChatCards(identity.id)) await deps.db.closeChatCard(card.id);
      // 下一則真的訊息進來時才開新對話（不先建一段空的對話留在網頁列表裡）。
      await deps.db.appendChatBuffer({
        identityId: identity.id,
        provider: identity.provider,
        kind: "button",
        text: NEW_CONVERSATION_MARK,
      });
      await replier.text(s.newConversation);
      return;
    case "unlink":
      // 先回覆再刪：刪掉之後 chat_message_refs 記不進去（FK）。
      await replier.send([{ type: "text", text: s.unlinked }], null, false);
      await deps.db.deleteChatIdentity(identity.id);
      return;
    case "help":
      await replier.send([helpMessage(s, deps.baseUrl, settingsUrl(deps))]);
      return;
  }
}

// ---------------------------------------------------------------------------
// 按鈕
// ---------------------------------------------------------------------------

async function handleButton(
  payload: string,
  identity: ChatIdentityRow,
  adapter: ChannelAdapter,
  replier: Replier,
  s: BotStrings,
  deps: DispatcherDeps,
): Promise<void> {
  const orgId = parseOrgPayload(payload);
  if (orgId) {
    const role = await deps.getOrgRole(orgId, identity.userId);
    if (!role) {
      await replier.text(s.notMember);
      return;
    }
    await deps.db.setChatIdentityOrg(identity.id, orgId);
    await deps.setCurrentOrgId?.(identity.userId, orgId);
    for (const card of await deps.db.listOpenChatCards(identity.id)) await deps.db.closeChatCard(card.id);
    await replier.text(s.switched((await deps.directory.getOrgName(orgId)) ?? ""));
    return;
  }
  const parsed = parseCardPayload(payload);
  if (!parsed) {
    await replier.text(s.cardGone);
    return;
  }
  const card = await deps.db.getChatCard(parsed.cardId);
  if (!card) {
    await replier.text(s.cardGone);
    return;
  }
  if (card.identityId !== identity.id) {
    await replier.text(s.cardNotYours);
    return;
  }
  if (!isLiveCard(card)) {
    if (card.status === "open") await deps.db.closeChatCard(card.id, "expired");
    await replier.text(s.cardGone);
    return;
  }

  if (!(await acquireForButton(identity.id, deps))) {
    await replier.text(s.busy);
    return;
  }
  try {
    await runCardAction(card, parsed.action, identity, adapter, replier, s, deps);
  } finally {
    await deps.db.releaseChatBusy(identity.id);
    await followUp(identity, deps);
  }
}

async function acquireForButton(identityId: string, deps: DispatcherDeps): Promise<boolean> {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let i = 0; i < BUTTON_LOCK_TRIES; i++) {
    if (await deps.db.tryAcquireChatBusy(identityId)) return true;
    if (i < BUTTON_LOCK_TRIES - 1) await sleep(BUTTON_LOCK_WAIT_MS);
  }
  return false;
}

async function runCardAction(
  card: ChatCardRow,
  action: CardAction,
  identity: ChatIdentityRow,
  _adapter: ChannelAdapter,
  replier: Replier,
  s: BotStrings,
  deps: DispatcherDeps,
): Promise<void> {
  const locale = localeOf(deps, identity);
  const org = await resolveOrg(identity, replier, s, deps);
  if (!org) return;
  if (!deps.runTurn) {
    await replier.text(s.aiNotConfigured);
    return;
  }
  // 搶下這張卡：同一張卡按兩次，第二次改不到就不再執行。
  if (!(await deps.db.closeChatCard(card.id))) {
    await replier.text(s.cardGone);
    return;
  }
  if (action === "all") await closeCoveredCards(card, identity, deps);

  const userName = (await deps.directory.getUserName(identity.userId)) ?? identity.displayName ?? "";
  const events: ChatEvent[] = [];
  try {
    await confirmToolCalls(card, action, { deps, identity, org, locale, userName, events });
  } catch (err) {
    if (deps.isTurnNotFound?.(err)) {
      await replier.text(s.cardGone);
      return;
    }
    await replyTurnError(err, events, replier, s, deps);
    return;
  }

  const out = collectTurn(events);
  const receipts = await receiptsFor(out, org, locale, deps);
  const extra = cardActionExtras(out, action, s, receipts.length > 0);
  await deliver(out, {
    conversationId: card.conversationId,
    identity,
    org,
    actorName: userName,
    replier,
    s,
    locale,
    deps,
    extra,
    receipts,
  });
}

/** 這次確認裡寫入成功的工具 → 收據卡（分類 id 換成名稱；查不到就不列分類）。 */
async function receiptsFor(
  out: TurnOutput,
  org: OrgContext,
  locale: Locale,
  deps: DispatcherDeps,
): Promise<DoneReceipt[]> {
  const infos = out.results
    .filter((r) => r.status === "ok" && r.done)
    .map((r) => r.done as ToolDoneInfo);
  const receipts: DoneReceipt[] = [];
  for (const info of infos) {
    receipts.push(doneReceipt(info, { locale, baseUrl: deps.baseUrl, categoryName: await categoryNameOf(info, org, deps) }));
  }
  return receipts;
}

async function categoryNameOf(info: ToolDoneInfo, org: OrgContext, deps: DispatcherDeps): Promise<string | null> {
  const id = info.args.categoryId;
  if (typeof id !== "number" || id <= 0 || !deps.directory.getCategoryName) return null;
  const orgId = typeof info.args.organizationId === "string" ? info.args.organizationId : org.orgId;
  try {
    return await deps.directory.getCategoryName(orgId, id);
  } catch (err) {
    console.error("[channels] getCategoryName failed", err);
    return null;
  }
}

type CardAction = "confirm" | "edit" | "cancel" | "all";

/** 「全部確認」：批次涵蓋的單張卡也一併收掉（已經按過的那幾張，引擎會回 not_found，這裡略過）。 */
async function closeCoveredCards(card: ChatCardRow, identity: ChatIdentityRow, deps: DispatcherDeps): Promise<void> {
  const ids = new Set(card.toolCallIds);
  for (const c of await deps.db.listOpenChatCards(identity.id)) {
    if (c.toolCallIds.every((id) => ids.has(id))) await deps.db.closeChatCard(c.id);
  }
}

type ConfirmRun = {
  deps: DispatcherDeps;
  identity: ChatIdentityRow;
  org: OrgContext;
  locale: Locale;
  userName: string;
  events: ChatEvent[];
};

/** 卡片上的每個工具呼叫依序送確認／取消給引擎，事件收進 run.events。 */
async function confirmToolCalls(card: ChatCardRow, action: CardAction, run: ConfirmRun): Promise<void> {
  const { deps, identity, org, locale, userName, events } = run;
  const approve = action === "confirm" || action === "all";
  for (const toolCallId of card.toolCallIds) {
    const before = events.length;
    await deps.runTurn?.({
      owner: { orgId: org.orgId, userId: identity.userId },
      role: org.role,
      channel: identity.provider,
      conversationId: card.conversationId,
      confirm: { toolCallId, approve },
      locale,
      orgName: org.orgName,
      userName,
      emit: (e) => events.push(e),
    });
    // 批次裡已經單獨按過的那幾張：引擎回 not_found，不算錯。
    if (card.toolCallIds.length > 1) dropNotFound(events, before);
  }
}

/**
 * 模型沒說話時補的固定訊息：失敗原因、「已確認」、「請說要改什麼」、「已取消」。
 * 有收據卡時就不再補「好了。」（收據卡本身就是回覆）。
 */
function cardActionExtras(out: TurnOutput, action: CardAction, s: BotStrings, hasReceipts: boolean): string[] {
  const extra: string[] = [];
  if (out.texts.length === 0 && !out.error) {
    const failed = out.results.find((r) => r.status === "error");
    if (failed) extra.push(s.failed((failed.error ?? "").slice(0, 200)));
    else if ((action === "confirm" || action === "all") && !hasReceipts) extra.push(s.emptyReply);
  }
  if (action === "edit") extra.push(s.editPrompt);
  else if (action === "cancel" && out.texts.length === 0) extra.push(s.cancelled);
  return extra;
}

function dropNotFound(events: ChatEvent[], from: number): void {
  for (let i = events.length - 1; i >= from; i--) {
    const e = events[i];
    if (e.t === "error" && e.code === "not_found") events.splice(i, 1);
  }
}

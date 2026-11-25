/**
 * LINE Messaging API adapter。
 *
 * - 驗簽：X-Line-Signature = base64(HMAC-SHA256(channel secret, 原始 body))。
 * - 事件：message（text／image／file，其他種類 → unsupported）、postback、follow、join（群組）。
 * - 檔案：GET api-data.line.me/v2/bot/message/{id}/content。
 * - 送出：reply token 還在 50 秒內就 reply（不算則數），否則 push；一次最多 5 則，超過的用 push 補。
 * - 確認卡：Flex bubble（每張 ≤ 30KB），多張用 carousel（≤ 12 張）；快速選項用 quick reply（≤ 13 個）。
 *
 * 參考：https://developers.line.biz/en/reference/messaging-api/
 */
import type { Locale } from "@/i18n/config";
import type { LineConfig } from "./config";
import { readBodyLimited } from "./crypto";
import { cardToText } from "./render";
import { verifyLineSignature } from "./signature";
import { botStrings } from "./strings";
import {
  cardPayload,
  orgPayload,
  type ChannelAdapter,
  type ConfirmCard,
  type InboundEvent,
  type InboundMedia,
  type InboundPayload,
  type OutboundMessage,
  type SendOptions,
  type SentMessage,
} from "./types";

export const LINE_API = "https://api.line.me";
export const LINE_DATA_API = "https://api-data.line.me";

/** 一次 reply／push 最多幾則。 */
export const LINE_MAX_MESSAGES = 5;
/** reply token 官方 1 分鐘內有效，留 10 秒餘裕。 */
export const LINE_REPLY_TOKEN_MS = 50_000;
/** Flex bubble 上限 30KB、carousel 50KB、carousel 最多 12 張。 */
export const LINE_BUBBLE_MAX_BYTES = 30 * 1024;
export const LINE_CAROUSEL_MAX_BYTES = 50 * 1024;
export const LINE_CAROUSEL_MAX = 12;
export const LINE_QUICK_REPLY_MAX = 13;
export const LINE_TEXT_MAX = 5000;
export const LINE_ALT_TEXT_MAX = 400;
const LABEL_MAX = 20;

const BRAND = "#1D4ED8";
const MUTED = "#6B7280";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

// ---------------------------------------------------------------------------
// 驗簽
// ---------------------------------------------------------------------------

export { verifyLineSignature };

// ---------------------------------------------------------------------------
// 事件解析
// ---------------------------------------------------------------------------

type LineSource = { type?: string; userId?: string; groupId?: string; roomId?: string };
type LineEvent = {
  type?: string;
  webhookEventId?: string;
  timestamp?: number;
  replyToken?: string;
  mode?: string;
  source?: LineSource;
  message?: {
    id?: string;
    type?: string;
    text?: string;
    fileName?: string;
    fileSize?: number;
    quotedMessageId?: string;
  };
  postback?: { data?: string };
};

function messagePayload(m: NonNullable<LineEvent["message"]>): InboundPayload {
  if (m.type === "text") return { kind: "text" as const, text: m.text ?? "" };
  if (m.type === "image" && m.id) return { kind: "media" as const, media: { id: m.id, mime: "image/jpeg" } };
  if (m.type === "file" && m.id) {
    const size = typeof m.fileSize === "number" ? { size: m.fileSize } : {};
    return { kind: "media" as const, media: { id: m.id, fileName: m.fileName, ...size } };
  }
  return { kind: "unsupported" as const, what: m.type };
}

function payloadOf(ev: LineEvent): InboundPayload | null {
  if (ev.type === "message" && ev.message) return messagePayload(ev.message);
  if (ev.type === "postback") return { kind: "button" as const, payload: ev.postback?.data ?? "" };
  if (ev.type === "follow") return { kind: "follow" as const };
  if (ev.type === "join") return { kind: "unsupported" as const, what: "join" };
  return null;
}

/** 群組／聊天室事件帶上群組資訊（之後要離開群組用）。 */
function groupOf(src: LineSource, isGroup: boolean): { group?: { id: string; type: "group" | "room" } } {
  const groupId = src.groupId ?? src.roomId;
  if (!isGroup || !groupId) return {};
  return { group: { id: groupId, type: src.type === "room" ? "room" : "group" } };
}

/** 平台給的 webhookEventId 優先；舊事件沒有就用訊息 id，再不然自己組一個。 */
function eventIdOf(ev: LineEvent, externalUserId: string): string {
  return ev.webhookEventId ?? ev.message?.id ?? `${ev.type}:${externalUserId}:${String(ev.timestamp ?? "")}`;
}

/** 一個 LINE 事件 → InboundEvent；standby、不處理的事件類型、沒有使用者的一對一事件回 null。 */
function toInboundEvent(ev: LineEvent): InboundEvent | null {
  if (ev.mode === "standby") return null; // 別的 channel 在處理這個聊天
  const payload = payloadOf(ev);
  if (!payload) return null;
  const src = ev.source ?? {};
  const isGroup = src.type === "group" || src.type === "room";
  const externalUserId = src.userId ?? "";
  if (!externalUserId && !isGroup) return null;
  const message = ev.message;
  return {
    ...payload,
    provider: "line",
    eventId: eventIdOf(ev, externalUserId),
    ...(message?.id ? { messageId: message.id } : {}),
    externalUserId,
    isGroup,
    ...groupOf(src, isGroup),
    ...(ev.replyToken ? { replyToken: ev.replyToken } : {}),
    ...(message?.quotedMessageId ? { quotedMessageId: message.quotedMessageId } : {}),
    receivedAt: typeof ev.timestamp === "number" ? ev.timestamp : Date.now(),
  } as InboundEvent;
}

/** webhook body → 事件。unfollow、leave、已讀、standby 模式的事件直接略過。 */
export function parseLineWebhook(raw: string): InboundEvent[] {
  let body: { events?: LineEvent[] };
  try {
    body = JSON.parse(raw) as { events?: LineEvent[] };
  } catch {
    return [];
  }
  const out: InboundEvent[] = [];
  for (const ev of body.events ?? []) {
    const event = toInboundEvent(ev);
    if (event) out.push(event);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 訊息組裝
// ---------------------------------------------------------------------------

export type LineMessage = Record<string, unknown>;

/** 組好的一則 LINE 訊息，加上記 chat_message_refs 用的摘要與卡片 id。 */
export type BuiltLineMessage = { message: LineMessage; snippet: string; cardId?: string };

function clip(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, Math.max(0, max - 1))}…` : s;
}

function byteLength(v: unknown): number {
  return new TextEncoder().encode(JSON.stringify(v)).byteLength;
}

function postback(label: string, data: string, displayText?: string) {
  return {
    type: "postback",
    label: clip(label, LABEL_MAX),
    data,
    ...(displayText ? { displayText: clip(displayText, 300) } : {}),
  };
}

function button(label: string, data: string, style: "primary" | "secondary" | "link") {
  return {
    type: "button",
    style,
    height: "sm",
    ...(style === "primary" ? { color: BRAND } : {}),
    action: postback(label, data, label),
  };
}

/** 一張確認卡 → Flex bubble。超過 30KB 就從最後一列開始拿掉。 */
export function cardBubble(card: ConfirmCard, locale: Locale): LineMessage {
  const s = botStrings(locale);
  const build = (rowCount: number): LineMessage => {
    const rows = card.rows.slice(0, rowCount).map((r) => ({
      type: "box",
      layout: "baseline",
      spacing: "sm",
      contents: [
        { type: "text", text: clip(r.label || "-", 40), size: "sm", color: MUTED, flex: 2, wrap: true },
        {
          type: "text",
          text: clip(r.note ? `${r.value}（${r.note}）` : r.value || "-", 200),
          size: "sm",
          flex: 5,
          wrap: true,
        },
      ],
    }));
    const body: unknown[] = [...rows];
    if (card.ruleHint) {
      body.push({
        type: "text",
        text: clip(`${s.ruleHintLabel}：${card.ruleHint}`, 200),
        size: "xs",
        color: BRAND,
        wrap: true,
        margin: "md",
      });
    }
    const footer: unknown[] = [];
    if (card.actions.includes("all")) {
      footer.push(button(card.confirmLabel ?? s.confirmAll(card.rows.length), cardPayload(card.cardId, "all"), "primary"));
    }
    if (card.actions.includes("confirm")) {
      footer.push(button(card.confirmLabel ?? s.confirm, cardPayload(card.cardId, "confirm"), "primary"));
    }
    const secondary: unknown[] = [];
    if (card.actions.includes("edit")) secondary.push(button(s.edit, cardPayload(card.cardId, "edit"), "secondary"));
    if (card.actions.includes("cancel")) secondary.push(button(s.cancel, cardPayload(card.cardId, "cancel"), "secondary"));
    if (secondary.length > 0) footer.push({ type: "box", layout: "horizontal", spacing: "sm", contents: secondary });
    return {
      type: "bubble",
      size: "mega",
      header: {
        type: "box",
        layout: "vertical",
        spacing: "xs",
        contents: [
          { type: "text", text: clip(card.title || "-", 120), weight: "bold", size: "md", wrap: true },
          { type: "text", text: clip(`${card.orgName} · ${card.actorName}`, 80), size: "xs", color: MUTED, wrap: true },
        ],
      },
      body: { type: "box", layout: "vertical", spacing: "sm", contents: body.length > 0 ? body : [{ type: "filler" }] },
      footer: { type: "box", layout: "vertical", spacing: "sm", contents: footer },
    };
  };
  let n = card.rows.length;
  let bubble = build(n);
  while (n > 0 && byteLength(bubble) > LINE_BUBBLE_MAX_BYTES) bubble = build(--n);
  return bubble;
}

function altTextFor(cards: readonly ConfirmCard[]): string {
  return clip(cards.map((c) => c.title).join(" / ") || "確認", LINE_ALT_TEXT_MAX);
}

/** 一批卡片 → 1 則以上的 Flex 訊息（一張用 bubble，多張用 carousel，每則 ≤ 12 張且 ≤ 50KB）。 */
export function cardsToFlex(cards: readonly ConfirmCard[], locale: Locale): BuiltLineMessage[] {
  const out: BuiltLineMessage[] = [];
  let chunk: { card: ConfirmCard; bubble: LineMessage }[] = [];
  const emit = () => {
    if (chunk.length === 0) return;
    const contents =
      chunk.length === 1 ? chunk[0].bubble : { type: "carousel", contents: chunk.map((c) => c.bubble) };
    out.push({
      message: { type: "flex", altText: altTextFor(chunk.map((c) => c.card)), contents },
      snippet: chunk.map((c) => cardToText(c.card, locale)).join(" / "),
      cardId: chunk[0].card.cardId,
    });
    chunk = [];
  };
  for (const card of cards) {
    const bubble = cardBubble(card, locale);
    const size = byteLength({ type: "carousel", contents: [...chunk.map((c) => c.bubble), bubble] });
    if (chunk.length >= LINE_CAROUSEL_MAX || (chunk.length > 0 && size > LINE_CAROUSEL_MAX_BYTES)) emit();
    chunk.push({ card, bubble });
  }
  emit();
  return out;
}

function quickReply(items: { label: string; action: Record<string, unknown> }[]) {
  return {
    items: items.slice(0, LINE_QUICK_REPLY_MAX).map((i) => ({ type: "action", action: i.action })),
  };
}

/** OutboundMessage → LINE 訊息物件（依序）。 */
export function buildLineMessages(msgs: readonly OutboundMessage[], locale: Locale): BuiltLineMessage[] {
  const out: BuiltLineMessage[] = [];
  for (const m of msgs) {
    if (m.type === "text") {
      const text = clip(m.text, LINE_TEXT_MAX);
      if (!text.trim()) continue;
      const qr = (m.quickReplies ?? []).map((q) => ({
        label: q.label,
        action: { type: "message", label: clip(q.label, LABEL_MAX), text: clip(q.text, 300) },
      }));
      out.push({
        message: { type: "text", text, ...(qr.length > 0 ? { quickReply: quickReply(qr) } : {}) },
        snippet: text,
      });
    } else if (m.type === "cards") {
      out.push(...cardsToFlex(m.cards, locale));
    } else {
      const items = m.orgs.map((o) => ({
        label: o.name,
        action: postback(o.current ? `✓ ${o.name}` : o.name, orgPayload(o.id), o.name),
      }));
      out.push({ message: { type: "text", text: clip(m.text, LINE_TEXT_MAX), quickReply: quickReply(items) }, snippet: m.text });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

class LineApiError extends Error {
  constructor(
    readonly status: number,
    detail: string,
  ) {
    super(`LINE API ${status}: ${detail.slice(0, 300)}`);
  }
}

function sentIds(res: unknown): string[] {
  const list = (res as { sentMessages?: { id?: string }[] } | null)?.sentMessages ?? [];
  return list.map((m) => m.id ?? "");
}

export function createLineAdapter(cfg: LineConfig, fetchImpl: FetchLike = (u, i) => fetch(u, i)): ChannelAdapter {
  const auth = { Authorization: `Bearer ${cfg.accessToken}` };

  async function post(path: string, body: unknown): Promise<unknown> {
    const res = await fetchImpl(`${LINE_API}${path}`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) throw new LineApiError(res.status, text);
    try {
      return text ? (JSON.parse(text) as unknown) : {};
    } catch {
      return {};
    }
  }

  return {
    provider: "line",

    verify: (headers, rawBody) => verifyLineSignature(cfg.channelSecret, rawBody, headers.get("x-line-signature")),

    parse: parseLineWebhook,

    async downloadMedia(media: InboundMedia, maxBytes: number) {
      if (typeof media.size === "number" && media.size > maxBytes) return null;
      const res = await fetchImpl(`${LINE_DATA_API}/v2/bot/message/${encodeURIComponent(media.id)}/content`, {
        headers: auth,
      });
      if (!res.ok) throw new LineApiError(res.status, await res.text());
      const bytes = await readBodyLimited(res, maxBytes);
      if (!bytes) return null;
      const mime = (res.headers.get("content-type") ?? media.mime ?? "application/octet-stream").split(";")[0].trim();
      return { bytes, mime, ...(media.fileName ? { fileName: media.fileName } : {}) };
    },

    async send(to: string, msgs: readonly OutboundMessage[], opts: SendOptions = {}): Promise<SentMessage[]> {
      const built = buildLineMessages(msgs, opts.locale ?? "zh-TW");
      const sent: SentMessage[] = [];
      let replyToken =
        opts.replyToken && (opts.replyTokenAt === undefined || Date.now() - opts.replyTokenAt < LINE_REPLY_TOKEN_MS)
          ? opts.replyToken
          : undefined;
      for (let i = 0; i < built.length; i += LINE_MAX_MESSAGES) {
        const chunk = built.slice(i, i + LINE_MAX_MESSAGES);
        const messages = chunk.map((b) => b.message);
        let res: unknown;
        if (replyToken) {
          try {
            res = await post("/v2/bot/message/reply", { replyToken, messages });
          } catch (err) {
            // token 過期或用過（400）就改 push；其他錯誤照丟。
            if (!(err instanceof LineApiError && err.status === 400)) throw err;
            res = await post("/v2/bot/message/push", { to, messages });
          }
          replyToken = undefined; // reply token 只能用一次
        } else {
          res = await post("/v2/bot/message/push", { to, messages });
        }
        const ids = sentIds(res);
        chunk.forEach((b, k) => {
          if (ids[k]) sent.push({ externalId: ids[k], snippet: b.snippet, ...(b.cardId ? { cardId: b.cardId } : {}) });
        });
      }
      return sent;
    },

    async showTyping(to: string) {
      try {
        await post("/v2/bot/chat/loading/start", { chatId: to, loadingSeconds: 60 });
      } catch (err) {
        console.warn("[channels/line] loading animation failed", err);
      }
    },

    async leaveGroup(group) {
      await post(`/v2/bot/${group.type}/${encodeURIComponent(group.id)}/leave`, {});
    },

    async profileName(userId: string) {
      try {
        const res = await fetchImpl(`${LINE_API}/v2/bot/profile/${encodeURIComponent(userId)}`, { headers: auth });
        if (!res.ok) return null;
        const p: { displayName?: string } = await res.json();
        return p.displayName ?? null;
      } catch {
        return null;
      }
    },
  };
}

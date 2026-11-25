/**
 * WhatsApp Cloud API adapter。
 *
 * - GET 驗證：hub.mode=subscribe、hub.verify_token 對上就回 hub.challenge。
 * - 驗簽：X-Hub-Signature-256 = "sha256=" + hex(HMAC-SHA256(app secret, 原始 body))。
 * - 事件：entry[].changes[].value.messages[]（text、image、document、interactive.button_reply／
 *   list_reply、template 的 button；其他種類 → unsupported）。statuses（送達、已讀）略過。
 * - 檔案：先 GET /{media-id} 拿下載網址，再帶 token 下載。
 * - 送出：text（≤ 4096）、interactive button（≤ 3 顆、標題 ≤ 20 字、body ≤ 1024）、
 *   interactive list（組織選單超過 3 個時）；每則各打一次 API，依序送。
 * - 說明卡：每張一則 image（`link` 是 internal 上的公開圖片＋caption），最後一則文字列出指令。
 *   表格、站內連結、收據卡沒有 Flex 可畫，一律寫成文字（表格「欄：值」、連結寫網址）。
 * - 處理中：mark read＋typing indicator（要帶對方那則訊息的 id）。
 *
 * 參考：https://developers.facebook.com/docs/whatsapp/cloud-api/
 */
import type { Locale } from "@/i18n/config";
import type { WhatsAppConfig } from "./config";
import { readBodyLimited, timingSafeEqual } from "./crypto";
import { cardToText, linksToText, receiptToText, tableToText } from "./render";
import { verifyWhatsAppSignature } from "./signature";
import { botStrings } from "./strings";
import {
  cardPayload,
  orgPayload,
  QUICK_REPLY_PREFIX,
  type ChannelAdapter,
  type ConfirmCard,
  type InboundEvent,
  type InboundMedia,
  type InboundPayload,
  type OutboundMessage,
  type SendOptions,
  type SentMessage,
} from "./types";

/** Graph API 版本：升級時改這裡。 */
export const WHATSAPP_GRAPH_VERSION = "v23.0";
export const WHATSAPP_GRAPH_API = `https://graph.facebook.com/${WHATSAPP_GRAPH_VERSION}`;

export const WA_TEXT_MAX = 4096;
export const WA_BODY_MAX = 1024;
export const WA_HEADER_MAX = 60;
export const WA_FOOTER_MAX = 60;
export const WA_BUTTON_TITLE_MAX = 20;
export const WA_BUTTONS_MAX = 3;
export const WA_BUTTON_ID_MAX = 256;
export const WA_LIST_ROWS_MAX = 10;
export const WA_LIST_ROW_TITLE_MAX = 24;
export const WA_CAPTION_MAX = 1024;

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

function clip(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, Math.max(0, max - 1))}…` : s;
}

// ---------------------------------------------------------------------------
// 驗證
// ---------------------------------------------------------------------------

/** GET 訂閱驗證：對上回 challenge，對不上回 null。 */
export function whatsappChallenge(params: URLSearchParams, verifyToken: string): string | null {
  if (params.get("hub.mode") !== "subscribe") return null;
  const given = new TextEncoder().encode(params.get("hub.verify_token") ?? "");
  const expected = new TextEncoder().encode(verifyToken);
  if (!timingSafeEqual(given, expected)) return null;
  return params.get("hub.challenge");
}

export { verifyWhatsAppSignature } from "./signature";

// ---------------------------------------------------------------------------
// 事件解析
// ---------------------------------------------------------------------------

type WaMessage = {
  from?: string;
  id?: string;
  timestamp?: string;
  type?: string;
  group_id?: string;
  context?: { from?: string; id?: string };
  text?: { body?: string };
  image?: { id?: string; mime_type?: string; caption?: string };
  document?: { id?: string; mime_type?: string; filename?: string; caption?: string };
  interactive?: {
    type?: string;
    button_reply?: { id?: string; title?: string };
    list_reply?: { id?: string; title?: string };
  };
  button?: { payload?: string; text?: string };
};

type WaValue = {
  messaging_product?: string;
  metadata?: { phone_number_id?: string };
  contacts?: { wa_id?: string; profile?: { name?: string } }[];
  messages?: WaMessage[];
};

function replyPayload(id: string, title: string): InboundPayload {
  if (id.startsWith(QUICK_REPLY_PREFIX)) return { kind: "text", text: id.slice(QUICK_REPLY_PREFIX.length) || title };
  return { kind: "button", payload: id };
}

function imagePayload(image: WaMessage["image"]): InboundPayload {
  if (!image?.id) return { kind: "unsupported", what: "image" };
  return {
    kind: "media",
    media: { id: image.id, ...(image.mime_type ? { mime: image.mime_type } : {}) },
    ...(image.caption ? { caption: image.caption } : {}),
  };
}

function documentPayload(doc: WaMessage["document"]): InboundPayload {
  if (!doc?.id) return { kind: "unsupported", what: "document" };
  return {
    kind: "media",
    media: {
      id: doc.id,
      ...(doc.mime_type ? { mime: doc.mime_type } : {}),
      ...(doc.filename ? { fileName: doc.filename } : {}),
    },
    ...(doc.caption ? { caption: doc.caption } : {}),
  };
}

function interactivePayload(interactive: WaMessage["interactive"]): InboundPayload {
  const r = interactive?.button_reply ?? interactive?.list_reply;
  if (!r?.id) return { kind: "unsupported", what: "interactive" };
  return replyPayload(r.id, r.title ?? "");
}

function payloadOf(m: WaMessage): InboundPayload {
  switch (m.type) {
    case "text":
      return { kind: "text", text: m.text?.body ?? "" };
    case "image":
      return imagePayload(m.image);
    case "document":
      return documentPayload(m.document);
    case "interactive":
      return interactivePayload(m.interactive);
    case "button":
      // template 訊息的 quick reply 按鈕：當成使用者打了那段字。
      return { kind: "text", text: m.button?.text ?? m.button?.payload ?? "" };
    default:
      return { kind: "unsupported", what: m.type };
  }
}

/** 一則 WhatsApp 訊息 → InboundEvent；缺寄件人或訊息 id 回 null。 */
function toInboundEvent(m: WaMessage, names: ReadonlyMap<string, string>): InboundEvent | null {
  if (!m.from || !m.id) return null;
  const ts = Number(m.timestamp);
  const name = names.get(m.from);
  const isGroup = Boolean(m.group_id);
  return {
    ...payloadOf(m),
    provider: "whatsapp",
    eventId: m.id,
    messageId: m.id,
    externalUserId: m.from,
    ...(name ? { displayName: name } : {}),
    isGroup,
    ...(isGroup && m.group_id ? { group: { id: m.group_id, type: "group" as const } } : {}),
    ...(m.context?.id ? { quotedMessageId: m.context.id } : {}),
    receivedAt: Number.isFinite(ts) && ts > 0 ? ts * 1000 : Date.now(),
  } as InboundEvent;
}

type WaChange = { field?: string; value?: WaValue };

/** 一個 change 裡的訊息；不是 messages、或是別支號碼的就回空陣列。 */
function changeEvents(change: WaChange, phoneNumberId?: string): InboundEvent[] {
  const v = change.value;
  if (change.field !== "messages" || !v) return [];
  const ownNumber = v.metadata?.phone_number_id;
  if (phoneNumberId && ownNumber && ownNumber !== phoneNumberId) return [];
  const names = new Map((v.contacts ?? []).map((c) => [c.wa_id ?? "", c.profile?.name ?? ""]));
  const out: InboundEvent[] = [];
  for (const m of v.messages ?? []) {
    const event = toInboundEvent(m, names);
    if (event) out.push(event);
  }
  return out;
}

/**
 * webhook body → 事件。只收我們這支號碼（phoneNumberId 有給就比對）的 messages；
 * statuses（sent／delivered／read）略過。
 */
export function parseWhatsAppWebhook(raw: string, phoneNumberId?: string): InboundEvent[] {
  let body: { object?: string; entry?: { changes?: WaChange[] }[] };
  try {
    body = JSON.parse(raw) as typeof body;
  } catch {
    return [];
  }
  if (body.object !== "whatsapp_business_account") return [];
  const out: InboundEvent[] = [];
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) out.push(...changeEvents(change, phoneNumberId));
  }
  return out;
}

// ---------------------------------------------------------------------------
// 訊息組裝
// ---------------------------------------------------------------------------

export type WaPayload = Record<string, unknown>;
export type BuiltWaMessage = { payload: WaPayload; snippet: string; cardId?: string };

function textPayload(text: string): WaPayload {
  return { type: "text", text: { body: clip(text, WA_TEXT_MAX), preview_url: false } };
}

function buttonsPayload(
  body: string,
  buttons: { id: string; title: string }[],
  header?: string,
  footer?: string,
): WaPayload {
  return {
    type: "interactive",
    interactive: {
      type: "button",
      ...(header ? { header: { type: "text", text: clip(header, WA_HEADER_MAX) } } : {}),
      body: { text: clip(body || "-", WA_BODY_MAX) },
      ...(footer ? { footer: { text: clip(footer, WA_FOOTER_MAX) } } : {}),
      action: {
        buttons: buttons.slice(0, WA_BUTTONS_MAX).map((b) => ({
          type: "reply",
          reply: { id: b.id.slice(0, WA_BUTTON_ID_MAX), title: clip(b.title, WA_BUTTON_TITLE_MAX) },
        })),
      },
    },
  };
}

/** 一張確認卡 → 一則互動訊息（確認／修改／取消；批次卡只有「全部確認」）。 */
export function cardToWhatsApp(card: ConfirmCard, locale: Locale): WaPayload {
  const s = botStrings(locale);
  const body = cardToText({ title: "", rows: card.rows, ruleHint: card.ruleHint }, locale).trim();
  const buttons: { id: string; title: string }[] = [];
  if (card.actions.includes("all")) {
    buttons.push({ id: cardPayload(card.cardId, "all"), title: card.confirmLabel ?? s.confirmAll(card.rows.length) });
  }
  if (card.actions.includes("confirm")) {
    buttons.push({ id: cardPayload(card.cardId, "confirm"), title: card.confirmLabel ?? s.confirm });
  }
  if (card.actions.includes("edit")) buttons.push({ id: cardPayload(card.cardId, "edit"), title: s.edit });
  if (card.actions.includes("cancel")) buttons.push({ id: cardPayload(card.cardId, "cancel"), title: s.cancel });
  return buttonsPayload(body || card.title, buttons, card.title, `${card.orgName} · ${card.actorName}`);
}

/** 快速選項：≤ 3 個用按鈕；更多就列成文字（WhatsApp 按鈕最多 3 顆）。 */
function textWithOptions(text: string, options: { label: string; text: string }[]): BuiltWaMessage[] {
  if (options.length === 0) return [{ payload: textPayload(text), snippet: text }];
  if (options.length > WA_BUTTONS_MAX) {
    const numbered = options.map((o, i) => `${i + 1}. ${o.label}`).join("\n");
    const listed = `${text}\n\n${numbered}`;
    return [{ payload: textPayload(listed), snippet: listed }];
  }
  const buttons = options.map((o) => ({ id: `${QUICK_REPLY_PREFIX}${o.text}`, title: o.label }));
  if (text.length <= WA_BODY_MAX) return [{ payload: buttonsPayload(text, buttons), snippet: text }];
  // 太長放不進按鈕訊息的 body：先送全文，再送一則只有最後一段的按鈕訊息。
  const tail = text.split("\n").findLast(Boolean) ?? text;
  return [
    { payload: textPayload(text), snippet: text },
    { payload: buttonsPayload(clip(tail, WA_BODY_MAX), buttons), snippet: tail },
  ];
}

function orgPickerPayload(text: string, orgs: { id: string; name: string; current?: boolean }[], locale: Locale) {
  if (orgs.length <= WA_BUTTONS_MAX) {
    return buttonsPayload(
      text,
      orgs.map((o) => ({ id: orgPayload(o.id), title: o.name })),
    );
  }
  return {
    type: "interactive",
    interactive: {
      type: "list",
      body: { text: clip(text, WA_BODY_MAX) },
      action: {
        button: clip(locale === "en" ? "Organizations" : "選組織", WA_BUTTON_TITLE_MAX),
        sections: [
          {
            title: clip(locale === "en" ? "Organizations" : "組織", WA_LIST_ROW_TITLE_MAX),
            rows: orgs.slice(0, WA_LIST_ROWS_MAX).map((o) => ({
              id: orgPayload(o.id),
              title: clip(o.name, WA_LIST_ROW_TITLE_MAX),
              ...(o.current ? { description: locale === "en" ? "Current" : "目前" } : {}),
            })),
          },
        ],
      },
    },
  };
}

function outboundImage(link: string, caption: string): WaPayload {
  return { type: "image", image: { link, caption: clip(caption, WA_CAPTION_MAX) } };
}

function buildOne(m: OutboundMessage, locale: Locale): BuiltWaMessage[] {
  switch (m.type) {
    case "text":
      return m.text.trim() ? textWithOptions(clip(m.text, WA_TEXT_MAX), m.quickReplies ?? []) : [];
    case "cards":
      return m.cards.map((card) => ({
        payload: cardToWhatsApp(card, locale),
        snippet: cardToText(card, locale),
        cardId: card.cardId,
      }));
    case "orgPicker":
      return [{ payload: orgPickerPayload(m.text, m.orgs, locale), snippet: m.text }];
    case "help":
      return [
        ...m.cards.map((c) => {
          const caption = `${c.title}\n${c.body}`;
          return { payload: outboundImage(c.imageUrl, caption), snippet: caption };
        }),
        { payload: textPayload(m.commandsText), snippet: m.commandsText },
      ];
    case "table":
      return textWithOptions(clip(tableToText(m.table), WA_TEXT_MAX), m.quickReplies ?? []);
    case "links":
      return m.links.length > 0 ? textWithOptions(clip(linksToText(m.links), WA_TEXT_MAX), m.quickReplies ?? []) : [];
    case "done": {
      const text = clip(m.receipts.map(receiptToText).join("\n\n"), WA_TEXT_MAX);
      return text.trim() ? [{ payload: textPayload(text), snippet: text }] : [];
    }
  }
}

export function buildWhatsAppMessages(msgs: readonly OutboundMessage[], locale: Locale): BuiltWaMessage[] {
  return msgs.flatMap((m) => buildOne(m, locale));
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export function createWhatsAppAdapter(
  cfg: WhatsAppConfig,
  fetchImpl: FetchLike = (u, i) => fetch(u, i),
): ChannelAdapter {
  const auth = { Authorization: `Bearer ${cfg.accessToken}` };

  async function postMessage(body: Record<string, unknown>): Promise<unknown> {
    const res = await fetchImpl(`${WHATSAPP_GRAPH_API}/${encodeURIComponent(cfg.phoneNumberId)}/messages`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", ...body }),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`WhatsApp API ${res.status}: ${text.slice(0, 300)}`);
    try {
      return text ? (JSON.parse(text) as unknown) : {};
    } catch {
      return {};
    }
  }

  return {
    provider: "whatsapp",

    verify: (headers, rawBody) =>
      verifyWhatsAppSignature(cfg.appSecret, rawBody, headers.get("x-hub-signature-256")),

    parse: (raw) => parseWhatsAppWebhook(raw, cfg.phoneNumberId),

    async downloadMedia(media: InboundMedia, maxBytes: number) {
      const metaRes = await fetchImpl(`${WHATSAPP_GRAPH_API}/${encodeURIComponent(media.id)}`, { headers: auth });
      if (!metaRes.ok) throw new Error(`WhatsApp media ${metaRes.status}: ${(await metaRes.text()).slice(0, 300)}`);
      const meta: { url?: string; mime_type?: string; file_size?: number } = await metaRes.json();
      if (!meta.url) throw new Error("WhatsApp media has no url.");
      if (typeof meta.file_size === "number" && meta.file_size > maxBytes) return null;
      const res = await fetchImpl(meta.url, { headers: auth });
      if (!res.ok) throw new Error(`WhatsApp media download ${res.status}`);
      const bytes = await readBodyLimited(res, maxBytes);
      if (!bytes) return null;
      const mime = (meta.mime_type ?? media.mime ?? res.headers.get("content-type") ?? "application/octet-stream")
        .split(";")[0]
        .trim();
      return { bytes, mime, ...(media.fileName ? { fileName: media.fileName } : {}) };
    },

    async send(to: string, msgs: readonly OutboundMessage[], opts: SendOptions = {}): Promise<SentMessage[]> {
      const sent: SentMessage[] = [];
      for (const b of buildWhatsAppMessages(msgs, opts.locale ?? "zh-TW")) {
        const res = (await postMessage({ recipient_type: "individual", to, ...b.payload })) as {
          messages?: { id?: string }[];
        };
        const id = res.messages?.[0]?.id;
        if (id) sent.push({ externalId: id, snippet: b.snippet, ...(b.cardId ? { cardId: b.cardId } : {}) });
      }
      return sent;
    },

    async showTyping(_to: string, opts: { messageId?: string } = {}) {
      if (!opts.messageId) return;
      try {
        await postMessage({ status: "read", message_id: opts.messageId, typing_indicator: { type: "text" } });
      } catch (err) {
        console.warn("[channels/whatsapp] typing indicator failed", err);
      }
    },
  };
}

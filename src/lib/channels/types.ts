/**
 * 聊天轉接層的平台無關型別。LINE 與 WhatsApp 的 adapter 都把 webhook 轉成 InboundEvent，
 * 把 OutboundMessage 轉成各自的訊息格式；dispatcher 只認這裡的型別。
 */
import type { ChatProvider } from "@/db/chat";
import type { Locale } from "@/i18n/config";

export type { ChatProvider } from "@/db/chat";

export type InboundMedia = {
  /** 平台上的檔案 id（LINE message id、WhatsApp media id）。 */
  id: string;
  mime?: string;
  fileName?: string;
  size?: number;
};

export type InboundPayload =
  | { kind: "text"; text: string }
  | { kind: "media"; media: InboundMedia; caption?: string }
  /** 按下我們送出的按鈕（確認卡 `c:<id>:<action>`、組織選單 `o:<orgId>`）。 */
  | { kind: "button"; payload: string }
  /** 加好友（LINE follow）。WhatsApp 沒有這個事件。 */
  | { kind: "follow" }
  /** 貼圖、影片、語音、位置……看不懂的都是這個。 */
  | { kind: "unsupported"; what?: string };

export type InboundEvent = InboundPayload & {
  provider: ChatProvider;
  /** 去重用：LINE webhookEventId、WhatsApp message id。 */
  eventId: string;
  /** 平台訊息 id（記 chat_message_refs、被引用時對回來）；follow／postback 沒有。 */
  messageId?: string;
  /** LINE userId、WhatsApp wa_id。 */
  externalUserId: string;
  displayName?: string;
  /** 群組或多人聊天室裡來的（第一版不支援，只回「請私訊我」）。 */
  isGroup: boolean;
  /** 群組 id 與種類（LINE 離開群組用）。 */
  group?: { id: string; type: "group" | "room" };
  /** LINE 的一次性回覆憑證（1 分鐘內有效）。 */
  replyToken?: string;
  /** 這則訊息引用（回覆）的平台訊息 id：LINE quotedMessageId、WhatsApp context.id。 */
  quotedMessageId?: string;
  /** 平台給的事件時間（毫秒）。 */
  receivedAt: number;
};

/** 快速選項：LINE quick reply（點了等於使用者打那段字）、WhatsApp 回覆按鈕。 */
export type QuickReply = { label: string; text: string };

export type ConfirmCardRow = { label: string; value: string; note?: string };

export type ConfirmAction = "confirm" | "edit" | "cancel" | "all";

export type ConfirmCard = {
  /** chat_cards.id；按鈕 payload 是 `c:<cardId>:<action>`。 */
  cardId: string;
  title: string;
  orgName: string;
  actorName: string;
  rows: ConfirmCardRow[];
  ruleHint?: string;
  /** 紅色等級以外的寫入一律 confirm／edit／cancel；批次卡只有 all。 */
  actions: ConfirmAction[];
  /** 確認鍵的字（一般「確認」，批次「全部確認（3 筆）」）。 */
  confirmLabel?: string;
};

/** 卡片上的按鈕：`text` 是按下去等於使用者打那段字；`url` 是開網頁（絕對 https 網址）。 */
export type ChatButton = { label: string; text: string } | { label: string; url: string };

/** 說明卡的一張（圖片是絕對網址，LINE／Meta 伺服器不登入也拿得到）。 */
export type HelpCard = { imageUrl: string; title: string; body: string; buttons: ChatButton[] };

/** Markdown 表格拆出來的資料（儲存格已轉純文字、遮過帳號）。 */
export type ChatTable = {
  title?: string;
  headers: string[];
  rows: string[][];
  /** 每欄是不是數字欄（LINE 靠右對齊）。 */
  numeric: boolean[];
};

/** 指向 internal 的連結（LINE 做成按鈕，WhatsApp 寫成文字網址）。 */
export type ChatLink = { label: string; url: string };

/** 寫入成功後的收據卡。 */
export type DoneReceipt = {
  title: string;
  rows: { label: string; value: string }[];
  /** 「在 internal 查看」連到那一筆。 */
  link?: ChatLink;
};

export type OutboundMessage =
  | { type: "text"; text: string; quickReplies?: QuickReply[] }
  /** 一批確認卡（LINE 一張 Flex／輪播、WhatsApp 每張一則互動訊息）。 */
  | { type: "cards"; cards: ConfirmCard[] }
  /** 組織選單：按下去回 `o:<orgId>`。 */
  | { type: "orgPicker"; text: string; orgs: { id: string; name: string; current?: boolean }[] }
  /** 說明卡組（LINE carousel、WhatsApp 每張一則圖片＋最後一則列出指令）。 */
  | { type: "help"; altText: string; cards: HelpCard[]; commandsText: string }
  /** AI 回覆裡的表格（LINE Flex bubble、WhatsApp「欄：值」文字）。 */
  | { type: "table"; table: ChatTable; quickReplies?: QuickReply[] }
  /** AI 回覆裡指向 internal 的連結（LINE 一個小 bubble、WhatsApp 文字網址）。 */
  | { type: "links"; links: ChatLink[]; quickReplies?: QuickReply[] }
  /** 確認卡寫入成功後的收據（一張以上）。 */
  | { type: "done"; receipts: DoneReceipt[] };

/** 送出去的一則平台訊息（記 chat_message_refs 用）。 */
export type SentMessage = { externalId: string; snippet: string; cardId?: string };

export type SendOptions = {
  /** LINE：還能用就用回覆（不算則數），不能用就 push。 */
  replyToken?: string;
  /** replyToken 對應的訊息時間（毫秒）；超過 50 秒就不用它。 */
  replyTokenAt?: number;
  /** 按鈕上的字（確認／修改／取消）用哪個語言。 */
  locale?: Locale;
};

export type DownloadedMedia = { bytes: Uint8Array; mime: string; fileName?: string };

export interface ChannelAdapter {
  readonly provider: ChatProvider;
  /**
   * AI 回覆要不要拆成表格、連結按鈕（LINE Flex 才畫得出來）。false：照舊一則純文字，
   * 表格寫成「欄：值」、連結寫成網址（WhatsApp）。
   */
  readonly richReplies?: boolean;
  /** 用原始 body bytes 驗簽（constant-time 比較）。 */
  verify(headers: Headers, rawBody: Uint8Array): Promise<boolean>;
  /** webhook body → 我們處理得了的事件（狀態回報、已讀之類的直接略過）。 */
  parse(rawBody: string): InboundEvent[];
  /** 下載檔案；超過 maxBytes 回 null（不整個讀進記憶體）。 */
  downloadMedia(media: InboundMedia, maxBytes: number): Promise<DownloadedMedia | null>;
  send(to: string, msgs: OutboundMessage[], opts?: SendOptions): Promise<SentMessage[]>;
  /** 「處理中」提示：LINE loading 動畫、WhatsApp 已讀＋輸入中（要帶對方那則訊息的 id）。 */
  showTyping(to: string, opts?: { messageId?: string }): Promise<void>;
  leaveGroup?(group: { id: string; type: "group" | "room" }): Promise<void>;
  /** 平台上的顯示名稱（LINE 要另外查 profile；查不到回 null）。 */
  profileName?(externalUserId: string): Promise<string | null>;
}

/** 確認卡按鈕的 payload。 */
export function cardPayload(cardId: string, action: ConfirmAction): string {
  return `c:${cardId}:${action}`;
}

export function parseCardPayload(payload: string): { cardId: string; action: ConfirmAction } | null {
  const m = /^c:([0-9a-z]{4,32}):(confirm|edit|cancel|all)$/.exec(payload);
  return m ? { cardId: m[1], action: m[2] as ConfirmAction } : null;
}

/** 組織選單按鈕的 payload。 */
export function orgPayload(orgId: string): string {
  return `o:${orgId}`;
}

export function parseOrgPayload(payload: string): string | null {
  const m = /^o:([\w-]{1,64})$/.exec(payload);
  return m ? m[1] : null;
}

/** WhatsApp 的快速選項按鈕：id 帶原文，按下去當成使用者打了那段字。 */
export const QUICK_REPLY_PREFIX = "q:";

/**
 * 前哨 Worker（workers/webhook-ack）驗過簽後直接放進佇列的原始 webhook：body 是原始 bytes 的 base64，
 * headers 只帶驗簽要的那一個。處理端（/api/channels/process）重新驗簽、parse、去重，再拆成 event job。
 */
export type RawWebhookJob = {
  kind: "raw";
  provider: ChatProvider;
  body: string;
  headers: Record<string, string>;
};

/** 佇列訊息：webhook 收到的事件、或某個人的 flush 排程。 */
export type ChannelJob =
  | { kind: "event"; event: InboundEvent }
  | {
      kind: "flush";
      provider: ChatProvider;
      identityId: string;
      /** 排這次 flush 時暫存區最新一則的時間（ISO）；之後又有新訊息就交給較晚那次。 */
      anchor: string;
      /** 最後一則的回覆憑證與時間（LINE）。 */
      replyToken?: string;
      replyTokenAt?: number;
      /** 搶不到鎖重排了幾次（防止無限重排）。 */
      attempt?: number;
    };

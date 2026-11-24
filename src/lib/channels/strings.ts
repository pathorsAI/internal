/**
 * bot 回覆的固定文案（zh-TW＋en）。刻意不放 next-intl messages：bot 跑在 queue consumer 裡，
 * 沒有 request 的語系 cookie，而且這些字只有 bot 用。
 */
import type { Locale } from "@/i18n/config";

type Strings = {
  groupNotSupported: string;
  notLinked: (settingsUrl: string) => string;
  welcome: (settingsUrl: string) => string;
  welcomeBack: (userName: string, orgName: string) => string;
  linked: (userName: string, orgName: string) => string;
  bindInvalid: string;
  bindExpired: string;
  bindUsed: string;
  bindTaken: string;
  noActiveOrg: string;
  notMember: string;
  noOrgs: string;
  pickOrg: string;
  switched: (orgName: string) => string;
  newConversation: string;
  unlinked: string;
  help: (settingsUrl: string) => string;
  unsupported: string;
  mediaTooLarge: (url: string) => string;
  mediaType: string;
  mediaFailed: string;
  cardGone: string;
  cardNotYours: string;
  editPrompt: string;
  busy: string;
  error: string;
  aiNotConfigured: string;
  modelFailed: string;
  tooManyRounds: string;
  emptyReply: string;
  cancelled: string;
  failed: (error: string) => string;
  quoted: (snippet: string) => string;
  quotedAttachment: (fileName: string) => string;
  quotedCard: (desc: string) => string;
  quotedMissing: string;
  confirm: string;
  edit: string;
  cancel: string;
  confirmAll: (n: number) => string;
  batchTitle: (n: number) => string;
  ruleHintLabel: string;
  inferredNote: string;
  moreRows: (n: number) => string;
};

const zh: Strings = {
  groupNotSupported: "群組裡我不處理帳務，請私訊我。",
  notLinked: (url) => `還沒綁定 internal 帳號。請到 ${url} 產生綁定碼，再把「綁定 123456」傳給我。`,
  welcome: (url) =>
    `你好，我是 Pathors Internal 的帳務助理。先到 ${url} 產生綁定碼，再把「綁定 123456」傳給我就能開始用。`,
  welcomeBack: (user, org) => `${user} 你好，目前操作的是 ${org}。直接傳收據照片或打字問我。`,
  linked: (user, org) => `已綁定 ${user} · ${org}。直接傳收據照片或打字問我；傳「說明」看我能做什麼。`,
  bindInvalid: "綁定碼不對，請到 internal 重新產生一組。",
  bindExpired: "綁定碼過期了（10 分鐘內有效），請到 internal 重新產生一組。",
  bindUsed: "這組綁定碼已經用過了，請到 internal 重新產生一組。",
  bindTaken: "這個聊天帳號已經綁給另一位使用者，請先在那個帳號的設定頁解除綁定。",
  noActiveOrg: "請先選要操作的組織。",
  notMember: "你已不在這個組織，請切換組織。",
  noOrgs: "你目前不在任何組織，請先請管理者邀請你。",
  pickOrg: "要切換到哪個組織？",
  switched: (org) => `已切換到 ${org}。`,
  newConversation: "好，開一段新對話。",
  unlinked: "已解除綁定。之後要用請到 internal 重新綁定。",
  help: (url) =>
    [
      "直接傳收據、發票、匯款水單的照片或 PDF，或打字問我帳務的事。寫入前都會先給你一張確認卡。",
      "指令：",
      "・切換組織",
      "・新對話",
      "・解除綁定",
      `設定：${url}`,
    ].join("\n"),
  unsupported: "我目前看得懂文字、照片和 PDF。",
  mediaTooLarge: (url) => `檔案超過 10 MB，請到網頁上傳：${url}`,
  mediaType: "我只收照片和 PDF。",
  mediaFailed: "檔案下載失敗，請再傳一次。",
  cardGone: "這張卡已過期或已經處理過了。",
  cardNotYours: "這張卡不是你開的，不能按。",
  editPrompt: "要改哪裡？直接打字告訴我。",
  busy: "上一題還在處理，請等一下再按一次。",
  error: "出了點問題，請再試一次。",
  aiNotConfigured: "AI 助理還沒設定好，請通知管理者。",
  modelFailed: "AI 暫時沒有回應，請稍後再試。",
  tooManyRounds: "這題太複雜了，請拆成小一點的問題再問一次。",
  emptyReply: "好了。",
  cancelled: "已取消。",
  failed: (e) => (e ? `沒有成功：${e}` : "沒有成功，請到網頁確認。"),
  quoted: (s) => `（回覆先前的訊息：「${s}」）`,
  quotedAttachment: (f) => `（回覆先前傳的檔案：${f}）`,
  quotedCard: (d) => `（修改先前的確認卡：${d}）`,
  quotedMissing: "（回覆了一則找不到的舊訊息）",
  confirm: "確認",
  edit: "修改",
  cancel: "取消",
  confirmAll: (n) => `全部確認（${n} 筆）`,
  batchTitle: (n) => `共 ${n} 筆待確認`,
  ruleHintLabel: "規則",
  inferredNote: "推測",
  moreRows: (n) => `還有 ${n} 個欄位，請到網頁看`,
};

const en: Strings = {
  groupNotSupported: "I don't handle bookkeeping in groups. Please message me directly.",
  notLinked: (url) => `This chat isn't linked yet. Generate a code at ${url}, then send me "綁定 123456".`,
  welcome: (url) =>
    `Hi, I'm the Pathors Internal assistant. Generate a link code at ${url}, then send me "綁定 123456" to start.`,
  welcomeBack: (user, org) => `Hi ${user}, you're working in ${org}. Send a receipt photo or ask me anything.`,
  linked: (user, org) => `Linked ${user} · ${org}. Send a receipt photo or ask me; send "help" to see what I can do.`,
  bindInvalid: "That code doesn't match. Generate a new one in Internal.",
  bindExpired: "That code has expired (valid for 10 minutes). Generate a new one in Internal.",
  bindUsed: "That code was already used. Generate a new one in Internal.",
  bindTaken: "This chat account is linked to another user. Unlink it there first.",
  noActiveOrg: "Pick an organization first.",
  notMember: "You're no longer in this organization. Switch to another one.",
  noOrgs: "You're not in any organization yet. Ask an admin to invite you.",
  pickOrg: "Which organization?",
  switched: (org) => `Switched to ${org}.`,
  newConversation: "OK, starting a new conversation.",
  unlinked: "Unlinked. Link again from Internal whenever you need me.",
  help: (url) =>
    [
      "Send photos or PDFs of receipts, invoices or transfer slips, or ask me about the books. I always show a confirmation card before writing anything.",
      "Commands:",
      "- switch org",
      "- new chat",
      "- unlink",
      `Settings: ${url}`,
    ].join("\n"),
  unsupported: "I can read text, photos and PDFs.",
  mediaTooLarge: (url) => `The file is over 10 MB. Please upload it on the web: ${url}`,
  mediaType: "I only accept photos and PDFs.",
  mediaFailed: "Couldn't download the file. Please send it again.",
  cardGone: "This card has expired or was already handled.",
  cardNotYours: "This card isn't yours.",
  editPrompt: "What should I change? Just tell me.",
  busy: "Still working on your last request. Tap again in a moment.",
  error: "Something went wrong. Please try again.",
  aiNotConfigured: "The AI assistant isn't configured yet. Please tell an admin.",
  modelFailed: "The AI isn't responding right now. Please try again later.",
  tooManyRounds: "That was too much for one go. Please split it into smaller questions.",
  emptyReply: "Done.",
  cancelled: "Cancelled.",
  failed: (e) => (e ? `That didn't work: ${e}` : "That didn't work. Please check on the web."),
  quoted: (s) => `(Replying to an earlier message: "${s}")`,
  quotedAttachment: (f) => `(Replying to an earlier file: ${f})`,
  quotedCard: (d) => `(Editing an earlier confirmation card: ${d})`,
  quotedMissing: "(Replying to an old message I can't find)",
  confirm: "Confirm",
  edit: "Edit",
  cancel: "Cancel",
  confirmAll: (n) => `Confirm all (${n})`,
  batchTitle: (n) => `${n} items to confirm`,
  ruleHintLabel: "Rule",
  inferredNote: "inferred",
  moreRows: (n) => `${n} more fields on the web`,
};

export function botStrings(locale: Locale): Strings {
  return locale === "en" ? en : zh;
}

export type BotStrings = Strings;

// ---------------------------------------------------------------------------
// 指令：合併後的文字「整則就是指令」才算。兩種語言的寫法都認，不看使用者語系。
// ---------------------------------------------------------------------------

export type BotCommand =
  | { kind: "bind"; code: string }
  | { kind: "switchOrg" }
  | { kind: "newConversation" }
  | { kind: "unlink" }
  | { kind: "help" };

/** 全形數字、全形空白 → 半形，去頭尾空白。 */
function normalize(s: string): string {
  return s
    .replaceAll(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replaceAll(/[　\s]+/g, " ")
    .trim();
}

/** 「綁定 123456」：容許全形空白、全形數字、沒有空白、`綁定：123456`。 */
export function parseBindCommand(text: string): string | null {
  const m = /^(?:綁定|绑定|bind|link)\s*[:：]?\s*(\d{6})$/i.exec(normalize(text));
  return m ? m[1] : null;
}

const COMMANDS: { kind: Exclude<BotCommand["kind"], "bind">; words: string[] }[] = [
  { kind: "switchOrg", words: ["切換組織", "切换组织", "換組織", "switch org", "switch organization"] },
  { kind: "newConversation", words: ["新對話", "新对话", "new chat", "new conversation"] },
  { kind: "unlink", words: ["解除綁定", "解除绑定", "unlink"] },
  { kind: "help", words: ["說明", "说明", "幫助", "help", "?", "？"] },
];

export function parseCommand(text: string): BotCommand | null {
  const code = parseBindCommand(text);
  if (code) return { kind: "bind", code };
  const t = normalize(text).toLowerCase().replace(/^\//, "");
  for (const c of COMMANDS) if (c.words.includes(t)) return { kind: c.kind };
  return null;
}

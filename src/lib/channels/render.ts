/**
 * 把站內 AI 的輸出轉成聊天看得懂的樣子（純函式，好測）：
 * - Markdown → 純文字：去粗體、表格轉「欄：值」、站內連結轉絕對網址、截長度、帳號遮成末四碼。
 * - runTurn 送出的事件 → 要送的文字＋待確認的工具呼叫。
 * - 待確認的 UiToolCall → ConfirmCard（參數轉成中文標籤列）。
 */
import type { Locale } from "@/i18n/config";
import { parseOptions } from "@/lib/ai/options";
import type { ChatErrorCode, ChatEvent, UiToolCall, UiToolStatus } from "@/lib/ai/types";
import { botStrings } from "./strings";
import type { ConfirmCard, ConfirmCardRow, QuickReply } from "./types";

/** 一則聊天文字最多幾個字（LINE 5000、WhatsApp 4096，留餘裕）。 */
export const MAX_CHAT_TEXT = 3800;

/** 確認卡最多列幾個欄位、每個值最多幾個字。 */
export const MAX_CARD_ROWS = 12;
export const MAX_CARD_VALUE = 80;

function ellipsis(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, Math.max(0, max - 1))}…` : s;
}

// ---------------------------------------------------------------------------
// 遮罩
// ---------------------------------------------------------------------------

/** 帳號類欄位：銀行帳號、卡號、IBAN、身分證字號。 */
const SENSITIVE_KEY = /(account(number|no)|bankaccount(number)?$|iban|swift|cardnumber|nationalid|routing|passport)/i;

/** 一串號碼只留末四碼（`•••• 1234`）。不是號碼（沒有至少 5 個數字）就原樣回傳。 */
export function maskTail(value: string): string {
  const digits = value.replaceAll(/\D/g, "");
  if (digits.length < 5) return value;
  return `•••• ${value.replaceAll(/[\s-]/g, "").slice(-4)}`;
}

/** 文字裡看起來像帳號的長串數字（10 碼以上，可夾空白或 -）遮成末四碼。 */
export function maskAccountNumbers(text: string): string {
  return text.replaceAll(/\b\d(?:[\s-]?\d){9,}\b/g, (m) => maskTail(m));
}

// ---------------------------------------------------------------------------
// Markdown → 聊天純文字
// ---------------------------------------------------------------------------

function absolutize(href: string, baseUrl: string): string {
  if (href.startsWith("/")) return `${baseUrl}${href}`;
  return href;
}

function splitRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
}

const SEPARATOR_CELL = /^:?-{2,}:?$/;

/**
 * 表格分隔線（`|---|:--:|`）。逐格判斷而不是一條大 regex：
 * 原本 `\s*` 夾在可重疊的量詞間，很長的惡意輸入會超線性回溯。
 */
function isTableSeparator(line: string): boolean {
  let t = line.trim();
  if (t.startsWith("|")) t = t.slice(1);
  if (t.endsWith("|")) t = t.slice(0, -1);
  return t.split("|").every((cell) => SEPARATOR_CELL.test(cell.trim()));
}

function isTableStart(lines: readonly string[], i: number): boolean {
  return lines[i].trim().startsWith("|") && i + 1 < lines.length && isTableSeparator(lines[i + 1]);
}

function tableRowText(line: string, headers: readonly string[]): string {
  return splitRow(line)
    .map((c, k) => {
      if (!c) return "";
      const header = headers[k] || `#${k + 1}`;
      return `${header}：${c}`;
    })
    .filter(Boolean)
    .join("\n");
}

/** 表格（header＋分隔線＋列）轉成「欄：值」行，列之間空一行。 */
function tablesToLines(lines: string[]): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    if (!isTableStart(lines, i)) {
      out.push(lines[i]);
      i += 1;
      continue;
    }
    const headers = splitRow(lines[i]);
    const rows: string[] = [];
    let j = i + 2;
    while (j < lines.length && lines[j].trim().startsWith("|")) {
      rows.push(tableRowText(lines[j], headers));
      j += 1;
    }
    out.push(rows.join("\n\n"));
    i = j;
  }
  return out;
}

function isSpace(ch: string | undefined): boolean {
  return ch !== undefined && /\s/.test(ch);
}

/** `replaceLinks` 掃描時記住的失敗位置，讓每一格最多只被看一次。 */
type LinkScan = { text: string; failedUntil: number; noQuoteFrom: number };

/**
 * `[字](網址)` 或 `[字](網址 "標題")` 從 `]`（`close`）之後比對；成功回傳結尾位置與網址。
 * 等同 `\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)`，但用掃描：
 * 網址掃到 j 停下之後的結果只跟 j 之後的字有關，所以失敗時記下 j，之後網址起點 ≤ j 的嘗試直接判失敗。
 */
function matchLinkTail(scan: LinkScan, close: number): { end: number; href: string } | null {
  const { text } = scan;
  const hrefStart = close + 2;
  if (text[close + 1] !== "(" || hrefStart <= scan.failedUntil) return null;
  let j = hrefStart;
  while (j < text.length && text[j] !== ")" && !isSpace(text[j])) j += 1;
  const m = j === hrefStart ? null : linkEnd(scan, j);
  if (!m) {
    scan.failedUntil = j;
    return null;
  }
  return { end: m, href: text.slice(hrefStart, j) };
}

/** 網址在 j 結束之後：`)`，或 `空白"標題")`。回傳結尾位置。 */
function linkEnd(scan: LinkScan, j: number): number | null {
  const { text } = scan;
  if (text[j] === ")") return j + 1;
  if (!isSpace(text[j])) return null;
  let k = j;
  while (isSpace(text[k])) k += 1;
  if (text[k] !== '"' || k >= scan.noQuoteFrom) return null;
  const quoteEnd = text.indexOf('"', k + 1);
  if (quoteEnd === -1) {
    scan.noQuoteFrom = k;
    return null;
  }
  return text[quoteEnd + 1] === ")" ? quoteEnd + 2 : null;
}

/**
 * 圖片、連結：`[字](網址)` → `字：網址`（字就是網址時只留網址）。
 * 用 indexOf 掃描取代 regex：`[` 很多卻沒有收尾時，regex 每個起點都要掃到底（O(n²)）。
 * 同一個 `]` 之前的所有 `[` 結果都一樣，失敗就直接跳過那個 `]`，整體線性。
 */
function replaceLinks(text: string, baseUrl: string): string {
  const scan: LinkScan = { text, failedUntil: -1, noQuoteFrom: Infinity };
  let out = "";
  let last = 0;
  let open = text.indexOf("[");
  while (open !== -1) {
    const close = text.indexOf("]", open + 1);
    if (close === -1) break;
    const m = matchLinkTail(scan, close);
    if (!m) {
      open = text.indexOf("[", close + 1);
      continue;
    }
    const start = open > last && text[open - 1] === "!" ? open - 1 : open;
    out += text.slice(last, start) + linkText(text.slice(open + 1, close), m.href, baseUrl);
    last = m.end;
    open = text.indexOf("[", last);
  }
  return out + text.slice(last);
}

function linkText(label: string, href: string, baseUrl: string): string {
  const url = absolutize(href, baseUrl);
  const l = label.trim();
  return !l || l === href || l === url ? url : `${l}：${url}`;
}

/** 網址後面緊接中文（「…/advances查看」）：聊天 app 會把中文也認成網址的一部分，點了 404。補一個空白。 */
function spaceAfterUrls(text: string): string {
  return text.replaceAll(/https?:\/\/[\x21-\x7E]+/g, (m: string, offset: number) => {
    const next = text.codePointAt(offset + m.length) ?? 0;
    return next > 0x7f ? `${m} ` : m;
  });
}

/** 每行去掉行尾空白與 tab（取代 `/[ \t]+\n/`：一長串空白後面不是換行時會超線性回溯）。 */
function trimLineEnds(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      let end = line.length;
      while (end > 0 && (line[end - 1] === " " || line[end - 1] === "\t")) end -= 1;
      return line.slice(0, end);
    })
    .join("\n");
}

/**
 * Markdown → 聊天純文字。只處理模型常用的那幾種寫法，其他原樣留著（聊天裡多一個 * 不會壞）。
 */
export function markdownToChat(md: string, baseUrl: string, maxChars = MAX_CHAT_TEXT): string {
  let lines = md.replaceAll("\r\n", "\n").split("\n");
  lines = lines.filter((l) => !/^\s*```/.test(l)); // code fence 只留內容
  lines = tablesToLines(lines);
  let text = lines
    .map((l) =>
      l
        .replace(/^\s{0,3}#{1,6}\s+/, "") // 標題
        .replace(/^(\s*)[-*+]\s+/, "$1・") // 列點
        .replace(/^\s*>\s?/, ""), // 引用
    )
    .join("\n");
  text = replaceLinks(text, baseUrl)
    .replaceAll(/\*\*([^*\n]+)\*\*/g, "$1")
    .replaceAll(/__([^_\n]+)__/g, "$1")
    .replaceAll(/(^|[^*\w])\*([^*\n]+)\*(?=[^*\w]|$)/g, "$1$2")
    .replaceAll(/~~([^~\n]+)~~/g, "$1")
    .replaceAll(/`([^`\n]+)`/g, "$1");
  text = trimLineEnds(spaceAfterUrls(text))
    .replaceAll(/\n{3,}/g, "\n\n")
    .trim();
  return ellipsis(maskAccountNumbers(text), maxChars);
}

/** 模型的回覆 → 聊天文字＋快速選項（`[[選項：…]]` 拆成 quick reply）。 */
export function replyToChat(md: string, baseUrl: string): { text: string; quickReplies: QuickReply[] } {
  const { text, options } = parseOptions(md);
  return {
    text: markdownToChat(text, baseUrl),
    quickReplies: options.map((o) => ({ label: o, text: o })),
  };
}

// ---------------------------------------------------------------------------
// runTurn 事件 → 這一題要送出的東西
// ---------------------------------------------------------------------------

export type TurnOutput = {
  /** 每一輪模型的文字（依序，已去頭尾空白、略過空的）。 */
  texts: string[];
  /** 還在等確認的寫入（依序）。 */
  pending: UiToolCall[];
  /** 這一題裡確認卡的結果（按確認／取消後）。 */
  results: { id: string; status: UiToolStatus; error?: string }[];
  error?: ChatErrorCode;
  conversationId?: string;
};

/** 收集一題的事件（emit 進來的順序）。 */
export function collectTurn(events: readonly ChatEvent[]): TurnOutput {
  const segments: string[] = [];
  let current = "";
  const pending = new Map<string, UiToolCall>();
  const results: TurnOutput["results"] = [];
  let error: ChatErrorCode | undefined;
  let conversationId: string | undefined;
  const flush = () => {
    if (current.trim()) segments.push(current.trim());
    current = "";
  };
  for (const e of events) {
    switch (e.t) {
      case "conv":
        conversationId = e.id;
        break;
      case "msg":
        flush();
        break;
      case "text":
        current += e.d;
        break;
      case "tool":
        if (e.call.status === "pending") pending.set(e.call.id, e.call);
        break;
      case "tool_done":
        if (e.status !== "running") {
          pending.delete(e.id);
          results.push({ id: e.id, status: e.status, ...(e.error ? { error: e.error } : {}) });
        }
        break;
      case "error":
        error ??= e.code;
        break;
      case "done":
        break;
    }
  }
  flush();
  return { texts: segments, pending: [...pending.values()], results, error, conversationId };
}

// ---------------------------------------------------------------------------
// UiToolCall → ConfirmCard
// ---------------------------------------------------------------------------

const TOOL_TITLES: Record<string, { "zh-TW": string; en: string }> = {
  create_transaction: { "zh-TW": "新增交易", en: "Add transaction" },
  submit_advance: { "zh-TW": "提交代墊", en: "Submit advance" },
  update_transaction: { "zh-TW": "修改交易", en: "Update transaction" },
  create_reimbursement: { "zh-TW": "記錄代墊還款", en: "Record reimbursement" },
  create_party: { "zh-TW": "新增對象", en: "Add party" },
  update_party: { "zh-TW": "修改對象", en: "Update party" },
  create_category: { "zh-TW": "新增分類", en: "Add category" },
  create_contract: { "zh-TW": "新增合約", en: "Add contract" },
  update_contract: { "zh-TW": "修改合約", en: "Update contract" },
  create_ai_rule: { "zh-TW": "新增規則", en: "Add rule" },
  update_ai_rule: { "zh-TW": "修改規則", en: "Update rule" },
  remove_ai_rule: { "zh-TW": "刪除規則", en: "Remove rule" },
};

export function toolTitle(name: string, locale: Locale): string {
  return TOOL_TITLES[name]?.[locale] ?? name;
}

const ARG_LABELS: Record<string, { "zh-TW": string; en: string }> = {
  type: { "zh-TW": "類型", en: "Type" },
  date: { "zh-TW": "日期", en: "Date" },
  txnDate: { "zh-TW": "日期", en: "Date" },
  payDate: { "zh-TW": "付款日", en: "Pay date" },
  dueDate: { "zh-TW": "到期日", en: "Due date" },
  amount: { "zh-TW": "金額", en: "Amount" },
  currency: { "zh-TW": "幣別", en: "Currency" },
  partyName: { "zh-TW": "對象", en: "Party" },
  partyId: { "zh-TW": "對象", en: "Party" },
  description: { "zh-TW": "說明", en: "Description" },
  note: { "zh-TW": "備註", en: "Note" },
  categoryId: { "zh-TW": "分類", en: "Category" },
  categoryName: { "zh-TW": "分類", en: "Category" },
  accountId: { "zh-TW": "帳戶", en: "Account" },
  fromAccountId: { "zh-TW": "付款帳戶", en: "From account" },
  toAccountId: { "zh-TW": "收款帳戶", en: "To account" },
  employeeId: { "zh-TW": "員工", en: "Employee" },
  projectId: { "zh-TW": "專案", en: "Project" },
  contractId: { "zh-TW": "合約", en: "Contract" },
  taxId: { "zh-TW": "統編", en: "Tax ID" },
  billedToCompanyTaxId: { "zh-TW": "報公司統編", en: "Company tax ID on invoice" },
  invoiceNumber: { "zh-TW": "發票號碼", en: "Invoice no." },
  documentIds: { "zh-TW": "附件", en: "Attachments" },
  docKind: { "zh-TW": "憑證種類", en: "Document type" },
  needsReview: { "zh-TW": "待確認", en: "Needs review" },
  name: { "zh-TW": "名稱", en: "Name" },
  title: { "zh-TW": "標題", en: "Title" },
  scope: { "zh-TW": "範圍", en: "Scope" },
  kind: { "zh-TW": "種類", en: "Kind" },
  text: { "zh-TW": "內容", en: "Text" },
  match: { "zh-TW": "條件", en: "When" },
  action: { "zh-TW": "動作", en: "Then" },
  id: { "zh-TW": "編號", en: "ID" },
  transactionId: { "zh-TW": "交易", en: "Transaction" },
  advanceIds: { "zh-TW": "代墊", en: "Advances" },
  accountNumber: { "zh-TW": "帳號", en: "Account no." },
};

const VALUE_LABELS: Record<string, Record<string, { "zh-TW": string; en: string }>> = {
  type: {
    expense: { "zh-TW": "支出", en: "Expense" },
    income: { "zh-TW": "收入", en: "Income" },
    advance: { "zh-TW": "代墊", en: "Advance" },
    transfer: { "zh-TW": "轉帳", en: "Transfer" },
  },
  docKind: {
    e_invoice: { "zh-TW": "電子發票", en: "E-invoice" },
    paper_invoice: { "zh-TW": "紙本發票", en: "Paper invoice" },
    receipt: { "zh-TW": "收據", en: "Receipt" },
    other: { "zh-TW": "其他", en: "Other" },
  },
  scope: {
    org: { "zh-TW": "組織", en: "Organization" },
    user: { "zh-TW": "個人", en: "Personal" },
  },
};

function formatBoolean(v: boolean, locale: Locale): string {
  if (locale === "en") return v ? "Yes" : "No";
  return v ? "是" : "否";
}

function formatNumber(key: string, v: number): string {
  if (SENSITIVE_KEY.test(key)) return maskTail(String(v));
  return /amount/i.test(key) ? v.toLocaleString("en-US") : String(v);
}

function formatString(key: string, v: string, locale: Locale): string {
  const mapped = VALUE_LABELS[key]?.[v]?.[locale];
  if (mapped) return mapped;
  return SENSITIVE_KEY.test(key) ? maskTail(v) : maskAccountNumbers(v);
}

function formatArray(key: string, v: readonly unknown[]): string {
  if (key === "documentIds") return v.map((x) => `#${Number(x)}`).join("、");
  return v
    .map((x) => {
      if (typeof x === "string") return x;
      if (typeof x === "number" || typeof x === "boolean" || typeof x === "bigint") return x.toString();
      return JSON.stringify(x) ?? "";
    })
    .join("、");
}

function formatValue(key: string, v: unknown, locale: Locale): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return formatBoolean(v, locale);
  if (typeof v === "number") return formatNumber(key, v);
  if (typeof v === "string") return formatString(key, v, locale);
  if (Array.isArray(v)) return formatArray(key, v);
  return maskAccountNumbers(JSON.stringify(v));
}

/** 工具參數 → 卡片的標籤列（已拿掉 organizationId、confirmSummary；帳號遮末四碼）。 */
export function argRows(args: Record<string, unknown>, locale: Locale): ConfirmCardRow[] {
  const rows: ConfirmCardRow[] = [];
  // 金額跟幣別併成一列（「TWD 1,860」），幣別不另列。
  const mergeCurrency = typeof args.currency === "string" && args.amount !== undefined && args.amount !== null;
  for (const [k, v] of Object.entries(args)) {
    if (v === undefined || (k === "currency" && mergeCurrency)) continue;
    const label = ARG_LABELS[k]?.[locale] ?? k;
    let value = formatValue(k, v, locale);
    if (k === "amount" && mergeCurrency) value = `${String(args.currency)} ${value}`;
    rows.push({ label, value: ellipsis(value, MAX_CARD_VALUE) });
  }
  if (rows.length > MAX_CARD_ROWS) {
    const extra = rows.length - (MAX_CARD_ROWS - 1);
    return [...rows.slice(0, MAX_CARD_ROWS - 1), { label: "…", value: botStrings(locale).moreRows(extra) }];
  }
  return rows;
}

export function toConfirmCard(
  call: UiToolCall,
  meta: { cardId: string; orgName: string; actorName: string; locale: Locale },
): ConfirmCard {
  const title = ellipsis((call.summary ?? "").trim() || toolTitle(call.name, meta.locale), 120);
  return {
    cardId: meta.cardId,
    title: maskAccountNumbers(title),
    orgName: meta.orgName,
    actorName: meta.actorName,
    rows: argRows(call.args ?? {}, meta.locale),
    ...(call.ruleHint ? { ruleHint: call.ruleHint } : {}),
    actions: ["confirm", "edit", "cancel"],
  };
}

/** 三張以上一起出現時多一張「全部確認」卡（按鈕帶批次卡的 id）。 */
export function batchCard(
  cards: readonly ConfirmCard[],
  meta: { cardId: string; orgName: string; actorName: string; locale: Locale },
): ConfirmCard {
  const s = botStrings(meta.locale);
  return {
    cardId: meta.cardId,
    title: s.batchTitle(cards.length),
    orgName: meta.orgName,
    actorName: meta.actorName,
    rows: cards.map((c, i) => ({ label: `${i + 1}`, value: ellipsis(c.title, MAX_CARD_VALUE) })),
    actions: ["all"],
    confirmLabel: s.confirmAll(cards.length),
  };
}

function rowToText(r: ConfirmCardRow): string {
  const note = r.note ? `（${r.note}）` : "";
  return `${r.label}：${r.value}${note}`;
}

/** 卡片的純文字描述（引用確認卡時放進題目、WhatsApp 卡片內文）。 */
export function cardToText(card: Pick<ConfirmCard, "title" | "rows" | "ruleHint">, locale: Locale): string {
  const s = botStrings(locale);
  const lines = [card.title, ...card.rows.map(rowToText)];
  if (card.ruleHint) lines.push(`${s.ruleHintLabel}：${card.ruleHint}`);
  return lines.join("\n");
}

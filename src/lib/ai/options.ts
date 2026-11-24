/**
 * 模型回覆最後一行的快速選項標記：`[[選項：我先墊的|公司信用卡|公司帳戶]]`。
 * 聊天把它拆成 LINE quick reply／WhatsApp 按鈕，網頁把它拆成可點的 chips（點了就送出那段字）。
 * 這支檔案是純函式、不 import 伺服器端的東西，網頁 client component 也能用。
 */

/** 一則回覆最多拆幾個選項（LINE quick reply 上限 13，留一點餘裕）。 */
export const MAX_OPTIONS = 10;

/** 單一選項最多幾個字（LINE quick reply label 上限 20）。 */
export const MAX_OPTION_CHARS = 20;

// 標記格式：`[[`、可有空白、「選項」或英文 option(s)（不分大小寫）、全形／半形冒號、選項內容、`]]`；
// 選項之間用 | 或全形｜分隔。用手寫的線性掃描而不是 regex，避免惡意長輸入造成回溯。
const OPEN = "[[";
const CLOSE = "]]";
const LABEL_ZH = "選項";
const LABEL_EN = "option";

// 與 regex 的 \s 同一組字元（空白、tab、換行、全形空白等）。
const SPACE = /\s/u;
const isSpace = (ch: string | undefined): boolean => ch !== undefined && SPACE.test(ch);

/** 比對「選項」或不分大小寫的 option／options，回傳標籤後的位置，失敗回傳 -1。 */
function matchLabel(s: string, j: number): number {
  if (s.startsWith(LABEL_ZH, j)) return j + LABEL_ZH.length;
  if (s[j] !== "o" && s[j] !== "O") return -1;
  if (s.slice(j, j + LABEL_EN.length).toLowerCase() !== LABEL_EN) return -1;
  const end = j + LABEL_EN.length;
  return s[end] === "s" || s[end] === "S" ? end + 1 : end;
}

function skipSpaces(s: string, i: number): number {
  let j = i;
  while (isSpace(s[j])) j++;
  return j;
}

/** 從 `[[` 之後開始比對標籤與冒號，成功回傳內容起點，失敗回傳 -1。 */
function matchHead(s: string, i: number): number {
  const afterLabel = matchLabel(s, skipSpaces(s, i));
  if (afterLabel < 0) return -1;
  const j = skipSpaces(s, afterLabel);
  if (s[j] !== ":" && s[j] !== "：") return -1;
  return skipSpaces(s, j + 1);
}

type Marker = { start: number; end: number; body: string };

/**
 * 找「from 之後第一個 `]`」並記住結果：掃描位置只會往後，記住上次找到的位置，
 * 一大串沒收尾的 `[[選項：` 也不會每次都從頭掃到尾（否則會變成平方時間）。
 */
function closeFinder(s: string): (from: number) => number {
  let lastFrom = -1;
  let found = -1;
  return (from) => {
    if (lastFrom < 0 || from < lastFrom || (found >= 0 && found < from)) found = s.indexOf("]", from);
    lastFrom = from;
    return found;
  };
}

/** 在 `[[` 的位置 p 試著比對一個完整標記；內容不能含 `]`，且第一個 `]` 必須是 `]]`。 */
function matchMarker(s: string, p: number, nextClose: (from: number) => number): Marker | null {
  const bodyStart = matchHead(s, p + OPEN.length);
  if (bodyStart < 0) return null;
  const close = nextClose(bodyStart);
  if (close < 0 || !s.startsWith(CLOSE, close)) return null;
  return { start: p, end: close + CLOSE.length, body: s.slice(bodyStart, close).trimEnd() };
}

/** 去掉所有標記，回傳剩下的文字與最後一個標記的內容。 */
function stripMarkers(raw: string): { rest: string; last: string | null } {
  let rest = "";
  let last: string | null = null;
  let from = 0;
  const nextClose = closeFinder(raw);
  let p = raw.indexOf(OPEN);
  while (p >= 0) {
    const m = matchMarker(raw, p, nextClose);
    if (m) {
      rest += raw.slice(from, m.start);
      last = m.body;
      from = m.end;
      p = raw.indexOf(OPEN, m.end);
    } else {
      p = raw.indexOf(OPEN, p + 1);
    }
  }
  return { rest: rest + raw.slice(from), last };
}

/** 去掉每行行尾的空白與 tab，連續兩個以上的空行併成一個，最後頭尾 trim。 */
function tidy(text: string): string {
  const out: string[] = [];
  let blanks = 0;
  for (const line of text.split("\n")) {
    let end = line.length;
    while (end > 0 && (line[end - 1] === " " || line[end - 1] === "\t")) end--;
    const kept = line.slice(0, end);
    blanks = kept === "" ? blanks + 1 : 0;
    if (blanks <= 1) out.push(kept);
  }
  return out.join("\n").trim();
}

export type ParsedOptions = { text: string; options: string[] };

/**
 * 拆出快速選項：回傳去掉標記的文字與選項（去空白、去重、最多 MAX_OPTIONS 個，太長的截斷）。
 * 有好幾個標記時只用最後一個，其他標記也一併從文字裡拿掉；沒有標記就原樣回傳、options 是空陣列。
 */
export function parseOptions(raw: string): ParsedOptions {
  const { rest, last } = stripMarkers(raw);
  const text = tidy(rest);
  if (last === null) return { text, options: [] };
  const seen = new Set<string>();
  const options: string[] = [];
  for (const piece of last.split(/[|｜]/)) {
    const o = piece.trim();
    if (!o || seen.has(o)) continue;
    seen.add(o);
    options.push(o.length > MAX_OPTION_CHARS ? o.slice(0, MAX_OPTION_CHARS) : o);
    if (options.length >= MAX_OPTIONS) break;
  }
  return { text, options };
}

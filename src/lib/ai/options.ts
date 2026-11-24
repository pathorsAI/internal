/**
 * 模型回覆最後一行的快速選項標記：`[[選項：我先墊的|公司信用卡|公司帳戶]]`。
 * 聊天把它拆成 LINE quick reply／WhatsApp 按鈕，網頁把它拆成可點的 chips（點了就送出那段字）。
 * 這支檔案是純函式、不 import 伺服器端的東西，網頁 client component 也能用。
 */

/** 一則回覆最多拆幾個選項（LINE quick reply 上限 13，留一點餘裕）。 */
export const MAX_OPTIONS = 10;

/** 單一選項最多幾個字（LINE quick reply label 上限 20）。 */
export const MAX_OPTION_CHARS = 20;

// 接受全形／半形冒號、「選項」或英文 options，選項之間用 | 或全形｜分隔。
const MARKER = /\[\[\s*(?:選項|options?)\s*[:：]\s*([^\]]*?)\s*\]\]/giu;

export type ParsedOptions = { text: string; options: string[] };

/**
 * 拆出快速選項：回傳去掉標記的文字與選項（去空白、去重、最多 MAX_OPTIONS 個，太長的截斷）。
 * 有好幾個標記時只用最後一個，其他標記也一併從文字裡拿掉；沒有標記就原樣回傳、options 是空陣列。
 */
export function parseOptions(raw: string): ParsedOptions {
  let last: string | null = null;
  const text = raw
    .replace(MARKER, (_m, body: string) => {
      last = body;
      return "";
    })
    .replaceAll(/[ \t]+\n/g, "\n")
    .replaceAll(/\n{3,}/g, "\n\n")
    .trim();
  if (last === null) return { text, options: [] };
  const seen = new Set<string>();
  const options: string[] = [];
  for (const piece of (last as string).split(/[|｜]/)) {
    const o = piece.trim();
    if (!o || seen.has(o)) continue;
    seen.add(o);
    options.push(o.length > MAX_OPTION_CHARS ? o.slice(0, MAX_OPTION_CHARS) : o);
    if (options.length >= MAX_OPTIONS) break;
  }
  return { text, options };
}

/**
 * 最小可用的 .xlsx 讀取器。
 *
 * Simpany 的匯出按鈕給的是 .xlsx，不是 CSV。為了讀它去裝 SheetJS 這種等級的
 * 相依太重 —— 我們只需要「把第一張工作表讀成字串表格」，而 zip 裡的 deflate 用
 * DecompressionStream 就能解（瀏覽器與 Workers 都有），SpreadsheetML 的儲存格是
 * 機器產生的固定形狀，用針對性的掃描就夠，不需要通用 XML parser。
 *
 * 刻意不支援的：ZIP64（超過 4GB 或 65535 筆條目）、多張工作表（只讀第一張）、
 * 樣式推導的日期序號（Simpany 的日期是純文字，不需要）。遇到讀不動的檔案就
 * 明確丟錯，讓使用者改用 CSV，不要安靜地給出半份資料。
 */

const EOCD_SIG = 0x06054b50;
const CENTRAL_SIG = 0x02014b50;

type ZipEntry = { name: string; offset: number; method: number; size: number };

function findEocd(view: DataView): number {
  // EOCD 在檔案最後，後面最多跟著 65535 bytes 的註解。
  const min = Math.max(0, view.byteLength - 22 - 0xffff);
  for (let i = view.byteLength - 22; i >= min; i -= 1) {
    if (view.getUint32(i, true) === EOCD_SIG) return i;
  }
  return -1;
}

function readCentralDirectory(buf: ArrayBuffer): ZipEntry[] {
  const view = new DataView(buf);
  const eocd = findEocd(view);
  if (eocd < 0) throw new XlsxError("notXlsx");
  const count = view.getUint16(eocd + 10, true);
  let ptr = view.getUint32(eocd + 16, true);

  const decoder = new TextDecoder();
  const entries: ZipEntry[] = [];
  for (let i = 0; i < count; i += 1) {
    if (view.getUint32(ptr, true) !== CENTRAL_SIG) break;
    const method = view.getUint16(ptr + 10, true);
    const size = view.getUint32(ptr + 20, true);
    const nameLen = view.getUint16(ptr + 28, true);
    const extraLen = view.getUint16(ptr + 30, true);
    const commentLen = view.getUint16(ptr + 32, true);
    const localOffset = view.getUint32(ptr + 42, true);
    const name = decoder.decode(new Uint8Array(buf, ptr + 46, nameLen));
    entries.push({ name, offset: localOffset, method, size });
    ptr += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

async function readEntry(buf: ArrayBuffer, entry: ZipEntry): Promise<string> {
  const view = new DataView(buf);
  // local file header：名稱與 extra 的長度可能與中央目錄不同，一定要重讀。
  const nameLen = view.getUint16(entry.offset + 26, true);
  const extraLen = view.getUint16(entry.offset + 28, true);
  const start = entry.offset + 30 + nameLen + extraLen;
  const raw = new Uint8Array(buf, start, entry.size);

  if (entry.method === 0) return new TextDecoder().decode(raw);
  if (entry.method !== 8)
    throw new XlsxError("unsupportedCompression", String(entry.method));

  const stream = new Blob([raw as unknown as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"));
  return new Response(stream).text();
}

const CODE_A = 65;
const CODE_Z = 90;

/** 'BC12' → 54（0-based 欄索引）。遇到第一個非 A-Z 就停（後面是列號）。 */
function columnIndex(ref: string): number {
  let n = 0;
  for (const ch of ref) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < CODE_A || code > CODE_Z) break;
    n = n * 26 + (code - CODE_A + 1);
  }
  return n - 1;
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

function unescapeXml(s: string): string {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-z]+);/g, (whole, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X")) {
      return String.fromCodePoint(Number.parseInt(body.slice(2), 16));
    }
    if (body.startsWith("#")) return String.fromCodePoint(Number(body.slice(1)));
    return ENTITIES[body] ?? whole;
  });
}

/** 把一段 XML 裡所有 <t> 的文字接起來（<si> 可能被切成多個 <r><t>）。 */
function joinTextNodes(xml: string): string {
  let out = "";
  const re = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) out += unescapeXml(m[1]);
  return out;
}

const V_RE = /<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/;

/** 取 <c> 裡的 <v> 文字（已解 entity）。 */
function cellValueText(body: string): string {
  return unescapeXml(V_RE.exec(body)?.[1] ?? "");
}

/** 依 t 屬性解出儲存格的字串值。 */
function cellValue(type: string | undefined, body: string, shared: string[]): string {
  if (type === "s") return shared[Number(V_RE.exec(body)?.[1] ?? -1)] ?? "";
  if (type === "inlineStr" || type === "str") return joinTextNodes(body) || cellValueText(body);
  return cellValueText(body);
}

/** sharedStrings.xml → 依索引排好的字串表（沒有這個檔就是空的）。 */
async function readSharedStrings(buf: ArrayBuffer, entries: ZipEntry[]): Promise<string[]> {
  const entry = entries.find((e) => e.name === "xl/sharedStrings.xml");
  if (!entry) return [];
  const xml = await readEntry(buf, entry);
  const out: string[] = [];
  const re = /<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) out.push(joinTextNodes(m[1]));
  return out;
}

/** 一列 <row> 的內容 → 依欄索引對齊的字串陣列（空格補空字串）。 */
function parseRow(rowXml: string, shared: string[]): string[] {
  // <c> 可能自閉合（<c r="B2"/>），也可能帶 <v> 或 <is><t>。
  const cellRe = /<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
  const cells: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = cellRe.exec(rowXml)) !== null) {
    const idx = columnIndex(/r="([A-Z]+)/.exec(m[1])?.[1] ?? "");
    if (idx < 0) continue;
    while (cells.length < idx) cells.push("");
    cells[idx] = cellValue(/t="([^"]+)"/.exec(m[1])?.[1], m[2] ?? "", shared);
  }
  return cells;
}

/**
 * 讀出活頁簿第一張工作表，回傳對齊欄位的字串表格。
 * 空白儲存格補空字串，這樣呼叫端可以直接用欄索引取值。
 */
/**
 * 這支解析器跑在瀏覽器端，錯誤訊息會直接顯示給使用者，所以這裡只丟「代號」，
 * 由畫面端翻成當下語系的句子。
 */
export class XlsxError extends Error {
  constructor(
    readonly code: "notXlsx" | "unsupportedCompression" | "noSheet",
    readonly detail?: string,
  ) {
    super(code);
    this.name = "XlsxError";
  }
}

export async function readXlsxFirstSheet(buf: ArrayBuffer): Promise<string[][]> {
  const entries = readCentralDirectory(buf);
  const sheet = entries
    .filter((e) => /^xl\/worksheets\/sheet\d+\.xml$/.test(e.name))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))[0];
  if (!sheet) throw new XlsxError("noSheet");

  const shared = await readSharedStrings(buf, entries);
  const xml = await readEntry(buf, sheet);

  const table: string[][] = [];
  const rowRe = /<row(?:\s[^>]*)?>([\s\S]*?)<\/row>/g;
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowRe.exec(xml)) !== null) {
    table.push(parseRow(rowMatch[1], shared));
  }
  return table.filter((r) => r.some((c) => c.trim() !== ""));
}

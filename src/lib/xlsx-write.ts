/**
 * 最小可用的 .xlsx 寫入器（財務報表匯出用）。
 *
 * 跟 src/lib/xlsx-lite.ts（讀取器）是一對：不裝 SheetJS／exceljs 這種等級的相依，只做報表需要的：
 * 多張工作表、字串與數字儲存格、粗體、千分位兩位小數（"#,##0.00"）、欄寬。
 *
 * ZIP 用 STORE（不壓縮），所以不需要 CompressionStream，Workers、瀏覽器、bun 都能跑；
 * 報表檔案頂多幾 MB，不壓縮也無妨。字串一律寫成 inline string（t="inlineStr"），
 * 不必維護 sharedStrings 表。
 *
 * 刻意不支援：ZIP64、公式、合併儲存格、日期序號（日期寫成 YYYY-MM-DD 字串，會計師看得懂也好篩）。
 */

/** 一個儲存格：字串、數字、空，或帶樣式的物件。 */
export type XlsxCell =
  | string
  | number
  | null
  | undefined
  | {
      v: string | number | null | undefined;
      bold?: boolean;
      /** 數字不套千分位格式（例如年份、筆數）。 */
      plain?: boolean;
    };

export type XlsxSheet = {
  /** 工作表名稱；會去掉 Excel 不允許的字元並截到 31 字。 */
  name: string;
  rows: XlsxCell[][];
  /** 每欄寬度（字元數）。 */
  widths?: number[];
};

// ---------------------------------------------------------------------------
// CRC32 與 ZIP（STORE）
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

type ZipFile = { name: string; data: Uint8Array };

/** DOS 日期 1980-01-01 00:00（固定值，產出的檔案可重現）。 */
const DOS_TIME = 0;
const DOS_DATE = (0 << 9) | (1 << 5) | 1;
/** general purpose flag bit 11：檔名是 UTF-8。 */
const UTF8_FLAG = 0x0800;

export function zipStore(files: ZipFile[]): Uint8Array {
  const enc = new TextEncoder();
  const prepared = files.map((f) => ({ ...f, nameBytes: enc.encode(f.name), crc: crc32(f.data) }));

  const localSize = prepared.reduce((s, f) => s + 30 + f.nameBytes.length + f.data.length, 0);
  const centralSize = prepared.reduce((s, f) => s + 46 + f.nameBytes.length, 0);
  const out = new Uint8Array(localSize + centralSize + 22);
  const view = new DataView(out.buffer);

  let ptr = 0;
  const offsets: number[] = [];
  for (const f of prepared) {
    offsets.push(ptr);
    view.setUint32(ptr, 0x04034b50, true);
    view.setUint16(ptr + 4, 20, true); // version needed
    view.setUint16(ptr + 6, UTF8_FLAG, true);
    view.setUint16(ptr + 8, 0, true); // method: STORE
    view.setUint16(ptr + 10, DOS_TIME, true);
    view.setUint16(ptr + 12, DOS_DATE, true);
    view.setUint32(ptr + 14, f.crc, true);
    view.setUint32(ptr + 18, f.data.length, true);
    view.setUint32(ptr + 22, f.data.length, true);
    view.setUint16(ptr + 26, f.nameBytes.length, true);
    view.setUint16(ptr + 28, 0, true);
    out.set(f.nameBytes, ptr + 30);
    out.set(f.data, ptr + 30 + f.nameBytes.length);
    ptr += 30 + f.nameBytes.length + f.data.length;
  }

  const centralStart = ptr;
  prepared.forEach((f, i) => {
    view.setUint32(ptr, 0x02014b50, true);
    view.setUint16(ptr + 4, 20, true); // version made by
    view.setUint16(ptr + 6, 20, true); // version needed
    view.setUint16(ptr + 8, UTF8_FLAG, true);
    view.setUint16(ptr + 10, 0, true);
    view.setUint16(ptr + 12, DOS_TIME, true);
    view.setUint16(ptr + 14, DOS_DATE, true);
    view.setUint32(ptr + 16, f.crc, true);
    view.setUint32(ptr + 20, f.data.length, true);
    view.setUint32(ptr + 24, f.data.length, true);
    view.setUint16(ptr + 28, f.nameBytes.length, true);
    view.setUint16(ptr + 30, 0, true); // extra
    view.setUint16(ptr + 32, 0, true); // comment
    view.setUint16(ptr + 34, 0, true); // disk
    view.setUint16(ptr + 36, 0, true); // internal attrs
    view.setUint32(ptr + 38, 0, true); // external attrs
    view.setUint32(ptr + 42, offsets[i], true);
    out.set(f.nameBytes, ptr + 46);
    ptr += 46 + f.nameBytes.length;
  });

  view.setUint32(ptr, 0x06054b50, true);
  view.setUint16(ptr + 4, 0, true);
  view.setUint16(ptr + 6, 0, true);
  view.setUint16(ptr + 8, prepared.length, true);
  view.setUint16(ptr + 10, prepared.length, true);
  view.setUint32(ptr + 12, ptr - centralStart, true);
  view.setUint32(ptr + 16, centralStart, true);
  view.setUint16(ptr + 20, 0, true);
  return out;
}

// ---------------------------------------------------------------------------
// SpreadsheetML
// ---------------------------------------------------------------------------

function escapeXml(s: string): string {
  return (
    s
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      // XML 1.0 不允許的控制字元（tab、換行除外）直接拿掉，否則 Excel 打不開
      .replaceAll(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
  );
}

/** 0 → 'A'、27 → 'AB'。 */
export function columnName(index: number): string {
  let n = index + 1;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCodePoint(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/** Excel 工作表名稱：不能有 []:*?/\，最多 31 字，不能空，不能重複。 */
function sheetNames(sheets: XlsxSheet[]): string[] {
  const used = new Set<string>();
  return sheets.map((s, i) => {
    const base = s.name.replaceAll(/[[\]:*?/\\]/g, " ").trim().slice(0, 31) || `Sheet${i + 1}`;
    let name = base;
    let n = 2;
    while (used.has(name.toLowerCase())) {
      const suffix = ` (${n})`;
      name = base.slice(0, 31 - suffix.length) + suffix;
      n += 1;
    }
    used.add(name.toLowerCase());
    return name;
  });
}

// cellXfs 的索引
const STYLE_DEFAULT = 0;
const STYLE_BOLD = 1;
const STYLE_NUMBER = 2;
const STYLE_BOLD_NUMBER = 3;

const STYLES_XML =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00"/></numFmts>' +
  '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
  '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="4">' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
  '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '<xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyNumberFormat="1"/>' +
  "</cellXfs>" +
  '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
  "</styleSheet>";

function cellXml(cell: XlsxCell, ref: string): string {
  const obj = cell !== null && typeof cell === "object" ? cell : { v: cell };
  const { v } = obj;
  const bold = "bold" in obj && obj.bold === true;
  const plain = "plain" in obj && obj.plain === true;
  if (v === null || v === undefined || v === "") {
    return bold ? `<c r="${ref}" s="${STYLE_BOLD}"/>` : "";
  }
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return "";
    let style: number;
    if (plain) style = bold ? STYLE_BOLD : STYLE_DEFAULT;
    else style = bold ? STYLE_BOLD_NUMBER : STYLE_NUMBER;
    return `<c r="${ref}" s="${style}"><v>${v}</v></c>`;
  }
  const style = bold ? ` s="${STYLE_BOLD}"` : "";
  return `<c r="${ref}" t="inlineStr"${style}><is><t xml:space="preserve">${escapeXml(v)}</t></is></c>`;
}

function sheetXml(sheet: XlsxSheet): string {
  const cols =
    sheet.widths && sheet.widths.length > 0
      ? "<cols>" +
        sheet.widths
          .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${Math.max(1, w)}" customWidth="1"/>`)
          .join("") +
        "</cols>"
      : "";
  const rows = sheet.rows
    .map((row, r) => {
      const cells = row.map((c, i) => cellXml(c, `${columnName(i)}${r + 1}`)).join("");
      return `<row r="${r + 1}">${cells}</row>`;
    })
    .join("");
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    cols +
    `<sheetData>${rows}</sheetData>` +
    "</worksheet>"
  );
}

/** 組出整份活頁簿（.xlsx 的位元組）。至少要有一張工作表。 */
export function writeXlsx(sheets: XlsxSheet[]): Uint8Array {
  const list = sheets.length > 0 ? sheets : [{ name: "Sheet1", rows: [] }];
  const names = sheetNames(list);
  const enc = new TextEncoder();

  const contentTypes =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    list
      .map(
        (_, i) =>
          `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
      )
      .join("") +
    "</Types>";

  const rootRels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    "</Relationships>";

  const workbook =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    "<sheets>" +
    names.map((n, i) => `<sheet name="${escapeXml(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("") +
    "</sheets></workbook>";

  const workbookRels =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    list
      .map(
        (_, i) =>
          `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
      )
      .join("") +
    `<Relationship Id="rId${list.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
    "</Relationships>";

  return zipStore([
    { name: "[Content_Types].xml", data: enc.encode(contentTypes) },
    { name: "_rels/.rels", data: enc.encode(rootRels) },
    { name: "xl/workbook.xml", data: enc.encode(workbook) },
    { name: "xl/_rels/workbook.xml.rels", data: enc.encode(workbookRels) },
    { name: "xl/styles.xml", data: enc.encode(STYLES_XML) },
    ...list.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: enc.encode(sheetXml(s)) })),
  ]);
}

export const XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

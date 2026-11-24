import { describe, expect, test } from "bun:test";
import { readXlsxFirstSheet } from "./xlsx-lite";
import { columnName, crc32, writeXlsx, zipStore } from "./xlsx-write";

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

/** 讀中央目錄的檔名與壓縮方法（只為了測試結構）。 */
function centralEntries(bytes: Uint8Array): { name: string; method: number; size: number; crc: number }[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = bytes.byteLength - 22;
  expect(view.getUint32(eocd, true)).toBe(0x06054b50);
  const count = view.getUint16(eocd + 10, true);
  let ptr = view.getUint32(eocd + 16, true);
  const out = [];
  for (let i = 0; i < count; i += 1) {
    expect(view.getUint32(ptr, true)).toBe(0x02014b50);
    const nameLen = view.getUint16(ptr + 28, true);
    out.push({
      method: view.getUint16(ptr + 10, true),
      crc: view.getUint32(ptr + 16, true),
      size: view.getUint32(ptr + 20, true),
      name: new TextDecoder().decode(bytes.subarray(ptr + 46, ptr + 46 + nameLen)),
    });
    ptr += 46 + nameLen;
  }
  return out;
}

describe("crc32", () => {
  test("matches the well-known check value", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
  });
});

describe("columnName", () => {
  test("A, Z, AA, AZ, BA", () => {
    expect([0, 25, 26, 51, 52].map(columnName)).toEqual(["A", "Z", "AA", "AZ", "BA"]);
  });
});

describe("zipStore", () => {
  test("writes a STORE archive whose entries carry the right CRC and size", () => {
    const data = new TextEncoder().encode("hello 你好");
    const zip = zipStore([{ name: "a.txt", data }]);
    const [entry] = centralEntries(zip);
    expect(entry).toEqual({ name: "a.txt", method: 0, size: data.length, crc: crc32(data) });
    // local header 在最前面
    expect(new DataView(zip.buffer).getUint32(0, true)).toBe(0x04034b50);
  });
});

describe("writeXlsx", () => {
  const bytes = writeXlsx([
    {
      name: "試算表",
      widths: [10, 30, 16],
      rows: [
        [{ v: "代碼", bold: true }, { v: "科目", bold: true }, { v: "金額", bold: true }],
        ["1113", "銀行存款 <A&B> \"quoted\"", 1234567.891],
        ["2295", "股東往來", -50],
        [null, "", { v: 2026, plain: true }],
        [{ v: "合計", bold: true }, null, { v: 1234517.891, bold: true }],
      ],
    },
    { name: "Bad:/name?*[]", rows: [["x"]] },
    { name: "試算表", rows: [["duplicate"]] },
  ]);

  test("has the package parts Excel needs", () => {
    const names = centralEntries(bytes).map((e) => e.name);
    expect(names).toEqual([
      "[Content_Types].xml",
      "_rels/.rels",
      "xl/workbook.xml",
      "xl/_rels/workbook.xml.rels",
      "xl/styles.xml",
      "xl/worksheets/sheet1.xml",
      "xl/worksheets/sheet2.xml",
      "xl/worksheets/sheet3.xml",
    ]);
    expect(centralEntries(bytes).every((e) => e.method === 0)).toBe(true);
  });

  test("round-trips the first sheet through the reader", async () => {
    const table = await readXlsxFirstSheet(toArrayBuffer(bytes));
    expect(table).toEqual([
      ["代碼", "科目", "金額"],
      ["1113", '銀行存款 <A&B> "quoted"', "1234567.891"],
      ["2295", "股東往來", "-50"],
      ["", "", "2026"],
      ["合計", "", "1234517.891"],
    ]);
  });

  test("sanitises and de-duplicates sheet names, declares the number format and bold font", async () => {
    const text = new TextDecoder().decode(bytes);
    expect(text).toContain('<sheet name="試算表" sheetId="1"');
    expect(text).toContain('<sheet name="Bad  name" sheetId="2"');
    expect(text).toContain('<sheet name="試算表 (2)" sheetId="3"');
    expect(text).toContain('formatCode="#,##0.00"');
    expect(text).toContain("<b/>");
    expect(text).toContain('<col min="2" max="2" width="30" customWidth="1"/>');
  });

  test("an empty workbook still has one sheet", async () => {
    const empty = writeXlsx([]);
    expect(centralEntries(empty).map((e) => e.name)).toContain("xl/worksheets/sheet1.xml");
  });
});

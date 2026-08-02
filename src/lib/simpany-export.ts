/**
 * Simpany 匯出檔的解析與對帳（migrations/0019）。
 *
 * Simpany 沒有 API，只有畫面上的匯出按鈕（給的是 .xlsx，也接受另存的 CSV），
 * 欄位名稱與順序都可能隨版本變動。所以這裡不寫死欄位位置，改用關鍵字辨識表頭；
 * 認不出來的欄位就當它不存在，只要有「發票號碼」就能對帳。
 *
 * 實際看過的表頭（2026-08 匯出）：
 *   發票類型 / 開立日期 / 發票號碼 / 買受人統編 / 買受人名稱 / 買受人 Email /
 *   自訂編號 / 備註 / 品項 / 銷售額 / 課稅別 / 稅額 / 發票總金額 / 可折讓金額 /
 *   載具類型 / 載具號碼 / 發票狀態 / 作廢日期 / 作廢原因
 *
 * 日後真的有 API，換掉的只有這支解析器。
 */

export type SimpanyRow = {
  /** 發票號碼 —— 對帳的比對鍵 */
  number: string;
  date: string | null;
  amount: number | null;
  name: string | null;
  taxId: string | null;
  status: string | null;
};

/**
 * 表頭關鍵字 → 欄位。
 *
 * 關鍵字由具體到寬鬆排列，比對時**先試最具體的**：像「買受人名稱」一定要排在
 * 「買受人」前面，否則會先撞上「買受人統編」抓錯欄。已被前一個欄位認走的欄不會
 * 再被認第二次。
 */
const HEADER_HINTS: { field: keyof SimpanyRow; keywords: string[] }[] = [
  {
    field: "number",
    keywords: ["發票號碼", "發票號", "單號", "號碼", "invoiceno", "invoicenumber", "number"],
  },
  { field: "date", keywords: ["開立日期", "發票日期", "日期", "date"] },
  {
    field: "amount",
    keywords: ["發票總金額", "含稅總額", "含稅金額", "總金額", "金額合計", "總計", "含稅", "金額", "total", "amount"],
  },
  {
    field: "name",
    keywords: ["買受人名稱", "客戶名稱", "對象名稱", "抬頭", "買受人", "客戶", "對象", "名稱", "buyername", "customer", "name"],
  },
  { field: "taxId", keywords: ["買受人統編", "統一編號", "統編", "taxid", "vatid"] },
  { field: "status", keywords: ["發票狀態", "狀態", "status"] },
];

/** RFC4180 風格的 CSV 切割：支援引號包住的逗號與換行、跳脫的雙引號、CRLF。 */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (ch !== "\r") {
      cell += ch;
    }
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

function matchHeaders(header: string[]): Partial<Record<keyof SimpanyRow, number>> {
  const out: Partial<Record<keyof SimpanyRow, number>> = {};
  const normalized = header.map((h) => h.trim().toLowerCase().replace(/\s+/g, ""));
  const taken = new Set<number>();
  for (const { field, keywords } of HEADER_HINTS) {
    // 關鍵字外圈、表頭內圈：具體的關鍵字先贏，不會被排在前面的寬鬆表頭搶走。
    for (const k of keywords) {
      const idx = normalized.findIndex((h, i) => !taken.has(i) && h.includes(k));
      if (idx >= 0) {
        out[field] = idx;
        taken.add(idx);
        break;
      }
    }
  }
  return out;
}

/** '1,234' / 'NT$1,234' / '1234.00' → 1234；認不出來回 null。 */
function parseAmount(raw: string | undefined): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[^0-9.-]/g, "");
  if (cleaned === "" || cleaned === "-") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/**
 * '2026/05/02'、'2026-08-02 01:05:56'、'1150502'（民國）→ 'YYYY-MM-DD'。
 * 認不出來回 null —— 日期不是比對鍵，讀不到不影響對帳。
 */
function parseDate(raw: string | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim();
  const slash = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/.exec(s);
  if (slash) {
    return `${slash[1]}-${slash[2].padStart(2, "0")}-${slash[3].padStart(2, "0")}`;
  }
  const roc = /^(\d{3})(\d{2})(\d{2})$/.exec(s);
  if (roc) {
    return `${Number(roc[1]) + 1911}-${roc[2]}-${roc[3]}`;
  }
  return null;
}

/** 發票號碼的比對鍵：去掉分隔符號、統一大寫（AB-12345678 與 ab12345678 視為同一張）。 */
export function normalizeInvoiceNumber(raw: string | null | undefined): string {
  return (raw ?? "").replace(/[^0-9a-zA-Z]/g, "").toUpperCase();
}

export type ParseResult = {
  rows: SimpanyRow[];
  /** 認出來的欄位，讓使用者確認解析對不對 */
  detected: Partial<Record<keyof SimpanyRow, string>>;
  /** 有內容但沒有發票號碼、無從比對的列數 */
  skipped: number;
  error?: string;
};

export function parseSimpanyCsv(text: string): ParseResult {
  return parseSimpanyTable(parseCsv(text));
}

/** 表格（來自 CSV 或 xlsx）→ 對帳用的列。第一列當表頭。 */
export function parseSimpanyTable(table: string[][]): ParseResult {
  if (table.length < 2) {
    return { rows: [], detected: {}, skipped: 0, error: "檔案是空的或只有表頭" };
  }
  const [header, ...body] = table;
  const cols = matchHeaders(header);
  if (cols.number == null) {
    return {
      rows: [],
      detected: {},
      skipped: 0,
      error: `找不到發票號碼欄位。表頭讀到：${header.join(" / ")}`,
    };
  }

  const detected: Partial<Record<keyof SimpanyRow, string>> = {};
  for (const [field, idx] of Object.entries(cols)) {
    detected[field as keyof SimpanyRow] = header[idx]?.trim();
  }

  const rows: SimpanyRow[] = [];
  let skipped = 0;
  for (const r of body) {
    const number = (r[cols.number] ?? "").trim();
    if (normalizeInvoiceNumber(number) === "") {
      skipped += 1;
      continue;
    }
    rows.push({
      number,
      date: cols.date == null ? null : parseDate(r[cols.date]),
      amount: cols.amount == null ? null : parseAmount(r[cols.amount]),
      name: cols.name == null ? null : (r[cols.name]?.trim() || null),
      taxId: cols.taxId == null ? null : (r[cols.taxId]?.trim() || null),
      status: cols.status == null ? null : (r[cols.status]?.trim() || null),
    });
  }
  return { rows, detected, skipped };
}

// ---- 比對 ----

export type LocalInvoice = {
  id: number;
  invoiceNumber: string | null;
  externalRef: string | null;
  invoiceDate: string | null;
  amountGross: number | null;
  displayName: string | null;
  status: string;
};

export type ReconcileVerdict =
  | "matched"
  | "amount_mismatch"
  | "voided_in_simpany"
  | "missing_in_simpany"
  | "missing_locally";

export type ReconcileRow = {
  verdict: ReconcileVerdict;
  number: string;
  localId: number | null;
  localAmount: number | null;
  simpanyAmount: number | null;
  name: string | null;
  date: string | null;
};

export const VERDICT_LABELS: Record<ReconcileVerdict, string> = {
  matched: "相符",
  amount_mismatch: "金額不符",
  voided_in_simpany: "Simpany 已作廢",
  missing_in_simpany: "Simpany 查無",
  missing_locally: "本系統沒紀錄",
};

/** Simpany 的發票狀態欄看起來像作廢嗎。 */
function looksVoided(status: string | null): boolean {
  return status != null && (status.includes("作廢") || status.toLowerCase().includes("void"));
}

/** 金額差在 1 元以內視為相符（Simpany 匯出常有進位差）。 */
const AMOUNT_TOLERANCE = 1;

/** 兩邊都有這張發票時，判斷是相符還是哪裡對不上。 */
function compare(inv: LocalInvoice, row: SimpanyRow): ReconcileVerdict {
  // Simpany 那邊作廢、本系統這邊還記成有效 —— 這是最該先修的一種不一致。
  if (looksVoided(row.status) && inv.status === "valid") return "voided_in_simpany";
  if (
    inv.amountGross != null &&
    row.amount != null &&
    Math.abs(inv.amountGross - row.amount) > AMOUNT_TOLERANCE
  ) {
    return "amount_mismatch";
  }
  return "matched";
}

/**
 * 雙邊比對。以發票號碼為鍵，四種結果：
 *   相符 / 金額不符 / Simpany 查無（本系統認為開了，那邊沒有）/ 本系統沒紀錄（漏登）。
 * 本系統這邊沒有號碼的發票（還沒開）不參與比對 —— 它們屬於「該開未開」那張清單。
 */
export function reconcileInvoices(
  local: LocalInvoice[],
  simpany: SimpanyRow[],
): ReconcileRow[] {
  const byNumber = new Map<string, LocalInvoice>();
  for (const inv of local) {
    const key = normalizeInvoiceNumber(inv.externalRef ?? inv.invoiceNumber);
    if (key !== "") byNumber.set(key, inv);
  }

  const out: ReconcileRow[] = [];
  const seen = new Set<string>();

  for (const row of simpany) {
    const key = normalizeInvoiceNumber(row.number);
    seen.add(key);
    const inv = byNumber.get(key);
    if (!inv) {
      out.push({
        verdict: "missing_locally",
        number: row.number,
        localId: null,
        localAmount: null,
        simpanyAmount: row.amount,
        name: row.name,
        date: row.date,
      });
      continue;
    }
    out.push({
      verdict: compare(inv, row),
      number: row.number,
      localId: inv.id,
      localAmount: inv.amountGross,
      simpanyAmount: row.amount,
      name: inv.displayName ?? row.name,
      date: inv.invoiceDate ?? row.date,
    });
  }

  for (const inv of local) {
    const key = normalizeInvoiceNumber(inv.externalRef ?? inv.invoiceNumber);
    if (key === "" || seen.has(key)) continue;
    out.push({
      verdict: "missing_in_simpany",
      number: inv.externalRef ?? inv.invoiceNumber ?? "",
      localId: inv.id,
      localAmount: inv.amountGross,
      simpanyAmount: null,
      name: inv.displayName,
      date: inv.invoiceDate,
    });
  }

  // 有問題的排前面，看的人才不用往下捲。
  const order: Record<ReconcileVerdict, number> = {
    voided_in_simpany: 0,
    missing_locally: 1,
    amount_mismatch: 2,
    missing_in_simpany: 3,
    matched: 4,
  };
  return out.sort((a, b) => order[a.verdict] - order[b.verdict] || a.number.localeCompare(b.number));
}

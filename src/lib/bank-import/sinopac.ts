/**
 * 永豐銀行（SinoPac，永豐寰宇金融網）對帳單匯入的純邏輯：解析、沖正配對、去重雜湊、比對。
 * 不碰資料庫 —— 讀寫在 src/db/bank-import.ts，網頁（帳戶頁「匯入永豐明細」）與
 * scripts/import-sinopac-statement.ts 共用同一套。
 *
 * 為什麼要有這支：手動／AI 建的永豐交易沒有留下銀行自己的備註與交易序號，之後對帳不知道在對哪一筆。
 * 匯入一份對帳單會：
 *   1. 對到既有交易 → 只補 bank_memo / bank_ref（空的才補），不動其他欄位。
 *   2. 對不到 → 新建一筆「待確認」交易（未分類），備註與序號都帶上。
 *   3. 沖正（Correction）→ 跟被沖掉的那一行互相抵銷，兩行都不建、不對交易。
 *   4. 同一行再匯一次 → line_hash 已經在 bank_statement_lines，算「已匯入過」。
 *
 * 檔案格式（真實匯出是 TSV，日期 2026/10/02 16:26:00、金額有千分位、空格很多）：
 *   Account, Transaction date, Currency, Withdrawal, Deposit, Balance, Transaction ref, Remarks, Correction note
 * 或整理過的版本：
 *   acct_last4, datetime, currency, withdrawal, deposit, balance, txn_ref, remarks, correction
 * CSV（含引號）、TSV、.xlsx（第一張工作表）都接受。
 */
import { readXlsxFirstSheet } from "@/lib/xlsx-lite";

// ---------------------------------------------------------------------------
// 型別
// ---------------------------------------------------------------------------

export type SinopacDirection = "out" | "in";

/** 解析後的一行明細。金額一律是 "12594.00" 這種兩位小數字串（沒有千分位）。 */
export type SinopacLine = {
  /** 檔案裡的列號（表頭是第 1 列），錯誤訊息與預覽都用它對回原檔。 */
  lineNo: number;
  /** 帳號末四碼（帳號欄給完整帳號也只取末四碼）。 */
  last4: string;
  /** 台北時間的「YYYY-MM-DD HH:mm:ss」，雜湊用這個（不受時區設定影響）。 */
  localDateTime: string;
  /** 帶時區的 ISO（+08:00），寫進 bank_statement_lines.txn_at。 */
  txnAt: string;
  /** 台北日期 YYYY-MM-DD，比對交易日用。 */
  date: string;
  currency: string;
  withdrawal: string | null;
  deposit: string | null;
  balance: string | null;
  ref: string | null;
  remarks: string | null;
  /** 沖正欄的原文（例如 "Correction"）；空的 = 一般交易。 */
  correction: string | null;
};

export type SinopacParseErrorCode =
  | "badAccount"
  | "badDate"
  | "badCurrency"
  | "badAmount"
  | "noAmount"
  | "bothAmounts";

export type SinopacParseIssue = { lineNo: number; code: SinopacParseErrorCode; value: string };

export type SinopacParseResult = { lines: SinopacLine[]; errors: SinopacParseIssue[] };

/** 整份檔案讀不了（不是表格、缺必要欄位、編碼不對）。code 由呼叫端翻成當下語系的句子。 */
export class SinopacFileError extends Error {
  constructor(
    readonly code: "empty" | "missingColumns" | "encoding" | "xlsx",
    readonly detail?: string,
  ) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "SinopacFileError";
  }
}

// ---------------------------------------------------------------------------
// 表格讀取（CSV / TSV / xlsx）
// ---------------------------------------------------------------------------

/** 最小的 CSV 解析：引號包住的欄位可以含逗號、換行與 "" 跳脫。 */
export function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let i = 0;
  const endCell = () => {
    row.push(cell);
    cell = "";
  };
  const endRow = () => {
    endCell();
    rows.push(row);
    row = [];
  };
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"' && cell === "") {
      const q = readQuoted(text, i + 1);
      cell = q.value;
      i = q.next;
      continue;
    }
    if (ch === delimiter) endCell();
    else if (ch === "\n") endRow();
    else if (ch === "\r") {
      if (text[i + 1] === "\n") i += 1;
      endRow();
    } else cell += ch;
    i += 1;
  }
  if (cell !== "" || row.length > 0) endRow();
  return rows;
}

/** 從開頭引號的下一個字開始讀到收尾引號；"" 是跳脫的引號。回傳內容與收尾引號之後的位置。 */
function readQuoted(text: string, start: number): { value: string; next: number } {
  let value = "";
  let i = start;
  while (i < text.length) {
    if (text[i] !== '"') {
      value += text[i];
      i += 1;
    } else if (text[i + 1] === '"') {
      value += '"';
      i += 2;
    } else {
      return { value, next: i + 1 };
    }
  }
  return { value, next: i };
}

/** 純文字（CSV / TSV）→ 表格。第一個非空行有 tab 就當 TSV，否則 CSV。 */
export function tableFromText(text: string): string[][] {
  const clean = text.replace(/^﻿/, "");
  const first = clean.split(/\r?\n/).find((l) => l.trim() !== "") ?? "";
  return parseDelimited(clean, first.includes("\t") ? "\t" : ",");
}

/** UTF-8 解不開就試 Big5（台灣銀行的舊式 CSV 常見）；兩個都不行就請使用者另存 UTF-8。 */
function decodeText(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    try {
      return new TextDecoder("big5").decode(bytes);
    } catch {
      throw new SinopacFileError("encoding");
    }
  }
}

function isZip(bytes: Uint8Array): boolean {
  return bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

/** 上傳的檔案（任何格式）→ 解析結果。xlsx 看檔頭（PK），不看副檔名。 */
export async function parseSinopacFile(buf: ArrayBuffer): Promise<SinopacParseResult> {
  const bytes = new Uint8Array(buf);
  if (isZip(bytes)) {
    let table: string[][];
    try {
      table = await readXlsxFirstSheet(buf);
    } catch (e) {
      throw new SinopacFileError("xlsx", e instanceof Error ? e.message : String(e));
    }
    return parseSinopacRows(table);
  }
  return parseSinopacRows(tableFromText(decodeText(bytes)));
}

/** 純文字版（測試與腳本用）。 */
export function parseSinopacText(text: string): SinopacParseResult {
  return parseSinopacRows(tableFromText(text));
}

// ---------------------------------------------------------------------------
// 欄位
// ---------------------------------------------------------------------------

type ColumnKey =
  | "account"
  | "datetime"
  | "currency"
  | "withdrawal"
  | "deposit"
  | "balance"
  | "ref"
  | "remarks"
  | "correction";

/** 表頭別名（比對前會轉小寫、拿掉空白／底線／連字號／點）。 */
const HEADER_ALIASES: Record<ColumnKey, string[]> = {
  account: ["account", "acctlast4", "accountno", "accountnumber", "acct", "帳號"],
  datetime: ["transactiondate", "datetime", "date", "txndate", "交易日期", "交易時間", "交易日期時間"],
  currency: ["currency", "ccy", "幣別"],
  withdrawal: ["withdrawal", "withdrawals", "debit", "提款", "支出", "支出金額"],
  deposit: ["deposit", "deposits", "credit", "存款", "存入", "存入金額"],
  balance: ["balance", "餘額"],
  ref: ["transactionref", "txnref", "ref", "reference", "交易序號", "交易參考號"],
  remarks: ["remarks", "remark", "memo", "備註", "附言"],
  correction: ["correctionnote", "correction", "更正", "沖正", "更正註記"],
};

const REQUIRED: ColumnKey[] = ["account", "datetime", "currency", "withdrawal", "deposit"];

function normHeader(s: string): string {
  return s.trim().toLowerCase().replaceAll(/[\s_\-.]/g, "");
}

function mapHeader(header: string[]): Partial<Record<ColumnKey, number>> {
  const out: Partial<Record<ColumnKey, number>> = {};
  header.forEach((h, i) => {
    const n = normHeader(h);
    for (const [key, aliases] of Object.entries(HEADER_ALIASES) as [ColumnKey, string[]][]) {
      if (out[key] === undefined && aliases.includes(n)) out[key] = i;
    }
  });
  return out;
}

// ---------------------------------------------------------------------------
// 儲存格
// ---------------------------------------------------------------------------

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Excel 日期序號（1899-12-30 起算的天數，小數是時間）→ 台北的 年月日時分秒。 */
function fromExcelSerial(serial: number): [number, number, number, number, number, number] {
  const ms = Math.round((serial - 25569) * 86400 * 1000); // 25569 = 1970-01-01
  const d = new Date(ms);
  return [d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()];
}

/**
 * 交易時間 → 台北本地的各欄位。接受 2026/10/02 16:26:00、2026-10-02 16:26、2026/10/02（當天 00:00）、
 * 民國年 115/10/02，以及 xlsx 的日期序號。對帳單上的時間本來就是台北時間，不做時區換算。
 */
export function parseStatementDateTime(raw: string): { localDateTime: string; txnAt: string; date: string } | null {
  const s = raw.trim();
  if (!s) return null;
  let parts: [number, number, number, number, number, number];
  if (/^\d+(\.\d+)?$/.test(s) && Number(s) > 20000 && Number(s) < 80000) {
    parts = fromExcelSerial(Number(s));
  } else {
    const m = /^(\d{2,4})[/\-.](\d{1,2})[/\-.](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/.exec(s);
    if (!m) return null;
    let year = Number(m[1]);
    if (year < 1911) year += 1911; // 民國年
    parts = [year, Number(m[2]), Number(m[3]), Number(m[4] ?? 0), Number(m[5] ?? 0), Number(m[6] ?? 0)];
  }
  const [y, mo, d, h, mi, se] = parts;
  const check = new Date(Date.UTC(y, mo - 1, d, h, mi, se));
  if (
    check.getUTCFullYear() !== y ||
    check.getUTCMonth() !== mo - 1 ||
    check.getUTCDate() !== d ||
    h > 23 ||
    mi > 59 ||
    se > 59
  ) {
    return null;
  }
  const date = `${y}-${pad2(mo)}-${pad2(d)}`;
  const time = `${pad2(h)}:${pad2(mi)}:${pad2(se)}`;
  return { localDateTime: `${date} ${time}`, txnAt: `${date}T${time}+08:00`, date };
}

/** 金額欄：千分位、空白、貨幣符號拿掉；空的 → null；不是數字 → undefined（錯誤）。0 也算空。 */
export function parseStatementAmount(raw: string): string | null | undefined {
  const s = raw.trim().replaceAll(/[,\s$]/g, "").replace(/^(NT|TWD|USD)/i, "");
  if (s === "" || s === "-") return null;
  if (!/^-?\d+(\.\d+)?$/.test(s)) return undefined;
  const cents = Math.round(Math.abs(Number(s)) * 100);
  if (cents === 0) return null;
  return centsToString(cents);
}

/** 餘額可以是 0 或負數（透支），跟交易金額分開處理。 */
function parseBalance(raw: string): string | null | undefined {
  const s = raw.trim().replaceAll(/[,\s$]/g, "");
  if (s === "" || s === "-") return null;
  if (!/^-?\d+(\.\d+)?$/.test(s)) return undefined;
  return (Math.round(Number(s) * 100) / 100).toFixed(2);
}

export function toCents(amount: string | number): number {
  return Math.round(Math.abs(Number(amount)) * 100);
}

function centsToString(cents: number): string {
  return (cents / 100).toFixed(2);
}

function normCurrency(raw: string): string | null {
  const s = raw.trim().toUpperCase();
  if (s === "NTD" || s === "NT$" || s === "台幣" || s === "新臺幣" || s === "新台幣") return "TWD";
  if (s === "美元" || s === "美金") return "USD";
  return /^[A-Z]{3}$/.test(s) ? s : null;
}

function textOrNull(raw: string | undefined): string | null {
  const s = (raw ?? "").trim();
  return s === "" ? null : s;
}

// ---------------------------------------------------------------------------
// 解析
// ---------------------------------------------------------------------------

type RowResult = { line: SinopacLine } | { error: SinopacParseIssue };

function parseAmounts(
  lineNo: number,
  wRaw: string,
  dRaw: string,
): { withdrawal: string | null; deposit: string | null } | { error: SinopacParseIssue } {
  const withdrawal = parseStatementAmount(wRaw);
  if (withdrawal === undefined) return { error: { lineNo, code: "badAmount", value: wRaw } };
  const deposit = parseStatementAmount(dRaw);
  if (deposit === undefined) return { error: { lineNo, code: "badAmount", value: dRaw } };
  if (withdrawal === null && deposit === null) return { error: { lineNo, code: "noAmount", value: "" } };
  if (withdrawal !== null && deposit !== null) {
    return { error: { lineNo, code: "bothAmounts", value: `${wRaw} / ${dRaw}` } };
  }
  return { withdrawal, deposit };
}

function parseRow(cells: string[], lineNo: number, col: Partial<Record<ColumnKey, number>>): RowResult {
  const at = (k: ColumnKey) => {
    const i = col[k];
    return i === undefined ? "" : (cells[i] ?? "");
  };
  const digits = at("account").replaceAll(/\D/g, "");
  if (digits.length < 4) return { error: { lineNo, code: "badAccount", value: at("account") } };
  const when = parseStatementDateTime(at("datetime"));
  if (!when) return { error: { lineNo, code: "badDate", value: at("datetime") } };
  const currency = normCurrency(at("currency"));
  if (!currency) return { error: { lineNo, code: "badCurrency", value: at("currency") } };
  const amounts = parseAmounts(lineNo, at("withdrawal"), at("deposit"));
  if ("error" in amounts) return amounts;
  const balance = parseBalance(at("balance"));
  if (balance === undefined) return { error: { lineNo, code: "badAmount", value: at("balance") } };
  return {
    line: {
      lineNo,
      last4: digits.slice(-4),
      ...when,
      currency,
      ...amounts,
      balance,
      ref: textOrNull(at("ref")),
      remarks: textOrNull(at("remarks")),
      correction: textOrNull(at("correction")),
    },
  };
}

/** 表格 → 明細。第一個非空列是表頭；缺必要欄位整份拒絕，個別列有問題就記在 errors 繼續。 */
export function parseSinopacRows(table: string[][]): SinopacParseResult {
  const headerIdx = table.findIndex((r) => r.some((c) => c.trim() !== ""));
  if (headerIdx < 0) throw new SinopacFileError("empty");
  const col = mapHeader(table[headerIdx]);
  const missing = REQUIRED.filter((k) => col[k] === undefined);
  if (missing.length > 0) throw new SinopacFileError("missingColumns", missing.join(", "));

  const lines: SinopacLine[] = [];
  const errors: SinopacParseIssue[] = [];
  for (let i = headerIdx + 1; i < table.length; i += 1) {
    const cells = table[i];
    if (!cells.some((c) => c.trim() !== "")) continue;
    const r = parseRow(cells, i + 1, col);
    if ("line" in r) lines.push(r.line);
    else errors.push(r.error);
  }
  return { lines, errors };
}

// ---------------------------------------------------------------------------
// 沖正配對
// ---------------------------------------------------------------------------

export function directionOf(line: Pick<SinopacLine, "withdrawal">): SinopacDirection {
  return line.withdrawal === null ? "in" : "out";
}

export function amountOf(line: Pick<SinopacLine, "withdrawal" | "deposit">): string {
  return (line.withdrawal ?? line.deposit) as string;
}

export type CorrectionPairing = {
  /** [沖正那一行的索引, 被沖掉那一行的索引]（索引對應傳入的陣列）。 */
  pairs: [number, number][];
  /** 找不到原交易的沖正行（索引）。 */
  unpaired: number[];
};

/**
 * 沖正行（correction 欄有字）抵銷同一帳戶、同幣別、同金額、方向相反、時間不晚於它的那一行。
 * 有多個候選時：備註相同的優先 → 時間最近的 → 檔案裡排在最後（最靠近沖正行）的。
 * 每一行只能被沖一次；沖正行之間不互相配對。
 */
export function pairCorrections(lines: readonly SinopacLine[]): CorrectionPairing {
  const used = new Set<number>();
  const pairs: [number, number][] = [];
  const unpaired: number[] = [];
  const order = lines
    .map((l, i) => i)
    .filter((i) => lines[i].correction !== null)
    .sort((a, b) => lines[a].localDateTime.localeCompare(lines[b].localDateTime) || a - b);
  for (const ci of order) {
    const c = lines[ci];
    const dir = directionOf(c);
    const cents = toCents(amountOf(c));
    let best: { idx: number; sameRemarks: boolean; gap: number } | null = null;
    lines.forEach((l, j) => {
      if (j === ci || l.correction !== null || used.has(j)) return;
      if (l.last4 !== c.last4 || l.currency !== c.currency) return;
      if (directionOf(l) === dir || toCents(amountOf(l)) !== cents) return;
      if (l.localDateTime > c.localDateTime) return;
      const gap = Date.parse(c.txnAt) - Date.parse(l.txnAt);
      const sameRemarks = (l.remarks ?? "") === (c.remarks ?? "");
      const better =
        !best ||
        (sameRemarks && !best.sameRemarks) ||
        (sameRemarks === best.sameRemarks && (gap < best.gap || (gap === best.gap && j > best.idx)));
      if (better) best = { idx: j, sameRemarks, gap };
    });
    const found = best as { idx: number } | null;
    if (found) {
      used.add(found.idx);
      pairs.push([ci, found.idx]);
    } else {
      unpaired.push(ci);
    }
  }
  return { pairs, unpaired };
}

// ---------------------------------------------------------------------------
// 去重雜湊
// ---------------------------------------------------------------------------

/** 雜湊的原文：欄位用 U+001F 分隔，空值是空字串。順序與內容改了就等於換一套鍵，舊匯入會被當成新的。 */
export function lineHashInput(orgId: string, line: SinopacLine): string {
  return [
    orgId,
    line.last4,
    line.localDateTime,
    line.withdrawal ?? "",
    line.deposit ?? "",
    line.balance ?? "",
    line.ref ?? "",
    line.remarks ?? "",
  ].join("\u001f");
}

/** sha256(組織, 帳號末四碼, 時間, 提款, 存款, 餘額, 參考號, 備註) 的十六進位。Web Crypto，瀏覽器／Workers／bun 都能跑。 */
export async function sinopacLineHash(orgId: string, line: SinopacLine): Promise<string> {
  const data = new TextEncoder().encode(lineHashInput(orgId, line));
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------------------------------------------------------------------------
// 帳戶對應
// ---------------------------------------------------------------------------

export type ImportAccountOption = {
  id: number;
  name: string;
  kind: string;
  currency: string;
  isActive: boolean;
};

/** 檔案裡出現的帳戶（末四碼 + 幣別 + 筆數）。同一個末四碼出現兩種幣別時各算一筆。 */
export function statementAccounts(lines: readonly SinopacLine[]): { last4: string; currency: string; count: number }[] {
  const map = new Map<string, { last4: string; currency: string; count: number }>();
  for (const l of lines) {
    const k = `${l.last4}:${l.currency}`;
    const cur = map.get(k) ?? { last4: l.last4, currency: l.currency, count: 0 };
    cur.count += 1;
    map.set(k, cur);
  }
  return [...map.values()].sort((a, b) => a.last4.localeCompare(b.last4));
}

/**
 * 預設對應（帳本帳戶沒有帳號欄，只能猜）：同幣別、kind = bank、啟用中的帳戶剛好一個就用它；
 * 有好幾個時，名稱有「永豐」/ SinoPac 的剛好一個也算。其餘留空，讓人自己選。
 */
export function guessAccountMap(
  accounts: readonly { last4: string; currency: string }[],
  options: readonly ImportAccountOption[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const a of accounts) {
    const same = options.filter((o) => o.isActive && o.kind === "bank" && o.currency === a.currency);
    if (same.length === 1) {
      out[a.last4] = same[0].id;
      continue;
    }
    const sinopac = same.filter((o) => /永豐|sinopac/i.test(o.name));
    if (sinopac.length === 1) out[a.last4] = sinopac[0].id;
  }
  return out;
}

/** "9228=1,4952=15" → { "9228": 1, "4952": 15 }（腳本的 --map）。格式不對丟錯。 */
export function parseAccountMapArg(raw: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const part of raw.split(",").map((s) => s.trim()).filter(Boolean)) {
    const m = /^(\d{4})=(\d+)$/.exec(part);
    if (!m) throw new Error(`--map 格式應為 末四碼=帳戶id，例如 9228=1,4952=15（看到「${part}」）`);
    out[m[1]] = Number(m[2]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 比對
// ---------------------------------------------------------------------------

/** 比對窗：交易日與對帳單日期相差幾天以內。 */
export const MATCH_WINDOW_DAYS = 3;

export type MatchLine = {
  /** 呼叫端的鍵（通常是行的索引）。 */
  key: number;
  bankAccountId: number;
  date: string;
  currency: string;
  direction: SinopacDirection;
  cents: number;
  ref: string | null;
};

export type MatchCandidate = {
  id: number;
  txnDate: string;
  amount: string;
  currency: string;
  fromAccountId: number | null;
  toAccountId: number | null;
  bankRef: string | null;
  /** 交易對象（一對多比對時，同對象的一組交易優先）。 */
  partyId?: number | null;
};

function dayDiff(a: string, b: string): number {
  return Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);
}

/**
 * 這筆交易能不能對這一行：錢的方向（提款 = 從這個帳戶出去 = from_account_id；存款 = 進來 = to_account_id，
 * 不分交易類型，支出／收入／轉帳／撥款都一樣）、同幣別、金額到分、日期 ±3 天、還沒被認領，
 * 而且交易上沒有「別的」銀行參考號（已經有參考號、跟這一行不同 → 不是它）。
 * 回傳日期差（天，絕對值）；不行回傳 null。
 */
export function candidateGap(line: MatchLine, c: MatchCandidate, claimed: ReadonlySet<number>): number | null {
  if (toCents(c.amount) !== line.cents) return null;
  return windowGap(line, c, claimed);
}

/** candidateGap 不看金額的那一半：方向、幣別、參考號、日期窗、還沒被認領。 */
export function windowGap(line: MatchLine, c: MatchCandidate, claimed: ReadonlySet<number>): number | null {
  if (claimed.has(c.id)) return null;
  const sideOk = line.direction === "out" ? c.fromAccountId === line.bankAccountId : c.toAccountId === line.bankAccountId;
  if (!sideOk || c.currency !== line.currency) return null;
  const existingRef = c.bankRef?.trim() || null;
  if (existingRef && existingRef !== line.ref) return null;
  const gap = Math.abs(dayDiff(c.txnDate, line.date));
  return gap <= MATCH_WINDOW_DAYS ? gap : null;
}

/**
 * 一批明細對一批候選交易，回傳 key → 交易 id（對不到是 null）。決定性：
 * 先把所有可行的 (行, 交易) 配對排序 —— 交易上的參考號跟這行相同的最優先，再來日期差小的、
 * 行在前的、交易 id 小的 —— 依序指派，行與交易都只用一次。這樣同金額的兩行不會因為處理順序
 * 搶走彼此同一天的那一筆。
 */
export function matchStatementLines(
  lines: readonly MatchLine[],
  candidates: readonly MatchCandidate[],
  claimed: ReadonlySet<number>,
): Map<number, number | null> {
  const edges: { li: number; cand: MatchCandidate; gap: number; refHit: boolean }[] = [];
  lines.forEach((line, li) => {
    for (const cand of candidates) {
      const gap = candidateGap(line, cand, claimed);
      if (gap === null) continue;
      edges.push({ li, cand, gap, refHit: line.ref !== null && cand.bankRef?.trim() === line.ref });
    }
  });
  edges.sort(
    (a, b) =>
      Number(b.refHit) - Number(a.refHit) || a.gap - b.gap || a.li - b.li || a.cand.id - b.cand.id,
  );
  const out = new Map<number, number | null>(lines.map((l) => [l.key, null]));
  const takenLine = new Set<number>();
  const takenTxn = new Set<number>();
  for (const e of edges) {
    if (takenLine.has(e.li) || takenTxn.has(e.cand.id)) continue;
    takenLine.add(e.li);
    takenTxn.add(e.cand.id);
    out.set(lines[e.li].key, e.cand.id);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 一對多：銀行一筆 = 系統好幾筆（例如一次匯款還好幾筆代墊）
// ---------------------------------------------------------------------------

/** 一對多比對最多看幾筆候選（日期最近的優先），避免組合爆炸。 */
export const MULTI_MATCH_MAX_CANDIDATES = 30;

/** 子集合加總的金額上限（以所有金額的最大公因數為單位），超過就不試，免得陣列太大。 */
const SUBSET_MAX_UNITS = 5_000_000;

function gcd(a: number, b: number): number {
  let x = a;
  let y = b;
  while (y) [x, y] = [y, x % y];
  return x;
}

/**
 * 加總剛好等於 target 的子集合（金額單位：分）。**只在恰好一種組合時回傳**（索引，由小到大）；
 * 沒有、或有兩種以上組合（無法判斷是哪幾筆）都回 null。
 * 做法：以最大公因數縮小單位後做 0/1 背包計數（計數到 2 就停），唯一時沿著第一次到達的路徑倒推。
 */
export function uniqueSubsetSum(amounts: readonly number[], target: number): number[] | null {
  if (target <= 0 || amounts.length === 0) return null;
  const g = amounts.reduce((acc, a) => gcd(acc, a), target);
  const units = target / g;
  if (units > SUBSET_MAX_UNITS || amounts.some((a) => a <= 0)) return null;
  const count = new Uint8Array(units + 1);
  const from = new Int16Array(units + 1).fill(-1);
  count[0] = 1;
  amounts.forEach((raw, i) => {
    const a = raw / g;
    for (let s = units; s >= a; s -= 1) {
      if (count[s - a] === 0) continue;
      if (count[s] === 0) from[s] = i;
      count[s] = Math.min(2, count[s] + count[s - a]);
    }
  });
  if (count[units] !== 1) return null;
  const picked: number[] = [];
  for (let s = units; s > 0; s -= amounts[from[s]] / g) picked.push(from[s]);
  return picked.sort((a, b) => a - b);
}

/**
 * 一對多：還沒配上的一行，在 ±3 天、同方向、同幣別、還沒被認領的交易裡找「幾筆加起來剛好等於它」。
 * 1. 先看自然的一組：同一天的、同一個對象的（兩筆以上）全部加起來剛好相等 → 就是它們（只有一組符合才算）。
 * 2. 再對日期最近的 MULTI_MATCH_MAX_CANDIDATES 筆做子集合加總，**只有唯一一種組合才算**：
 *    候選一多，總有某幾筆碰巧湊得出同一個數字，不唯一就不猜，留給人看。
 * 回傳交易 id（兩筆以上）；找不到回 null。
 */
export function findMultiMatch(
  line: MatchLine,
  candidates: readonly MatchCandidate[],
  claimed: ReadonlySet<number>,
): number[] | null {
  const pool = candidates
    .map((c) => ({ c, gap: windowGap(line, c, claimed), cents: toCents(c.amount) }))
    .filter((x): x is { c: MatchCandidate; gap: number; cents: number } => x.gap !== null && x.cents > 0 && x.cents < line.cents)
    .sort((a, b) => a.gap - b.gap || a.c.id - b.c.id);
  if (pool.length < 2) return null;

  const groups = new Map<string, typeof pool>();
  for (const x of pool) {
    for (const k of [`d:${x.c.txnDate}`, x.c.partyId ? `p:${x.c.partyId}` : null]) {
      if (k) groups.set(k, [...(groups.get(k) ?? []), x]);
    }
  }
  const natural = new Map<string, number[]>();
  for (const g of groups.values()) {
    if (g.length < 2 || g.reduce((sum, x) => sum + x.cents, 0) !== line.cents) continue;
    const ids = g.map((x) => x.c.id).sort((a, b) => a - b);
    natural.set(ids.join(","), ids);
  }
  if (natural.size === 1) return [...natural.values()][0];
  if (natural.size > 1) return null;

  const top = pool.slice(0, MULTI_MATCH_MAX_CANDIDATES);
  const picked = uniqueSubsetSum(top.map((x) => x.cents), line.cents);
  if (!picked || picked.length < 2) return null;
  return picked.map((i) => top[i].c.id).sort((a, b) => a - b);
}

// ---------------------------------------------------------------------------
// 金額差一點：可能是同一筆、只是記錯金額
// ---------------------------------------------------------------------------

/** 金額相差在這個比例以內（且不為零）算「可能是同一筆」。 */
export const NEAR_MATCH_RATIO = 0.01;

/**
 * 還沒配上的一行：±3 天、同方向、同幣別、還沒被認領、金額差在 1% 以內的交易，差最少的那筆。
 * 只是提示，不會自動配對，也不會因此新建交易。
 */
export function findNearMatch(
  line: MatchLine,
  candidates: readonly MatchCandidate[],
  claimed: ReadonlySet<number>,
): { id: number; amount: string } | null {
  let best: { c: MatchCandidate; diff: number; gap: number } | null = null;
  for (const c of candidates) {
    const gap = windowGap(line, c, claimed);
    if (gap === null) continue;
    const diff = Math.abs(toCents(c.amount) - line.cents);
    if (diff === 0 || diff > line.cents * NEAR_MATCH_RATIO) continue;
    if (!best || diff < best.diff || (diff === best.diff && (gap < best.gap || (gap === best.gap && c.id < best.c.id)))) {
      best = { c, diff, gap };
    }
  }
  return best ? { id: best.c.id, amount: best.c.amount } : null;
}

/** 新建交易的說明：備註原文，沒有備註就寫「永豐明細」。 */
export function createdDescription(line: Pick<SinopacLine, "remarks">): string {
  return line.remarks ?? "永豐明細";
}

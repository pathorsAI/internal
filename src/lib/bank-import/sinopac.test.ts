import { describe, expect, test } from "bun:test";
import { writeXlsx } from "@/lib/xlsx-write";
import {
  candidateGap,
  guessAccountMap,
  lineHashInput,
  matchStatementLines,
  pairCorrections,
  parseAccountMapArg,
  parseSinopacFile,
  parseSinopacText,
  parseStatementAmount,
  parseStatementDateTime,
  sinopacLineHash,
  SinopacFileError,
  type MatchCandidate,
  type MatchLine,
} from "./sinopac";

// 真實匯出（~/Pathors/docs/bank/sinopac-statement-2026-01-21_2026-11-25.tsv）擷取的片段：
// tab 分隔、千分位、空格、尾端空欄位被省略（有的列只有 6 欄）。兩組「Correction」都在裡面。
const SAMPLE_TSV = [
  "acct_last4\tdatetime\tcurrency\twithdrawal\tdeposit\tbalance\ttxn_ref\tremarks\tcorrection",
  "9228\t2026/01/21 09:48:00\tTWD\t\t1,000,602.00\t1,000,602.00\t\t11201800398671",
  "9228\t2026/02/14 00:07:00\tTWD\t\t405.00\t920,248.00",
  "9228\t2026/10/02 10:50:00\tTWD\t38,376.00\t\t334,133.00\t\t呂安七月薪資",
  "9228\t2026/10/02 16:26:00\tTWD\t12,594.00\t\t321,539.00\t\t八月勞保",
  "9228\t2026/10/02 16:26:00\tTWD\t\t12,594.00\t334,133.00\t\t八月勞保\tCorrection",
  "9228\t2026/10/02 16:35:00\tTWD\t10,000.00\t\t324,133.00\t\t九月租金",
  "9228\t2026/11/04 16:42:00\tTWD\t1,000.00\t\t483,774.00\t\tmeet taipei 參展 保",
  "9228\t2026/11/04 19:18:00\tTWD\t4,595.00\t\t479,179.00\t\t九月健保",
  "9228\t2026/11/04 19:18:00\tTWD\t\t4,595.00\t483,774.00\t\t九月健保\tCorrection",
  "9228\t2026/11/04 19:22:00\tTWD\t7,295.00\t\t476,479.00\t\t九月健保",
  "4952\t2026/10/27 09:12:00\tUSD\t15,145.71\t\t7,000.00\t6NBBJFT300RD4TM\t11201800399228",
  "4952\t2026/11/21 00:18:00\tUSD\t\t3.77\t7,003.77\t\t11200801074958-20261120",
  "",
].join("\n");

describe("parse", () => {
  test("TSV with the short header style, thousands separators and empty cells", () => {
    const { lines, errors } = parseSinopacText(SAMPLE_TSV);
    expect(errors).toEqual([]);
    expect(lines).toHaveLength(12);
    const first = lines[0];
    expect(first).toMatchObject({
      lineNo: 2,
      last4: "9228",
      localDateTime: "2026-01-21 09:48:00",
      txnAt: "2026-01-21T09:48:00+08:00",
      date: "2026-01-21",
      currency: "TWD",
      withdrawal: null,
      deposit: "1000602.00",
      balance: "1000602.00",
      ref: null,
      remarks: "11201800398671",
      correction: null,
    });
    // 只有 6 欄的列：備註、參考號、沖正都是 null。
    expect(lines[1]).toMatchObject({ deposit: "405.00", remarks: null, ref: null, correction: null });
    const usd = lines[10];
    expect(usd).toMatchObject({ last4: "4952", currency: "USD", withdrawal: "15145.71", ref: "6NBBJFT300RD4TM" });
    expect(lines[4].correction).toBe("Correction");
  });

  test("CSV with the bank's own header names, quoted fields and a full account number", () => {
    const csv = [
      "Account,Transaction date,Currency,Withdrawal,Deposit,Balance,Transaction ref,Remarks,Correction note",
      '00012345679228,2026/10/02 16:26:00,TWD,"12,594.00",,"321,539.00",,"八月勞保, 公司負擔",',
      '1234-5678-4952,2026/10/27 09:12,USD,"15,145.71",,"7,000.00",6NBBJFT300RD4TM,11201800399228,',
    ].join("\r\n");
    const { lines, errors } = parseSinopacText(csv);
    expect(errors).toEqual([]);
    expect(lines.map((l) => l.last4)).toEqual(["9228", "4952"]);
    expect(lines[0].remarks).toBe("八月勞保, 公司負擔");
    expect(lines[0].withdrawal).toBe("12594.00");
    expect(lines[1].localDateTime).toBe("2026-10-27 09:12:00");
  });

  test("xlsx (first sheet) is read the same way", async () => {
    const bytes = writeXlsx([
      {
        name: "Sheet1",
        rows: [
        ["Account", "Transaction date", "Currency", "Withdrawal", "Deposit", "Balance", "Transaction ref", "Remarks", "Correction note"],
        ["9228", "2026/10/02 16:26:00", "TWD", "12,594.00", "", "321,539.00", "", "八月勞保", ""],
        ],
      },
    ]);
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const { lines } = await parseSinopacFile(buf);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ last4: "9228", withdrawal: "12594.00", remarks: "八月勞保" });
  });

  test("UTF-8 bytes with a BOM", async () => {
    const buf = new TextEncoder().encode(`﻿${SAMPLE_TSV}`).buffer as ArrayBuffer;
    expect((await parseSinopacFile(buf)).lines).toHaveLength(12);
  });

  test("bad rows are reported with their line numbers; the rest still parse", () => {
    const text = [
      "acct_last4\tdatetime\tcurrency\twithdrawal\tdeposit\tbalance\ttxn_ref\tremarks\tcorrection",
      "9228\t2026/13/40 10:00:00\tTWD\t100\t\t1\t\tx",
      "9228\t2026/10/02 10:00:00\tTWD\t\t\t1\t\tno amount",
      "9228\t2026/10/02 10:00:00\tTWD\t100\t200\t1\t\tboth",
      "12\t2026/10/02 10:00:00\tTWD\t100\t\t1\t\tshort account",
      "9228\t2026/10/02 10:00:00\tTWD\tabc\t\t1\t\tnot a number",
      "9228\t2026/10/02 10:00:00\tTWD\t100\t\t1\t\tok",
    ].join("\n");
    const { lines, errors } = parseSinopacText(text);
    expect(lines.map((l) => l.lineNo)).toEqual([7]);
    expect(errors.map((e) => [e.lineNo, e.code])).toEqual([
      [2, "badDate"],
      [3, "noAmount"],
      [4, "bothAmounts"],
      [5, "badAccount"],
      [6, "badAmount"],
    ]);
  });

  test("a file without the required columns is rejected as a whole", () => {
    expect(() => parseSinopacText("foo,bar\n1,2")).toThrow(SinopacFileError);
    expect(() => parseSinopacText("")).toThrow(SinopacFileError);
  });

  test("cell helpers", () => {
    expect(parseStatementAmount("1,000,602.00")).toBe("1000602.00");
    expect(parseStatementAmount(" ")).toBeNull();
    expect(parseStatementAmount("0.00")).toBeNull();
    expect(parseStatementAmount("12.3.4")).toBeUndefined();
    expect(parseStatementDateTime("2026/10/02")?.localDateTime).toBe("2026-10-02 00:00:00");
    expect(parseStatementDateTime("115/10/02 16:26")?.date).toBe("2026-10-02");
    // xlsx 日期序號：46297.6847222… = 2026-10-02 16:26:00
    expect(parseStatementDateTime(String(46297 + (16 * 60 + 26) / 1440))?.localDateTime).toBe("2026-10-02 16:26:00");
    expect(parseStatementDateTime("2026/02/30 10:00")).toBeNull();
  });
});

describe("correction pairs", () => {
  test("the sample's two Correction rows cancel 八月勞保 12,594 and 九月健保 4,595", () => {
    const { lines } = parseSinopacText(SAMPLE_TSV);
    const { pairs, unpaired } = pairCorrections(lines);
    expect(unpaired).toEqual([]);
    const byLineNo = pairs.map(([c, o]) => [lines[c].lineNo, lines[o].lineNo]);
    expect(byLineNo).toEqual([
      [6, 5], // 八月勞保 deposit (Correction) ↔ 八月勞保 withdrawal
      [10, 9], // 九月健保 4,595 deposit (Correction) ↔ 九月健保 4,595 withdrawal（不是 19:22 那筆 7,295）
    ]);
  });

  test("prefers the same remarks, then the closest earlier row; never a later row", () => {
    const text = [
      "acct_last4\tdatetime\tcurrency\twithdrawal\tdeposit\tbalance\ttxn_ref\tremarks\tcorrection",
      "9228\t2026/10/01 09:00:00\tTWD\t500\t\t1\t\t房租",
      "9228\t2026/10/01 10:00:00\tTWD\t500\t\t2\t\t別的",
      "9228\t2026/10/01 11:00:00\tTWD\t\t500\t3\t\t房租\tCorrection",
      "9228\t2026/10/01 12:00:00\tTWD\t500\t\t4\t\t房租",
    ].join("\n");
    const { lines } = parseSinopacText(text);
    const { pairs } = pairCorrections(lines);
    expect(pairs.map(([c, o]) => [lines[c].lineNo, lines[o].lineNo])).toEqual([[4, 2]]);
  });

  test("a correction without a partner is reported as unpaired", () => {
    const text = [
      "acct_last4\tdatetime\tcurrency\twithdrawal\tdeposit\tbalance\ttxn_ref\tremarks\tcorrection",
      "9228\t2026/10/01 09:00:00\tTWD\t500\t\t1\t\t房租",
      "4952\t2026/10/01 11:00:00\tUSD\t\t500\t3\t\t房租\tCorrection", // 別的帳戶
      "9228\t2026/10/01 12:00:00\tTWD\t\t499\t3\t\t房租\tCorrection", // 金額不同
    ].join("\n");
    const { lines } = parseSinopacText(text);
    const { pairs, unpaired } = pairCorrections(lines);
    expect(pairs).toEqual([]);
    expect(unpaired.map((i) => lines[i].lineNo)).toEqual([3, 4]);
  });
});

describe("hash", () => {
  test("covers org, account, time, amounts, balance, ref and remarks", async () => {
    const { lines } = parseSinopacText(SAMPLE_TSV);
    const a = await sinopacLineHash("org1", lines[3]);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await sinopacLineHash("org1", lines[3])).toBe(a);
    expect(await sinopacLineHash("org2", lines[3])).not.toBe(a);
    // 八月勞保的提款與沖正存款：同時間同備註，但金額欄位置與餘額不同 → 不同的鍵。
    expect(await sinopacLineHash("org1", lines[4])).not.toBe(a);
    expect(lineHashInput("o", lines[3]).split("\u001f")).toEqual([
      "o",
      "9228",
      "2026-10-02 16:26:00",
      "12594.00",
      "",
      "321539.00",
      "",
      "八月勞保",
    ]);
  });

  test("the same line from CSV and TSV hashes the same (formatting doesn't matter)", async () => {
    const tsv = parseSinopacText(
      "acct_last4\tdatetime\tcurrency\twithdrawal\tdeposit\tbalance\ttxn_ref\tremarks\tcorrection\n9228\t2026/10/02 16:26:00\tTWD\t12,594.00\t\t321,539.00\t\t八月勞保",
    ).lines[0];
    const csv = parseSinopacText(
      "Account,Transaction date,Currency,Withdrawal,Deposit,Balance,Transaction ref,Remarks,Correction note\n0001239228,2026-10-02 16:26,TWD,12594,,321539,,八月勞保,",
    ).lines[0];
    expect(await sinopacLineHash("o", csv)).toBe(await sinopacLineHash("o", tsv));
  });
});

describe("matching", () => {
  const ACCT = 1;
  const line = (over: Partial<MatchLine> = {}): MatchLine => ({
    key: 0,
    bankAccountId: ACCT,
    date: "2026-10-02",
    currency: "TWD",
    direction: "out",
    cents: 1_259_400,
    ref: null,
    ...over,
  });
  const txn = (over: Partial<MatchCandidate> = {}): MatchCandidate => ({
    id: 10,
    txnDate: "2026-10-02",
    amount: "12594.00",
    currency: "TWD",
    fromAccountId: ACCT,
    toAccountId: null,
    bankRef: null,
    ...over,
  });
  const none = new Set<number>();

  test("direction: a withdrawal matches money leaving the account (from), a deposit money arriving (to)", () => {
    expect(candidateGap(line(), txn(), none)).toBe(0);
    expect(candidateGap(line({ direction: "in" }), txn(), none)).toBeNull();
    expect(candidateGap(line({ direction: "in" }), txn({ fromAccountId: null, toAccountId: ACCT }), none)).toBe(0);
    // 轉帳：從這個帳戶轉出也算提款
    expect(candidateGap(line(), txn({ fromAccountId: ACCT, toAccountId: 2 }), none)).toBe(0);
    // 別的帳戶
    expect(candidateGap(line(), txn({ fromAccountId: 2 }), none)).toBeNull();
  });

  test("same currency, amount to the cent", () => {
    expect(candidateGap(line(), txn({ currency: "USD" }), none)).toBeNull();
    expect(candidateGap(line(), txn({ amount: "12594.01" }), none)).toBeNull();
    expect(candidateGap(line(), txn({ amount: "12594" }), none)).toBe(0);
  });

  test("±3 days", () => {
    expect(candidateGap(line(), txn({ txnDate: "2026-10-05" }), none)).toBe(3);
    expect(candidateGap(line(), txn({ txnDate: "2026-09-29" }), none)).toBe(3);
    expect(candidateGap(line(), txn({ txnDate: "2026-10-06" }), none)).toBeNull();
  });

  test("claimed transactions and a different existing bank_ref are skipped", () => {
    expect(candidateGap(line(), txn(), new Set([10]))).toBeNull();
    expect(candidateGap(line({ ref: "AAA" }), txn({ bankRef: "BBB" }), none)).toBeNull();
    expect(candidateGap(line(), txn({ bankRef: "BBB" }), none)).toBeNull();
    expect(candidateGap(line({ ref: "AAA" }), txn({ bankRef: "AAA" }), none)).toBe(0);
    expect(candidateGap(line({ ref: "AAA" }), txn({ bankRef: "  " }), none)).toBe(0);
  });

  test("prefers exact date, then the smallest gap, then the lowest id", () => {
    const got = matchStatementLines(
      [line()],
      [txn({ id: 3, txnDate: "2026-10-04" }), txn({ id: 7, txnDate: "2026-10-02" }), txn({ id: 5, txnDate: "2026-10-02" })],
      none,
    );
    expect(got.get(0)).toBe(5);
    const gap = matchStatementLines([line()], [txn({ id: 3, txnDate: "2026-10-05" }), txn({ id: 9, txnDate: "2026-10-01" })], none);
    expect(gap.get(0)).toBe(9);
  });

  test("each transaction is used once; two equal lines take two transactions by date", () => {
    const got = matchStatementLines(
      [line({ key: 0, date: "2026-10-01" }), line({ key: 1, date: "2026-10-03" })],
      [txn({ id: 1, txnDate: "2026-10-03" }), txn({ id: 2, txnDate: "2026-10-01" })],
      none,
    );
    expect(got.get(0)).toBe(2);
    expect(got.get(1)).toBe(1);
    const short = matchStatementLines([line({ key: 0 }), line({ key: 1 })], [txn({ id: 1 })], none);
    expect(short.get(0)).toBe(1);
    expect(short.get(1)).toBeNull();
  });

  test("a transaction already carrying the line's ref wins over a closer date", () => {
    const got = matchStatementLines(
      [line({ ref: "6NBB" })],
      [txn({ id: 1, txnDate: "2026-10-02" }), txn({ id: 2, txnDate: "2026-10-04", bankRef: "6NBB" })],
      none,
    );
    expect(got.get(0)).toBe(2);
  });
});

describe("account mapping", () => {
  const opts = [
    { id: 1, name: "公司戶 - 永豐銀行（台幣）", kind: "bank", currency: "TWD", isActive: true },
    { id: 15, name: "公司戶 - 永豐銀行（美金）", kind: "bank", currency: "USD", isActive: true },
    { id: 16, name: "Wise USD", kind: "wise", currency: "USD", isActive: true },
    { id: 20, name: "國泰（台幣）", kind: "bank", currency: "TWD", isActive: true },
  ];

  test("guesses by currency + kind bank, then by the 永豐 name", () => {
    expect(
      guessAccountMap(
        [
          { last4: "9228", currency: "TWD" },
          { last4: "4952", currency: "USD" },
          { last4: "1111", currency: "JPY" },
        ],
        opts,
      ),
    ).toEqual({ "9228": 1, "4952": 15 });
  });

  test("--map argument", () => {
    expect(parseAccountMapArg("9228=1, 4952=15")).toEqual({ "9228": 1, "4952": 15 });
    expect(() => parseAccountMapArg("9228:1")).toThrow();
  });
});

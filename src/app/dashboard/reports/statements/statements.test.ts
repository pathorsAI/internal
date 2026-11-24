import { describe, expect, test } from "bun:test";
import { createTranslator } from "next-intl";
import { messages } from "@/i18n/messages";
import statementsDict from "@/i18n/messages/statements";
import {
  balanceSheet,
  buildLedger,
  cashFlowStatement,
  incomeStatement,
  LEDGER_LABEL_KEYS,
  periodPresets,
  type LedgerInputs,
  type LedgerKind,
  type ReviewItem,
} from "@/lib/ledger";
import { BANK, CAT, inputs, invoice, tx } from "@/lib/ledger/testing/fixture";
import { readXlsxFirstSheet } from "@/lib/xlsx-lite";
import { writeXlsx } from "@/lib/xlsx-write";
import { buildStatementsWorkbook } from "@/app/api/reports/statements/export/workbook";
import { loose, rowLabel } from "./labels";
import { buildNotes } from "./notes";
import { parseStatementParams, previousPeriod, sameLastYear, statementQuery, type Preset } from "./params";

const tZh = loose(createTranslator({ locale: "zh-TW", messages: messages["zh-TW"], namespace: "statements" }));
const tEn = loose(createTranslator({ locale: "en", messages: messages.en, namespace: "statements" }));

function sample(): LedgerInputs {
  return inputs({
    bankAccounts: inputs().bankAccounts.map((b) => (b.id === BANK.sinopac ? { ...b, openingBalance: 50000 } : b)),
    fxRates: [{ currency: "USD", date: "2026-01-01", rate: 32 }],
    invoices: [invoice({ id: 9, invoiceDate: "2026-03-01" })],
    transactions: [
      tx({ id: 1, type: "income", amount: 10500, txnDate: "2026-03-05", toAccountId: BANK.sinopac, categoryId: CAT.service, invoiceId: 9 }),
      tx({ id: 2, type: "expense", amount: 2000, txnDate: "2026-01-10", fromAccountId: BANK.sinopac, categoryId: CAT.rent }),
      tx({ id: 3, type: "expense", amount: 800, txnDate: "2026-03-05", fromAccountId: BANK.wiseTwd, categoryId: CAT.rent }),
      tx({ id: 4, type: "income", amount: 100, currency: "USD", txnDate: "2026-02-01", toAccountId: BANK.wiseUsd, categoryId: CAT.service }),
      tx({ id: 5, type: "advance", amount: 500, txnDate: "2026-02-01", categoryId: CAT.supplies, settleEmployeeId: 7 }),
      tx({ id: 6, type: "expense", amount: 120, txnDate: "2026-02-03", fromAccountId: BANK.sinopac }),
    ],
  });
}

describe("labels", () => {
  test("every engine label key has a zh-TW and en translation", () => {
    for (const key of LEDGER_LABEL_KEYS) {
      expect({ key, zh: tZh.has(`labels.${key}`) }).toEqual({ key, zh: true });
      expect({ key, en: tEn.has(`labels.${key}`) }).toEqual({ key, en: true });
    }
  });

  test("every review code has a title and a description", () => {
    const codes: ReviewItem["code"][] = [
      "uncategorized",
      "missing_fx",
      "fx_estimated",
      "invoice_unlinked",
      "ar_residual",
      "shareholder_plug",
      "unmapped_default",
      "opening_balance",
      "fx_transfer_one_sided",
    ];
    for (const code of codes) {
      expect(Object.keys(statementsDict.review.codes)).toContain(code);
      expect(tEn(`review.codes.${code}.description`, { count: 2 })).not.toContain("{");
    }
  });

  test("statement rows never fall back to a raw i18n key", () => {
    const i = sample();
    for (const ledger of ["government", "management"] as LedgerKind[]) {
      const period = { from: "2026-01-01", to: "2026-06-30" };
      const rows = [
        ...balanceSheet(i, ledger, "2026-06-30", "2026-03-31").rows,
        ...incomeStatement(i, ledger, period, null).rows,
        ...cashFlowStatement(i, ledger, period, null).rows,
      ];
      for (const r of rows) {
        if (r.kind === "account" && r.glAccountId !== null) continue;
        expect({ key: r.label, text: rowLabel(tZh, r) }).not.toEqual({ key: r.label, text: r.label });
      }
    }
  });
});

describe("params", () => {
  const presets = periodPresets("2026-11-25", 1) as Preset[];

  test("defaults to the balance sheet, government ledger, year to date", () => {
    const p = parseStatementParams({}, presets, "2026-11-25");
    expect(p).toMatchObject({ report: "bs", ledger: "government", periodKey: "ytd", compare: "none", comparePeriod: null });
    expect(p.period).toEqual({ from: "2026-01-01", to: "2026-11-25" });
  });

  test("custom range, compare and as-of alias", () => {
    const p = parseStatementParams(
      { report: "is", ledger: "management", period: "custom", from: "2026-04-01", to: "2026-06-30", compare: "prev" },
      presets,
      "2026-11-25",
    );
    expect(p.period).toEqual({ from: "2026-04-01", to: "2026-06-30" });
    expect(p.comparePeriod).toEqual({ from: "2026-01-01", to: "2026-03-31" });
    expect(parseStatementParams({ asOf: "2026-03-31" }, presets, "2026-11-25").period).toEqual({
      from: "2026-01-01",
      to: "2026-03-31",
    });
    // 亂給的參數退回預設
    expect(parseStatementParams({ report: "x", ledger: "y", compare: "z" }, presets, "2026-11-25")).toMatchObject({
      report: "bs",
      ledger: "government",
      compare: "none",
    });
  });

  test("previous period and same period last year", () => {
    expect(previousPeriod({ from: "2026-03-01", to: "2026-03-31" })).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(previousPeriod({ from: "2026-03-10", to: "2026-03-19" })).toEqual({ from: "2026-02-28", to: "2026-03-09" });
    expect(sameLastYear({ from: "2024-02-01", to: "2024-02-29" })).toEqual({ from: "2023-02-01", to: "2023-02-28" });
    expect(sameLastYear({ from: "2026-01-01", to: "2026-11-25" })).toEqual({ from: "2025-01-01", to: "2025-11-25" });
  });

  test("query string round-trips", () => {
    const p = parseStatementParams({ period: "last_quarter", ledger: "management", compare: "yoy" }, presets, "2026-11-25");
    const q = Object.fromEntries(new URLSearchParams(statementQuery(p)));
    expect(parseStatementParams(q, presets, "2026-11-25")).toEqual(p);
  });
});

describe("notes", () => {
  test("cash per bank account matches the balance sheet and respects the ledger", () => {
    const i = sample();
    const asOf = "2026-06-30";
    for (const ledger of ["government", "management"] as LedgerKind[]) {
      const notes = buildNotes(i, buildLedger(i, { ledger, asOf }), ledger, asOf);
      const bsCash = balanceSheet(i, ledger, asOf, null)
        .rows.filter((r) => r.kind === "account" && i.accounts.find((a) => a.id === r.glAccountId)?.cashFlow === "cash")
        .reduce((s, r) => s + r.amount, 0);
      expect(notes.cashTotal).toBeCloseTo(bsCash, 2);
      const ids = notes.cash.map((c) => c.bankAccountId);
      if (ledger === "government") expect(ids).not.toContain(BANK.wiseTwd);
      else expect(ids).toContain(BANK.wiseTwd);
    }
  });

  test("employee advances by employee", () => {
    const i = sample();
    const notes = buildNotes(i, buildLedger(i, { ledger: "management", asOf: "2026-06-30" }), "management", "2026-06-30");
    expect(notes.employeeAdvances).toEqual([{ employeeId: 7, name: i.employeeNames[7] ?? null, balance: 500 }]);
  });
});

describe("Excel export", () => {
  test("seven sheets; the trial balance sheet balances", async () => {
    const i = sample();
    const params = parseStatementParams({ period: "this_year" }, periodPresets("2026-11-25", 1) as Preset[], "2026-11-25");
    const built = buildLedger(i, { ledger: params.ledger, asOf: params.period.to });
    const sheets = buildStatementsWorkbook(tZh, i, built, params);
    expect(sheets.map((s) => s.name)).toEqual(["試算表", "資產負債表", "綜合損益表", "現金流量表", "權益變動表", "總分類帳", "待處理"]);

    const bytes = writeXlsx(sheets);
    const table = await readXlsxFirstSheet(bytes.buffer.slice(0) as ArrayBuffer);
    expect(table[0][0]).toBe(i.orgName);
    const total = table.find((r) => r[1] === "合計");
    expect(total).toBeDefined();
    expect(Number(total?.[3])).toBeCloseTo(Number(total?.[4]), 2);
    expect(Number(total?.[3])).toBeGreaterThan(0);
  });
});

import { describe, expect, test } from "bun:test";

import {
  accountLedger,
  balanceSheet,
  buildLedger,
  cashFlowStatement,
  effectiveMappings,
  equityChanges,
  fiscalYearStart,
  incomeStatement,
  periodPresets,
  runChecks,
  trialBalance,
  vatReport,
  type LedgerInputs,
  type LedgerKind,
  type Statement,
} from "./index";
import { ACCOUNTS, asset, BANK, BANKS, CAT, gl, inputs, invoice, tx } from "./testing/fixture";

/** 兩個會計年度、政府戶＋隱形戶、USD 帳戶且匯率一路變動的混合資料。 */
function mixed(): LedgerInputs {
  return inputs({
    bankAccounts: BANKS.map((b) => (b.id === BANK.sinopac ? { ...b, openingBalance: 100000 } : b.id === BANK.wiseTwd ? { ...b, openingBalance: 20000 } : b)),
    fxRates: [
      { currency: "USD", date: "2025-12-01", rate: 30 },
      { currency: "USD", date: "2025-12-31", rate: 30.5 },
      { currency: "USD", date: "2026-01-31", rate: 31 },
      { currency: "USD", date: "2026-02-10", rate: 31.4 },
      { currency: "USD", date: "2026-02-28", rate: 32 },
      { currency: "USD", date: "2026-03-31", rate: 31.2 },
      { currency: "USD", date: "2026-06-15", rate: 33 },
      { currency: "USD", date: "2026-12-31", rate: 34 },
    ],
    invoices: [invoice({ id: 9, invoiceDate: "2026-03-01" }), invoice({ id: 10, invoiceDate: "2026-04-01" })],
    fixedAssets: [asset({ id: 1, sourceTransactionId: 8, acquiredOn: "2026-01-20" })],
    transactions: [
      tx({ id: 1, type: "income", amount: 1000, currency: "USD", txnDate: "2025-12-05", toAccountId: BANK.wiseUsd, categoryId: CAT.service }),
      tx({ id: 2, type: "income", amount: 500, currency: "USD", txnDate: "2025-12-10", toAccountId: BANK.sinopacUsd, categoryId: CAT.service }),
      tx({ id: 3, type: "expense", amount: 2000, txnDate: "2026-01-10", fromAccountId: BANK.sinopac, categoryId: CAT.rent }),
      tx({ id: 4, type: "transfer", amount: 200, currency: "USD", amountTwd: 6300, txnDate: "2026-02-15", fromAccountId: BANK.sinopacUsd, toAccountId: BANK.sinopac }),
      tx({ id: 5, type: "income", amount: 10500, txnDate: "2026-03-05", toAccountId: BANK.sinopac, categoryId: CAT.service, invoiceId: 9 }),
      tx({ id: 6, type: "expense", amount: 800, txnDate: "2026-03-05", fromAccountId: BANK.wiseTwd, categoryId: CAT.rent }),
      tx({ id: 7, type: "expense", book: "internal", amount: 300, txnDate: "2026-03-06", fromAccountId: BANK.sinopac, categoryId: CAT.rent }),
      tx({ id: 8, type: "expense", amount: 36000, txnDate: "2026-01-20", fromAccountId: BANK.sinopac, categoryId: CAT.other }),
      tx({ id: 11, type: "advance", amount: 500, txnDate: "2026-02-01", categoryId: CAT.supplies, settleEmployeeId: 7 }),
      tx({ id: 12, type: "reimbursement", amount: 500, txnDate: "2026-02-20", fromAccountId: BANK.sinopac, relatedToId: 11 }),
      tx({ id: 13, type: "advance", amount: 250, txnDate: "2026-05-01", categoryId: CAT.supplies, settleEmployeeId: 7 }),
      tx({ id: 14, type: "transfer", amount: 5000, txnDate: "2026-04-10", fromAccountId: BANK.wiseTwd, toAccountId: BANK.sinopac }),
      tx({ id: 15, type: "expense", amount: 50, currency: "USD", txnDate: "2026-05-10", fromAccountId: BANK.wiseUsd, categoryId: CAT.rent, book: "internal" }),
      tx({ id: 16, type: "income", amount: 3000, txnDate: "2026-04-05", toAccountId: BANK.sinopac, categoryId: CAT.service, invoiceId: 10 }),
    ],
  });
}

const LEDGERS: LedgerKind[] = ["government", "management"];
const amt = (s: Statement, key: string) => s.rows.find((r) => r.key === key)?.amount ?? 0;
const cmpAmt = (s: Statement, key: string) => s.rows.find((r) => r.key === key)?.compareAmount ?? 0;
const cashOf = (s: Statement, compare = false) =>
  Math.round(
    s.rows
      .filter((r) => r.kind === "account" && r.glAccountId != null && ACCOUNTS.find((a) => a.id === r.glAccountId)?.cashFlow === "cash")
      .reduce((sum, r) => sum + (compare ? (r.compareAmount ?? 0) : r.amount), 0) * 100,
  ) / 100;

describe("資產負債表與損益表", () => {
  for (const ledger of LEDGERS) {
    test(`${ledger}：資產 = 負債 + 權益（含比較日）`, () => {
      const i = mixed();
      for (const [asOf, cmp] of [
        ["2026-06-15", "2025-12-31"],
        ["2026-12-31", "2026-03-31"],
        ["2026-02-20", null],
      ] as const) {
        const bs = balanceSheet(i, ledger, asOf, cmp);
        expect(amt(bs, "totals.assets")).toBeCloseTo(amt(bs, "totals.liabilities_equity"), 2);
        if (cmp) expect(cmpAmt(bs, "totals.assets")).toBeCloseTo(cmpAmt(bs, "totals.liabilities_equity"), 2);
        expect(amt(bs, "totals.assets")).not.toBe(0);
      }
    });

    test(`${ledger}：年度累計淨利 = 資產負債表本期損益；累積盈虧 = 上年度淨利`, () => {
      const i = mixed();
      const asOf = "2026-06-15";
      const bs = balanceSheet(i, ledger, asOf, null);
      const is = incomeStatement(i, ledger, { from: fiscalYearStart(asOf, 1), to: asOf }, null);
      expect(amt(is, "subtotal:net_income")).toBeCloseTo(amt(bs, "rows.current_earnings"), 2);
      const lastYear = incomeStatement(i, ledger, { from: "2025-01-01", to: "2025-12-31" }, null);
      expect(amt(lastYear, "subtotal:net_income")).toBeCloseTo(amt(bs, "rows.prior_earnings"), 2);
      // 有未實現兌換損益（USD 帳戶、匯率變了）
      expect(is.rows.some((r) => r.glAccountId === gl("7130") && r.amount !== 0)).toBe(true);
      expect(is.rows.find((r) => r.key === "subtotal:net_income")!.kind).toBe("total");
    });

    test(`${ledger}：任意起日的期間淨利 = 兩個資產負債表日的盈餘差`, () => {
      const i = mixed();
      const from = "2026-02-12";
      const to = "2026-06-15";
      const before = balanceSheet(i, ledger, "2026-02-11", null);
      const after = balanceSheet(i, ledger, to, null);
      const earnings = (s: Statement) => amt(s, "rows.prior_earnings") + amt(s, "rows.current_earnings");
      const is = incomeStatement(i, ledger, { from, to }, { from: "2025-12-01", to: "2025-12-31" });
      expect(amt(is, "subtotal:net_income")).toBeCloseTo(earnings(after) - earnings(before), 2);
      expect(is.comparePeriod).toEqual({ from: "2025-12-01", to: "2025-12-31" });
    });

    test(`${ledger}：現金流量表 期初 + 淨變動 = 期末，且和資產負債表的現金一致`, () => {
      const i = mixed();
      for (const period of [
        { from: "2026-01-01", to: "2026-06-15" },
        { from: "2026-02-12", to: "2026-12-31" },
      ]) {
        const cf = cashFlowStatement(i, ledger, period, null);
        expect(amt(cf, "cf.opening_cash") + amt(cf, "cf.net_change")).toBeCloseTo(amt(cf, "cf.closing_cash"), 2);
        const prev = new Date(Date.parse(period.from) - 86400000).toISOString().slice(0, 10);
        expect(amt(cf, "cf.opening_cash")).toBeCloseTo(cashOf(balanceSheet(i, ledger, prev, null)), 2);
        expect(amt(cf, "cf.closing_cash")).toBeCloseTo(cashOf(balanceSheet(i, ledger, period.to, null)), 2);
      }
      const cf = cashFlowStatement(i, ledger, { from: "2026-01-01", to: "2026-06-15" }, null);
      expect(amt(cf, "cf.depreciation")).toBe(5000);
    });

    test(`${ledger}：試算表借貸相等；權益變動表期末 = 資產負債表權益`, () => {
      const i = mixed();
      const tb = trialBalance(i, ledger, { from: "2026-01-01", to: "2026-06-15" });
      const d = tb.reduce((s, r) => s + r.debit, 0);
      const c = tb.reduce((s, r) => s + r.credit, 0);
      expect(d).toBeCloseTo(c, 2);
      expect(tb.reduce((s, r) => s + r.closing, 0)).toBeCloseTo(0, 2);
      const eq = equityChanges(i, ledger, { from: "2026-01-01", to: "2026-06-15" });
      const closing = eq.find((r) => r.key === "closing")!;
      const opening = eq.find((r) => r.key === "opening")!;
      expect(closing.total).toBeCloseTo(amt(balanceSheet(i, ledger, "2026-06-15", null), "section_total:equity"), 2);
      expect(opening.total).toBeCloseTo(amt(balanceSheet(i, ledger, "2025-12-31", null), "section_total:equity"), 2);
    });

    test(`${ledger}：每張分錄平衡、銀行科目對得上`, () => {
      const i = mixed();
      i.reconciliations = [
        { accountId: BANK.sinopac, asOfDate: "2026-06-15", statementBalance: 100000 - 2000 + 6300 + 10500 - 300 - 36000 - 500 + 5000 + 3000 },
        { accountId: BANK.sinopacUsd, asOfDate: "2026-06-15", statementBalance: 300 },
        { accountId: BANK.wiseUsd, asOfDate: "2026-06-15", statementBalance: 940 },
      ];
      const checks = runChecks(i, ledger, "2026-06-15");
      expect(checks.find((c) => c.code === "entries_balanced")!.status).toBe("pass");
      expect(checks.find((c) => c.code === "balance_sheet_balances")!.status).toBe("pass");
      const recs = checks.filter((c) => c.code === "bank_reconciliation");
      expect(recs.length).toBe(ledger === "government" ? 2 : 3);
      expect(recs.find((c) => c.params.accountId === BANK.sinopac)!.status).toBe("pass");
      expect(recs.find((c) => c.params.accountId === BANK.sinopacUsd)!.status).toBe("pass");
      if (ledger === "management") expect(recs.find((c) => c.params.accountId === BANK.wiseUsd)!.status).toBe("fail");
      expect(checks.find((c) => c.code === "employee_subledger")!.status).toBe("pass");
      expect(checks.find((c) => c.code === "employee_subledger")!.params.gl).toBe(250);
      // 發票 10 只收到 3000 → 應收未沖
      const ar = checks.find((c) => c.code === "ar_open")!;
      expect([ar.status, ar.params.amount]).toEqual(["warn", 7500]);
    });
  }

  test("政府帳的股東往來 = 公司與隱形帳之間的淨流動", () => {
    const bs = balanceSheet(mixed(), "government", "2026-06-15", null);
    // 貸方為正（公司欠股東）：Wise 收 USD 1000 報收入（股東替公司收，−30000）、Wise 付要報的 800（+800）、
    // 永豐付 internal 300（股東取用，−300）、Wise 轉入永豐 5000（+5000）
    expect(bs.rows.find((r) => r.glAccountId === gl("2295"))!.amount).toBe(-30000 + 800 - 300 + 5000);
  });

  test("外幣評價只到 asOf；月底評價有沖回", () => {
    const { postings } = buildLedger(mixed(), { ledger: "management", asOf: "2026-03-15" });
    const reval = postings.filter((p) => p.sourceType === "fx_revaluation");
    expect(reval.every((p) => p.date <= "2026-03-15")).toBe(true);
    expect(reval.some((p) => p.key.endsWith(":reversal") && p.date === "2026-03-01")).toBe(true);
    expect(reval.filter((p) => p.date === "2026-03-15").length).toBe(1);
  });

  test("科目明細從期初累計", () => {
    const lines = accountLedger(mixed(), "government", gl("1113"), { from: "2026-03-01", to: "2026-03-31" });
    expect(lines.map((l) => l.postingKey)).toEqual(["transaction:5:government", "transaction:7:government"]);
    expect(lines[0].counterAccounts).toEqual(["1170"]);
    expect(lines[1].balance).toBe(100000 - 2000 - 36000 + 6300 - 500 + 10500 - 300);
  });
});

describe("營業稅", () => {
  const vatInputs = (regime: "general" | "small_scale") =>
    inputs({
      settings: { vatRegime: regime },
      invoices: [
        invoice({ id: 1, invoiceDate: "2026-05-10", amountNet: 10000, tax: 500, amountGross: 10500 }),
        invoice({ id: 2, invoiceDate: "2026-06-01", amountNet: 2000, tax: 0, amountGross: 2000, taxTreatment: "zero_rated" }),
        invoice({ id: 3, invoiceDate: "2026-05-20", direction: "received", amountNet: 1000, tax: 50, amountGross: 1050 }),
        invoice({ id: 4, invoiceDate: "2026-05-21", status: "void" }),
      ],
      transactions: [
        tx({ id: 1, type: "income", amount: 10500, txnDate: "2026-05-15", toAccountId: BANK.sinopac, categoryId: CAT.service, invoiceId: 1 }),
        tx({ id: 2, type: "income", amount: 2000, txnDate: "2026-06-05", toAccountId: BANK.sinopac, categoryId: CAT.service, invoiceId: 2 }),
        tx({ id: 3, type: "expense", amount: 1050, txnDate: "2026-05-20", fromAccountId: BANK.sinopac, categoryId: CAT.rent, invoiceId: 3 }),
        tx({ id: 4, type: "income", amount: 700, txnDate: "2026-06-10", toAccountId: BANK.sinopac, categoryId: CAT.service }),
      ],
    });

  test("一般營業人：雙月一期，銷項 − 進項", () => {
    const rows = vatReport(vatInputs("general"), 2026);
    expect(rows.length).toBe(6);
    const r = rows.find((x) => x.label === "2026-05/06")!;
    expect([r.from, r.to]).toEqual(["2026-05-01", "2026-06-30"]);
    expect(r.invoiceTaxableNet).toBe(10000);
    expect(r.invoiceZeroRatedNet).toBe(2000);
    expect(r.invoiceOutputTax).toBe(500);
    expect(r.invoiceInputTax).toBe(50);
    expect(r.glRevenue).toBe(12700);
    expect(r.glOutputTax).toBe(500);
    expect(r.glInputTax).toBe(50);
    expect(r.taxDue).toBe(450);
    expect(r.difference).toBe(-700);
  });

  test("小規模：每季一期，查定稅率 × 總帳收入 − 10% 進項", () => {
    const rows = vatReport(vatInputs("small_scale"), 2026);
    expect(rows.map((r) => r.label)).toEqual(["2026-01/03", "2026-04/06", "2026-07/09", "2026-10/12"]);
    const q2 = rows[1];
    expect(q2.taxDue).toBe(Math.round((0.01 * 12700 - 0.1 * 50) * 100) / 100);
    expect(rows[0].taxDue).toBe(0);
  });

  test("沒有營業稅 → 空", () => {
    expect(vatReport(inputs({ settings: { vatRegime: "none" } }), 2026)).toEqual([]);
  });
});

describe("設定與期間", () => {
  test("有效科目對應", () => {
    const m = effectiveMappings(inputs());
    expect(m.categories[CAT.supplies]).toEqual({ glAccountId: gl("6113"), isDefault: false });
    expect(m.categories[CAT.service]).toEqual({ glAccountId: gl("4611"), isDefault: true });
    expect(m.categories[CAT.fx]).toEqual({ glAccountId: gl("7130"), isDefault: true });
    expect(m.bankAccounts[BANK.wiseUsd]).toEqual({ glAccountId: gl("1114"), isDefault: true });
  });

  test("科目表缺預設代碼 → 退回 system key，不丟例外", () => {
    const i = inputs({ accounts: ACCOUNTS.filter((a) => a.code !== "6112" && a.code !== "1114") });
    const m = effectiveMappings(i);
    expect(m.categories[CAT.rent].glAccountId).toBe(gl("6999"));
    expect(m.bankAccounts[BANK.wiseUsd].glAccountId).toBe(gl("1113"));
  });

  test("會計年度與預設期間", () => {
    expect(fiscalYearStart("2026-03-15", 1)).toBe("2026-01-01");
    expect(fiscalYearStart("2026-03-15", 4)).toBe("2025-04-01");
    expect(fiscalYearStart("2026-04-01", 4)).toBe("2026-04-01");
    const p = Object.fromEntries(periodPresets("2026-11-25", 4).map((x) => [x.key, x.period]));
    expect(p.this_month).toEqual({ from: "2026-11-01", to: "2026-11-30" });
    expect(p.last_month).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(p.this_quarter).toEqual({ from: "2026-10-01", to: "2026-12-31" });
    expect(p.last_quarter).toEqual({ from: "2026-07-01", to: "2026-09-30" });
    expect(p.ytd).toEqual({ from: "2026-04-01", to: "2026-11-25" });
    expect(p.this_year).toEqual({ from: "2026-04-01", to: "2027-03-31" });
    expect(p.last_year).toEqual({ from: "2025-04-01", to: "2026-03-31" });
    const jan = Object.fromEntries(periodPresets("2026-01-15", 1).map((x) => [x.key, x.period]));
    expect(jan.last_month).toEqual({ from: "2025-12-01", to: "2025-12-31" });
    expect(jan.last_quarter).toEqual({ from: "2025-10-01", to: "2025-12-31" });
  });
});

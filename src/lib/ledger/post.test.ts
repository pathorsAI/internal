import { describe, expect, test } from "bun:test";

import { buildLedger, computeSnapshot, reviewItems } from "./index";
import { asset, BANK, CAT, gl, inputs, invoice, shape, snapshotEntry, tx } from "./testing/fixture";
import type { LedgerInputs, LedgerKind } from "./types";

const ASOF = "2026-12-31";
const build = (i: LedgerInputs, ledger: LedgerKind, asOf = ASOF) => buildLedger(i, { ledger, asOf });
const find = (i: LedgerInputs, ledger: LedgerKind, key: string) => build(i, ledger).postings.find((p) => p.key === key);

describe("交易分錄", () => {
  test("income／expense 在政府戶：兩本帳一樣", () => {
    const i = inputs({
      transactions: [
        tx({ id: 1, type: "income", amount: 5000, txnDate: "2026-02-01", toAccountId: BANK.sinopac, categoryId: CAT.service }),
        tx({ id: 2, type: "expense", amount: 1200, txnDate: "2026-02-02", fromAccountId: BANK.sinopac, categoryId: CAT.rent }),
      ],
    });
    for (const l of ["government", "management"] as const) {
      expect(shape(find(i, l, `transaction:1:${l}`))).toEqual({ "1113": 5000, "4611": -5000 });
      expect(shape(find(i, l, `transaction:2:${l}`))).toEqual({ "6112": 1200, "1113": -1200 });
    }
    const bankLine = find(i, "government", "transaction:1:government")!.lines.find((x) => x.glAccountId === gl("1113"))!;
    expect(bankLine.bankAccountId).toBe(BANK.sinopac);
  });

  test("Wise 付、要報（book both）→ 政府帳 借費用 貸股東往來", () => {
    const i = inputs({ transactions: [tx({ id: 1, type: "expense", amount: 800, txnDate: "2026-02-01", fromAccountId: BANK.wiseTwd, categoryId: CAT.rent })] });
    expect(shape(find(i, "government", "transaction:1:government"))).toEqual({ "6112": 800, "2295": -800 });
    expect(shape(find(i, "management", "transaction:1:management"))).toEqual({ "6112": 800, "1113": -800 });
    const r = reviewItems(i, ASOF).find((x) => x.code === "shareholder_plug");
    expect(r?.ledger).toBe("government");
  });

  test("永豐付、不入政府帳（book internal）→ 政府帳 借股東往來 貸銀行", () => {
    const i = inputs({ transactions: [tx({ id: 1, type: "expense", book: "internal", amount: 300, txnDate: "2026-02-01", fromAccountId: BANK.sinopac, categoryId: CAT.rent })] });
    expect(shape(find(i, "government", "transaction:1:government"))).toEqual({ "2295": 300, "1113": -300 });
    expect(shape(find(i, "management", "transaction:1:management"))).toEqual({ "6112": 300, "1113": -300 });
  });

  test("隱形帳戶上只在管理帳的收支 → 政府帳沒有分錄", () => {
    const i = inputs({ transactions: [tx({ id: 1, type: "expense", book: "internal", amount: 300, txnDate: "2026-02-01", fromAccountId: BANK.wiseTwd, categoryId: CAT.rent })] });
    expect(find(i, "government", "transaction:1:government")).toBeUndefined();
    expect(find(i, "management", "transaction:1:management")).toBeDefined();
    expect(reviewItems(i, ASOF).some((x) => x.code === "shareholder_plug")).toBe(false);
  });

  test("Wise → 永豐 轉帳：政府帳只有永豐那側，對方股東往來", () => {
    const i = inputs({ transactions: [tx({ id: 1, type: "transfer", amount: 2000, txnDate: "2026-02-01", fromAccountId: BANK.wiseTwd, toAccountId: BANK.sinopac })] });
    const g = find(i, "government", "transaction:1:government")!;
    expect(shape(g)).toEqual({ "1113": 2000, "2295": -2000 });
    expect(g.lines.find((l) => l.glAccountId === gl("1113"))!.bankAccountId).toBe(BANK.sinopac);
    // 管理帳兩邊都是 1113，但子帳（銀行帳戶）不同所以不合併
    const m = find(i, "management", "transaction:1:management")!;
    expect(m.lines.map((l) => [l.bankAccountId, l.debit - l.credit])).toEqual([
      [BANK.sinopac, 2000],
      [BANK.wiseTwd, -2000],
    ]);
  });

  test("代墊與報帳；報 internal 代墊在政府帳換成股東往來", () => {
    const i = inputs({
      transactions: [
        tx({ id: 1, type: "advance", amount: 500, txnDate: "2026-02-01", categoryId: CAT.supplies, settleEmployeeId: 7 }),
        tx({ id: 2, type: "reimbursement", amount: 500, txnDate: "2026-02-10", fromAccountId: BANK.sinopac, relatedToId: 1 }),
        tx({ id: 3, type: "advance", book: "internal", amount: 200, txnDate: "2026-02-01", categoryId: CAT.supplies, settleEmployeeId: 7 }),
        tx({ id: 4, type: "reimbursement", amount: 200, txnDate: "2026-02-10", fromAccountId: BANK.sinopac, relatedToId: 3 }),
      ],
    });
    expect(shape(find(i, "management", "transaction:1:management"))).toEqual({ "6113": 500, "2281": -500 });
    const reimb = find(i, "management", "transaction:2:management")!;
    expect(shape(reimb)).toEqual({ "2281": 500, "1113": -500 });
    expect(reimb.lines.find((l) => l.glAccountId === gl("2281"))!.employeeId).toBe(7);
    expect(find(i, "government", "transaction:3:government")).toBeUndefined();
    expect(shape(find(i, "government", "transaction:4:government"))).toEqual({ "2295": 200, "1113": -200 });
    expect(shape(find(i, "government", "transaction:2:government"))).toEqual({ "2281": 500, "1113": -500 });
  });

  test("沒分類 → 待分類科目＋待處理；沒帳戶 → unpaid_clearing", () => {
    const i = inputs({ transactions: [tx({ id: 1, type: "expense", amount: 99, txnDate: "2026-02-01" })] });
    expect(shape(find(i, "management", "transaction:1:management"))).toEqual({ "6999": 99, "2282": -99 });
    const r = reviewItems(i, ASOF).find((x) => x.code === "uncategorized");
    expect(r?.ledger).toBe("both");
  });

  test("收到發票含稅且金額相符 → 拆進項稅", () => {
    const i = inputs({
      invoices: [invoice({ id: 9, direction: "received", amountNet: 1000, tax: 50, amountGross: 1050 })],
      transactions: [tx({ id: 1, type: "expense", amount: 1050, txnDate: "2026-02-01", fromAccountId: BANK.sinopac, categoryId: CAT.rent, invoiceId: 9 })],
    });
    expect(shape(find(i, "government", "transaction:1:government"))).toEqual({ "1268": 50, "6112": 1000, "1113": -1050 });
  });

  test("外幣沒有台幣金額、也沒有匯率 → 不入帳、missing_fx", () => {
    const i = inputs({ transactions: [tx({ id: 1, type: "expense", amount: 10, currency: "USD", txnDate: "2026-02-01", fromAccountId: BANK.wiseUsd, categoryId: CAT.rent })] });
    expect(find(i, "management", "transaction:1:management")).toBeUndefined();
    const r = reviewItems(i, ASOF).find((x) => x.code === "missing_fx");
    expect(r?.severity).toBe("error");
    expect(r?.ledger).toBe("both");
  });

  test("外幣用最近匯率、超過 7 天 → fx_estimated；外幣帳戶行帶原幣", () => {
    const i = inputs({
      fxRates: [{ currency: "USD", date: "2026-01-01", rate: 32 }],
      transactions: [tx({ id: 1, type: "expense", amount: 10, currency: "USD", txnDate: "2026-02-01", fromAccountId: BANK.wiseUsd, categoryId: CAT.rent })],
    });
    const p = find(i, "management", "transaction:1:management")!;
    expect(shape(p)).toEqual({ "6112": 320, "1114": -320 });
    const bank = p.lines.find((l) => l.glAccountId === gl("1114"))!;
    expect([bank.currency, bank.fxAmount]).toEqual(["USD", -10]);
    expect(reviewItems(i, ASOF).some((x) => x.code === "fx_estimated")).toBe(true);
  });

  test("換匯分類只有一邊 → fx_transfer_one_sided", () => {
    const i = inputs({
      transactions: [tx({ id: 1, type: "income", amount: 3200, txnDate: "2026-02-01", toAccountId: BANK.sinopac, categoryId: CAT.fx })],
    });
    expect(shape(find(i, "management", "transaction:1:management"))).toEqual({ "1113": 3200, "7130": -3200 });
    expect(reviewItems(i, ASOF).some((x) => x.code === "fx_transfer_one_sided")).toBe(true);
  });
});

describe("發票", () => {
  test("綁收款的開立發票：發票日認列收入與銷項，收款沖 ar，小差額記手續費", () => {
    const i = inputs({
      invoices: [invoice({ id: 9 })],
      transactions: [tx({ id: 1, type: "income", amount: 10470, txnDate: "2026-03-20", toAccountId: BANK.sinopac, categoryId: CAT.service, invoiceId: 9 })],
    });
    for (const l of ["government", "management"] as const) {
      expect(shape(find(i, l, `invoice:9:${l}`))).toEqual({ "1170": 10500, "4611": -10000, "2204": -500 });
      expect(shape(find(i, l, `transaction:1:${l}`))).toEqual({ "1113": 10470, "1170": -10470 });
      expect(shape(find(i, l, `invoice:9:${l}:residual`))).toEqual({ "6132": 30, "1170": -30 });
    }
  });

  test("綁發票的收款即使 book internal、收在 Wise，政府帳仍認列 ar", () => {
    const i = inputs({
      invoices: [invoice({ id: 9 })],
      transactions: [tx({ id: 1, type: "income", book: "internal", amount: 10500, txnDate: "2026-03-20", toAccountId: BANK.wiseTwd, categoryId: CAT.service, invoiceId: 9 })],
    });
    expect(shape(find(i, "government", "transaction:1:government"))).toEqual({ "2295": 10500, "1170": -10500 });
  });

  test("外幣發票差額記兌換損益；大差額留在 ar 並列待處理", () => {
    const i = inputs({
      invoices: [invoice({ id: 9, foreignCurrency: "USD", tax: 0, amountNet: 32000, amountGross: 32000 }), invoice({ id: 10 })],
      transactions: [
        tx({ id: 1, type: "income", amount: 31500, txnDate: "2026-03-20", toAccountId: BANK.sinopac, categoryId: CAT.service, invoiceId: 9 }),
        tx({ id: 2, type: "income", amount: 5000, txnDate: "2026-03-20", toAccountId: BANK.sinopac, categoryId: CAT.service, invoiceId: 10 }),
      ],
    });
    expect(shape(find(i, "management", "invoice:9:management:residual"))).toEqual({ "7130": 500, "1170": -500 });
    expect(find(i, "management", "invoice:10:management:residual")).toBeUndefined();
    const r = reviewItems(i, ASOF).find((x) => x.code === "ar_residual");
    expect(r?.sourceId).toBe(10);
    expect(r?.amount).toBe(5500);
  });

  test("沒綁收款的開立發票不入帳，列 invoice_unlinked", () => {
    const i = inputs({ invoices: [invoice({ id: 9 })] });
    expect(find(i, "management", "invoice:9:management")).toBeUndefined();
    const r = reviewItems(i, ASOF).find((x) => x.code === "invoice_unlinked");
    expect([r?.sourceType, r?.sourceId, r?.ledger, r?.severity]).toEqual(["invoice", 9, "both", "warning"]);
  });
});

describe("期初、折舊、快照", () => {
  test("booksStartDate 之後才開帳：之前的交易併進期初，記在前一天", () => {
    const i = inputs({
      settings: { booksStartDate: "2026-03-01" },
      bankAccounts: inputs().bankAccounts.map((b) => (b.id === BANK.sinopac ? { ...b, openingBalance: 1000 } : b)),
      transactions: [
        tx({ id: 1, type: "income", amount: 5000, txnDate: "2026-01-10", toAccountId: BANK.sinopac, categoryId: CAT.service }),
        tx({ id: 2, type: "expense", amount: 700, txnDate: "2026-02-10", fromAccountId: BANK.wiseTwd, categoryId: CAT.rent }),
        tx({ id: 3, type: "expense", amount: 100, txnDate: "2026-03-05", fromAccountId: BANK.sinopac, categoryId: CAT.rent }),
      ],
    });
    const g = build(i, "government").postings;
    expect(g.find((p) => p.key === "transaction:1:government")).toBeUndefined();
    const open = g.find((p) => p.key === `opening:${BANK.sinopac}:government`)!;
    expect(open.date).toBe("2026-02-28");
    expect(shape(open)).toEqual({ "1113": 6000, "3110": -6000 });
    // 隱形帳戶的期初只在管理帳
    expect(g.find((p) => p.key === `opening:${BANK.wiseTwd}:government`)).toBeUndefined();
    const m = build(i, "management").postings.find((p) => p.key === `opening:${BANK.wiseTwd}:management`)!;
    expect(shape(m)).toEqual({ "1113": -700, "3110": 700 });
    expect(g.some((p) => p.key === "transaction:3:government")).toBe(true);
  });

  test("折舊：每月月底、最後一月吸收尾差、處分月後停", () => {
    const i = inputs({ fixedAssets: [asset({ id: 1, cost: 1000, usefulLifeMonths: 3 }), asset({ id: 2, cost: 1200, usefulLifeMonths: 12, disposedOn: "2026-03-15" })] });
    const dep = build(i, "management").postings.filter((p) => p.sourceType === "depreciation");
    const a1 = dep.filter((p) => p.sourceId === 1);
    expect(a1.map((p) => [p.date, shape(p)["6125"]])).toEqual([
      ["2026-01-31", 333.33],
      ["2026-02-28", 333.33],
      ["2026-03-31", 333.34],
    ]);
    expect(shape(a1[0])).toEqual({ "6125": 333.33, "1689": -333.33 });
    expect(dep.filter((p) => p.sourceId === 2).length).toBe(3);
    // asOf 前的才有
    expect(buildLedger(i, { ledger: "management", asOf: "2026-02-15" }).postings.filter((p) => p.sourceType === "depreciation").length).toBe(2);
  });

  test("折舊帳別跟著來源交易；財產交易借財產科目", () => {
    const i = inputs({
      transactions: [tx({ id: 1, type: "expense", book: "internal", amount: 36000, txnDate: "2026-01-15", fromAccountId: BANK.sinopac, categoryId: CAT.other })],
      fixedAssets: [asset({ id: 1, sourceTransactionId: 1 })],
    });
    expect(shape(find(i, "management", "transaction:1:management"))).toEqual({ "1681": 36000, "1113": -36000 });
    expect(build(i, "government").postings.some((p) => p.sourceType === "depreciation")).toBe(false);
    expect(build(i, "management").postings.some((p) => p.sourceType === "depreciation")).toBe(true);
  });

  test("已結帳月份讀快照，不再即時算", () => {
    const base = inputs({
      transactions: [tx({ id: 1, type: "expense", amount: 100, txnDate: "2026-01-10", fromAccountId: BANK.sinopac, categoryId: CAT.rent })],
    });
    const snap = computeSnapshot(base, "government", 2026, 1);
    expect(snap.map((p) => p.key)).toEqual(["transaction:1:government"]);
    // 結帳後原始交易被改了（理論上 trigger 會擋）：報表仍用快照
    const closed = inputs({
      transactions: [tx({ id: 1, type: "expense", amount: 999, txnDate: "2026-01-10", fromAccountId: BANK.sinopac, categoryId: CAT.rent })],
      closedPeriods: ["2026-01"],
      entries: snap.map((p, n) => snapshotEntry(500 + n, p, 2026, 1)),
    });
    const ps = build(closed, "government").postings.filter((p) => p.date.startsWith("2026-01"));
    expect(ps.length).toBe(1);
    expect(ps[0].fromSnapshot).toBe(true);
    expect(shape(ps[0])).toEqual({ "6112": 100, "1113": -100 });
    expect(ps[0].lines.find((l) => l.glAccountId === gl("1113"))!.bankAccountId).toBe(BANK.sinopac);
    // 重算快照忽略既有快照
    expect(shape(computeSnapshot(closed, "government", 2026, 1)[0])).toEqual({ "6112": 999, "1113": -999 });
  });

  test("手動分錄照 ledger 欄位進帳", () => {
    const i = inputs({
      entries: [
        {
          id: 1,
          ledger: "both",
          kind: "adjustment",
          entryDate: "2026-04-01",
          memo: "調整",
          snapshotYear: null,
          snapshotMonth: null,
          sourceType: null,
          sourceId: null,
          lines: [
            { glAccountId: gl("6188"), debit: 50, credit: 0, currency: null, fxAmount: null, partyId: null, employeeId: null, memo: null },
            { glAccountId: gl("2193"), debit: 0, credit: 50, currency: null, fxAmount: null, partyId: null, employeeId: null, memo: null },
          ],
        },
      ],
    });
    for (const l of ["government", "management"] as const) expect(shape(find(i, l, `manual:1:${l}`))).toEqual({ "6188": 50, "2193": -50 });
  });
});

import { describe, expect, test } from "bun:test";
import {
  addDays,
  findSubsets,
  inWindow,
  invoicesDueForCreation,
  type LedgerMode,
  ratioOk,
  reconcileInvoices,
  type MatchInvoice,
  type MatchTransaction,
} from "./match";

const AZURE = 10; // 帳本上的「Azure」
const MICROSOFT = 11; // 帳本上的「Microsoft」
const GOOGLE = 20;
const OTHER = 99;

let nextId = 1;
function inv(p: Partial<MatchInvoice> & { invoiceDate: string; amount: number }): MatchInvoice {
  return {
    id: nextId++,
    billingAccountId: 1,
    partyIds: [MICROSOFT, AZURE],
    currency: "TWD",
    matchStatus: "unmatched",
    matchedTransactionId: null,
    suggestedTransactionId: null,
    ...p,
  };
}
function txn(p: Partial<MatchTransaction> & { id: number; txnDate: string; amount: number }): MatchTransaction {
  return { partyId: MICROSOFT, currency: "TWD", ...p };
}
function byInvoice(updates: ReturnType<typeof reconcileInvoices>) {
  return new Map(updates.map((u) => [u.invoiceId, u]));
}

describe("helpers", () => {
  test("window is inclusive on both ends (day 0 and day 45)", () => {
    expect(inWindow("2026-04-09", "2026-04-09")).toBe(true);
    expect(inWindow("2026-04-09", addDays("2026-04-09", 45))).toBe(true);
    expect(inWindow("2026-04-09", addDays("2026-04-09", 46))).toBe(false);
    expect(inWindow("2026-04-09", "2026-04-08")).toBe(false);
  });

  test("ratio band 0.98..1.06 incl. edges", () => {
    expect(ratioOk(1000, 980)).toBe(true);
    expect(ratioOk(1000, 1060)).toBe(true);
    expect(ratioOk(1000, 979)).toBe(false);
    expect(ratioOk(1000, 1061)).toBe(false);
    expect(ratioOk(0, 0)).toBe(false);
  });

  test("findSubsets finds the merged pair and nothing smaller than 2", () => {
    const fits = findSubsets(
      [
        { id: 1, amount: 4626 },
        { id: 2, amount: 4338 },
        { id: 3, amount: 4303 },
      ],
      8964,
    );
    expect(fits.map((f) => f.ids.sort())).toContainEqual([1, 2]);
    expect(fits.every((f) => f.ids.length >= 2)).toBe(true);
  });
});

describe("real 東蜂 Azure history", () => {
  // 發票（台幣，金額跟帳本一模一樣，帳本晚 4～7 天）
  const mar = inv({ invoiceDate: "2026-03-09", amount: 4626 });
  const apr = inv({ invoiceDate: "2026-04-09", amount: 4338 });
  const may = inv({ invoiceDate: "2026-05-09", amount: 4303 });
  const jun = inv({ invoiceDate: "2026-06-09", amount: 4348 });
  const jul = inv({ invoiceDate: "2026-07-09", amount: 4217 });
  const aug = inv({ invoiceDate: "2026-08-09", amount: 4423 });
  const sep = inv({ invoiceDate: "2026-09-09", amount: 4280 });
  const oct = inv({ invoiceDate: "2026-10-09", amount: 3987 });
  const ledger: MatchTransaction[] = [
    txn({ id: 101, txnDate: "2026-04-13", amount: 8964, partyId: AZURE }), // 3 月 + 4 月合併
    txn({ id: 102, txnDate: "2026-05-15", amount: 4303, partyId: AZURE }),
    txn({ id: 103, txnDate: "2026-06-15", amount: 4348, partyId: MICROSOFT }),
    txn({ id: 104, txnDate: "2026-07-15", amount: 4217, partyId: MICROSOFT }),
    txn({ id: 105, txnDate: "2026-08-16", amount: 4423, partyId: MICROSOFT }),
  ];
  const updates = byInvoice(reconcileInvoices([mar, apr, may, jun, jul, aug, sep, oct], ledger));

  test("exact single matches across both parties (Azure / Microsoft)", () => {
    expect(updates.get(may.id)).toMatchObject({ matchStatus: "matched", matchedTransactionId: 102, reason: "single" });
    expect(updates.get(jun.id)).toMatchObject({ matchStatus: "matched", matchedTransactionId: 103 });
    expect(updates.get(jul.id)).toMatchObject({ matchStatus: "matched", matchedTransactionId: 104 });
    expect(updates.get(aug.id)).toMatchObject({ matchStatus: "matched", matchedTransactionId: 105 });
  });

  test("two months merged into one ledger row → both invoices link to it", () => {
    expect(updates.get(mar.id)).toMatchObject({ matchStatus: "matched", matchedTransactionId: 101, reason: "group" });
    expect(updates.get(apr.id)).toMatchObject({ matchStatus: "matched", matchedTransactionId: 101, reason: "group" });
  });

  test("invoices without a ledger row yet are not touched", () => {
    expect(updates.has(sep.id)).toBe(false);
    expect(updates.has(oct.id)).toBe(false);
  });

  test("only the configured match parties are candidates", () => {
    const solo = inv({ invoiceDate: "2026-05-09", amount: 4303, partyIds: [MICROSOFT] });
    const out = reconcileInvoices([solo], [txn({ id: 1, txnDate: "2026-05-15", amount: 4303, partyId: AZURE })]);
    expect(out).toEqual([]);
  });
});

describe("single match", () => {
  test("card foreign fee within band matches", () => {
    const i = inv({ invoiceDate: "2026-09-05", amount: 1000 });
    const u = reconcileInvoices([i], [txn({ id: 1, txnDate: "2026-09-12", amount: 1015 })]);
    expect(u).toEqual([
      { invoiceId: i.id, matchStatus: "matched", matchedTransactionId: 1, suggestedTransactionId: null, reason: "single" },
    ]);
  });

  test("window edges: day 45 matches, day 46 does not", () => {
    const a = inv({ invoiceDate: "2026-01-01", amount: 500 });
    expect(reconcileInvoices([a], [txn({ id: 1, txnDate: addDays("2026-01-01", 45), amount: 500 })])[0]).toMatchObject({
      matchStatus: "matched",
    });
    const b = inv({ invoiceDate: "2026-01-01", amount: 500 });
    expect(reconcileInvoices([b], [txn({ id: 1, txnDate: addDays("2026-01-01", 46), amount: 500 })])).toEqual([]);
    const c = inv({ invoiceDate: "2026-01-01", amount: 500 });
    expect(reconcileInvoices([c], [txn({ id: 1, txnDate: "2025-12-31", amount: 500 })])).toEqual([]);
  });

  test("two candidates in band, one exact → exact wins", () => {
    const i = inv({ invoiceDate: "2026-09-05", amount: 1000 });
    const u = reconcileInvoices(
      [i],
      [txn({ id: 1, txnDate: "2026-09-10", amount: 1020 }), txn({ id: 2, txnDate: "2026-09-11", amount: 1000 })],
    );
    expect(u[0]).toMatchObject({ matchStatus: "matched", matchedTransactionId: 2 });
  });

  test("two non-exact candidates → suggested with the closest", () => {
    const i = inv({ invoiceDate: "2026-09-05", amount: 1000 });
    const u = reconcileInvoices(
      [i],
      [txn({ id: 1, txnDate: "2026-09-10", amount: 1050 }), txn({ id: 2, txnDate: "2026-09-11", amount: 1012 })],
    );
    expect(u[0]).toMatchObject({ matchStatus: "suggested", matchedTransactionId: null, suggestedTransactionId: 2 });
  });

  test("a transaction already linked to another invoice set is not reused", () => {
    const done = inv({ invoiceDate: "2026-09-01", amount: 1000, matchStatus: "manual", matchedTransactionId: 1 });
    const i = inv({ invoiceDate: "2026-09-05", amount: 1000 });
    expect(reconcileInvoices([done, i], [txn({ id: 1, txnDate: "2026-09-10", amount: 1000 })])).toEqual([]);
  });

  test("final statuses are never changed; ignored stays ignored", () => {
    const ignored = inv({ invoiceDate: "2026-09-05", amount: 1000, matchStatus: "ignored" });
    expect(reconcileInvoices([ignored], [txn({ id: 1, txnDate: "2026-09-10", amount: 1000 })])).toEqual([]);
  });

  test("invoices of accounts without match parties are skipped", () => {
    const i = inv({ invoiceDate: "2026-09-05", amount: 1000, partyIds: [] });
    expect(reconcileInvoices([i], [txn({ id: 1, txnDate: "2026-09-10", amount: 1000 })])).toEqual([]);
  });

  test("a stale suggestion with nothing left reverts to unmatched", () => {
    const i = inv({ invoiceDate: "2026-09-05", amount: 1000, matchStatus: "suggested", suggestedTransactionId: 7 });
    expect(reconcileInvoices([i], [])).toEqual([
      { invoiceId: i.id, matchStatus: "unmatched", matchedTransactionId: null, suggestedTransactionId: null, reason: "none" },
    ]);
  });
});

describe("currency mismatch", () => {
  test("USD invoice vs single TWD row in window → suggested, never matched", () => {
    const i = inv({ invoiceDate: "2026-09-02", amount: 52.3, currency: "USD", partyIds: [GOOGLE] });
    const u = reconcileInvoices([i], [txn({ id: 9, txnDate: "2026-09-10", amount: 1722, partyId: GOOGLE })]);
    expect(u[0]).toMatchObject({ matchStatus: "suggested", suggestedTransactionId: 9, reason: "currency" });
  });

  test("two TWD rows in window → stays unmatched", () => {
    const i = inv({ invoiceDate: "2026-09-02", amount: 52.3, currency: "USD", partyIds: [GOOGLE] });
    const u = reconcileInvoices(
      [i],
      [
        txn({ id: 9, txnDate: "2026-09-10", amount: 1722, partyId: GOOGLE }),
        txn({ id: 10, txnDate: "2026-09-20", amount: 80, partyId: GOOGLE }),
      ],
    );
    expect(u).toEqual([]);
  });
});

describe("group match across billing accounts", () => {
  test("five GCP billing accounts merged into one statement row (incl. foreign fee)", () => {
    const amounts = [612, 455, 301, 210, 119]; // = 1697；帳本 1722 ≈ +1.5%
    const invs = amounts.map((amount, k) =>
      inv({ billingAccountId: 100 + k, invoiceDate: "2026-08-31", amount, partyIds: [GOOGLE] }),
    );
    const u = byInvoice(reconcileInvoices(invs, [txn({ id: 50, txnDate: "2026-09-15", amount: 1722, partyId: GOOGLE })]));
    for (const i of invs) {
      expect(u.get(i.id)).toMatchObject({ matchStatus: "matched", matchedTransactionId: 50, reason: "group" });
    }
  });

  test("subset must not include invoices dated after the transaction or > 75 days before", () => {
    const old = inv({ invoiceDate: "2026-05-01", amount: 500, partyIds: [GOOGLE] }); // 77 天前
    const a = inv({ invoiceDate: "2026-07-01", amount: 500, partyIds: [GOOGLE] });
    const later = inv({ invoiceDate: "2026-07-20", amount: 500, partyIds: [GOOGLE] }); // 交易之後
    const u = reconcileInvoices([old, a, later], [txn({ id: 1, txnDate: "2026-07-17", amount: 1000, partyId: GOOGLE })]);
    // 能湊的只有 old + a，但 old 超過 75 天 → 沒有合併配對
    expect(u.find((x) => x.matchStatus === "matched")).toBeUndefined();
  });

  test("more than one subset fits → suggested only", () => {
    const invs = [300, 300, 300].map((amount) => inv({ invoiceDate: "2026-08-01", amount, partyIds: [GOOGLE] }));
    const u = reconcileInvoices(invs, [txn({ id: 1, txnDate: "2026-08-10", amount: 600, partyId: GOOGLE })]);
    expect(u.every((x) => x.matchStatus === "suggested" && x.suggestedTransactionId === 1)).toBe(true);
    expect(u.length).toBeGreaterThanOrEqual(2);
  });

  test("group never mixes currencies", () => {
    const a = inv({ invoiceDate: "2026-08-01", amount: 500, partyIds: [GOOGLE] });
    const b = inv({ invoiceDate: "2026-08-01", amount: 500, currency: "USD", partyIds: [GOOGLE] });
    const u = reconcileInvoices([a, b], [txn({ id: 1, txnDate: "2026-08-10", amount: 1000, partyId: GOOGLE })]);
    expect(u.find((x) => x.matchStatus === "matched")).toBeUndefined();
  });

  test("transactions of unrelated parties are ignored", () => {
    const a = inv({ invoiceDate: "2026-08-01", amount: 500, partyIds: [GOOGLE] });
    const b = inv({ invoiceDate: "2026-08-02", amount: 500, partyIds: [GOOGLE] });
    expect(reconcileInvoices([a, b], [txn({ id: 1, txnDate: "2026-08-10", amount: 1000, partyId: OTHER })])).toEqual([]);
  });
});

describe("create_unmatched", () => {
  const today = "2026-10-12";
  const mode = (id: number): LedgerMode => (id === 1 ? "create_unmatched" : "match_only");

  test("only unmatched invoices older than 45 days on create_unmatched accounts", () => {
    const due = inv({ invoiceDate: addDays(today, -46), amount: 100 });
    const edge = inv({ invoiceDate: addDays(today, -45), amount: 100 }); // 視窗最後一天，還不建
    const suggested = inv({ invoiceDate: addDays(today, -60), amount: 100, matchStatus: "suggested" });
    const matchOnly = inv({ invoiceDate: addDays(today, -60), amount: 100, billingAccountId: 2 });
    const noParty = inv({ invoiceDate: addDays(today, -60), amount: 100, partyIds: [] });
    const zero = inv({ invoiceDate: addDays(today, -60), amount: 0 });
    const out = invoicesDueForCreation([due, edge, suggested, matchOnly, noParty, zero], mode, today);
    expect(out.map((i) => i.id)).toEqual([due.id]);
  });
});

describe("rejected transactions (unlink)", () => {
  test("a rejected exact match is skipped; another candidate can still match automatically", () => {
    const i = inv({ invoiceDate: "2026-09-05", amount: 1000, rejectedTransactionIds: [1] });
    const u = reconcileInvoices(
      [i],
      [txn({ id: 1, txnDate: "2026-09-10", amount: 1000 }), txn({ id: 2, txnDate: "2026-09-12", amount: 1015 })],
    );
    expect(u[0]).toMatchObject({ matchStatus: "matched", matchedTransactionId: 2 });
  });

  test("a rejected transaction is not even suggested (currency mismatch case)", () => {
    const i = inv({ invoiceDate: "2026-09-02", amount: 52.3, currency: "USD", partyIds: [GOOGLE], rejectedTransactionIds: [9] });
    expect(reconcileInvoices([i], [txn({ id: 9, txnDate: "2026-09-10", amount: 1722, partyId: GOOGLE })])).toEqual([]);
  });

  test("group: if any invoice of the would-be group rejected the transaction, that group is not formed", () => {
    const a = inv({ invoiceDate: "2026-03-09", amount: 4626, partyIds: [AZURE] });
    const b = inv({ invoiceDate: "2026-04-09", amount: 4338, partyIds: [AZURE], rejectedTransactionIds: [101] });
    const u = reconcileInvoices([a, b], [txn({ id: 101, txnDate: "2026-04-13", amount: 8964, partyId: AZURE })]);
    expect(u.find((x) => x.matchStatus === "matched")).toBeUndefined();
  });

  test("other invoices are unaffected by someone else's rejection", () => {
    const rejecter = inv({ invoiceDate: "2026-09-01", amount: 500, rejectedTransactionIds: [1] });
    const other = inv({ invoiceDate: "2026-09-05", amount: 1000 });
    const u = byInvoice(reconcileInvoices([rejecter, other], [txn({ id: 1, txnDate: "2026-09-10", amount: 1000 })]));
    expect(u.get(other.id)).toMatchObject({ matchStatus: "matched", matchedTransactionId: 1 });
    expect(u.has(rejecter.id)).toBe(false);
  });
});

import { describe, expect, test } from "bun:test";
import {
  advancePayeeKind,
  pickAdvancePayee,
  settleKindOf,
  summarizeOutstandingByPayee,
  type OutstandingAdvanceLike,
} from "./advance-payee";

describe("pickAdvancePayee", () => {
  test("employee by name", () => {
    expect(pickAdvancePayee({ employeeName: " 王小明 " })).toEqual({ kind: "employee", name: "王小明" });
  });

  test("company by id wins over name", () => {
    expect(pickAdvancePayee({ partyId: 176, partyName: "Cerana Technology" })).toEqual({
      kind: "party",
      id: 176,
      name: "Cerana Technology",
    });
  });

  test("company by name only", () => {
    expect(pickAdvancePayee({ partyName: "Cerana Technology" })).toEqual({
      kind: "party",
      id: null,
      name: "Cerana Technology",
    });
  });

  test("employee and company together is rejected", () => {
    expect(pickAdvancePayee({ employeeName: "王小明", partyId: 176 })).toEqual({ error: "both" });
    expect(pickAdvancePayee({ employeeName: "王小明", partyName: "東蜂" })).toEqual({ error: "both" });
  });

  test("nothing (or blanks / 0 id) is missing", () => {
    expect(pickAdvancePayee({})).toEqual({ error: "missing" });
    expect(pickAdvancePayee({ employeeName: "  ", partyName: "", partyId: 0 })).toEqual({ error: "missing" });
  });
});

describe("advancePayeeKind / settleKindOf", () => {
  test("form toggle defaults to employee", () => {
    expect(advancePayeeKind("party")).toBe("party");
    expect(advancePayeeKind("employee")).toBe("employee");
    expect(advancePayeeKind(null)).toBe("employee");
    expect(advancePayeeKind("whatever")).toBe("employee");
  });

  test("row kind follows whichever column is set", () => {
    expect(settleKindOf({ settleEmployeeId: 3, settlePartyId: null })).toBe("employee");
    expect(settleKindOf({ settleEmployeeId: null, settlePartyId: 176 })).toBe("party");
    expect(settleKindOf({ settleEmployeeId: null, settlePartyId: null })).toBeNull();
  });
});

function row(p: Partial<OutstandingAdvanceLike>): OutstandingAdvanceLike {
  return {
    settleKind: "employee",
    settleEmployeeId: null,
    settlePartyId: null,
    settleName: null,
    amount: "0",
    amountTwd: null,
    currency: "TWD",
    ...p,
  };
}

describe("summarizeOutstandingByPayee", () => {
  test("groups employees and companies separately, biggest first", () => {
    const out = summarizeOutstandingByPayee([
      row({ settleKind: "party", settlePartyId: 176, settleName: "Cerana Technology", amount: "2000.00", amountTwd: "2000.00" }),
      row({ settleKind: "employee", settleEmployeeId: 3, settleName: "王小明", amount: "500", amountTwd: "500" }),
      row({ settleKind: "party", settlePartyId: 176, settleName: "Cerana Technology", amount: "1500.50", amountTwd: "1500.50" }),
      // 員工剛好跟公司同 id，不能被併進公司那組
      row({ settleKind: "employee", settleEmployeeId: 176, settleName: "Cerana Technology", amount: "1", amountTwd: "1" }),
    ]);
    expect(out.map((g) => [g.key, g.count, g.totalTwd])).toEqual([
      ["party:176", 2, 3500.5],
      ["employee:3", 1, 500],
      ["employee:176", 1, 1],
    ]);
    expect(out[0]).toMatchObject({ kind: "party", id: 176, name: "Cerana Technology" });
    expect(out[0].totals).toEqual([{ currency: "TWD", amount: 3500.5 }]);
  });

  test("keeps currencies apart and only counts booked TWD for foreign rows", () => {
    const [g] = summarizeOutstandingByPayee([
      row({ settleKind: "party", settlePartyId: 9, settleName: "X", amount: "10", currency: "USD", amountTwd: "320" }),
      row({ settleKind: "party", settlePartyId: 9, settleName: "X", amount: "5", currency: "USD", amountTwd: null }),
      row({ settleKind: "party", settlePartyId: 9, settleName: "X", amount: "100", currency: "TWD", amountTwd: null }),
    ]);
    expect(g.totals).toEqual([
      { currency: "TWD", amount: 100 },
      { currency: "USD", amount: 15 },
    ]);
    expect(g.totalTwd).toBe(420);
  });

  test("rows with no payer collect under none", () => {
    const out = summarizeOutstandingByPayee([row({ settleKind: null, amount: "50", amountTwd: "50" })]);
    expect(out).toEqual([
      { key: "none", kind: null, id: null, name: null, count: 1, totals: [{ currency: "TWD", amount: 50 }], totalTwd: 50 },
    ]);
  });
});

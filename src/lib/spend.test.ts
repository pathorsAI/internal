import { describe, expect, test } from "bun:test";
import { monthsInRange, summarizeSpend, type SpendInputRow } from "./spend";

const MONTHS = [
  "2025-11", "2025-12", "2026-01", "2026-02", "2026-03", "2026-04",
  "2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10",
];

function row(partial: Partial<SpendInputRow> & { totalTwd: number }): SpendInputRow {
  return {
    month: "2026-10",
    partyId: null,
    partyName: null,
    partyAvatarVersion: null,
    categoryId: null,
    categoryName: null,
    count: 1,
    unconverted: 0,
    ...partial,
  };
}

const vendor = (id: number, totalTwd: number, extra: Partial<SpendInputRow> = {}) =>
  row({ partyId: id, partyName: `V${id}`, totalTwd, ...extra });

describe("monthsInRange", () => {
  test("takes the last 1 / 3 / 12 months of the window", () => {
    expect([...monthsInRange(MONTHS, "month")]).toEqual(["2026-10"]);
    expect([...monthsInRange(MONTHS, "3m")]).toEqual(["2026-08", "2026-09", "2026-10"]);
    expect(monthsInRange(MONTHS, "12m").size).toBe(12);
  });
});

describe("summarizeSpend", () => {
  test("keeps the top 8 vendors and groups the rest into 其他", () => {
    const rows = Array.from({ length: 11 }, (_, i) => vendor(i + 1, (i + 1) * 100));
    const s = summarizeSpend(rows, MONTHS, "3m", "party");

    expect(s.items).toHaveLength(9);
    expect(s.items.slice(0, 8).map((i) => i.id)).toEqual([11, 10, 9, 8, 7, 6, 5, 4]);
    const other = s.items[8];
    expect(other.kind).toBe("other");
    expect(other.total).toBe(100 + 200 + 300);
    expect(other.members).toBe(3);
    expect(other.count).toBe(3);
    expect(s.total).toBe(6600);
    expect(s.items.reduce((sum, i) => sum + i.share, 0)).toBeCloseTo(1, 10);
  });

  test("no 其他 row when there are 8 or fewer groups", () => {
    const s = summarizeSpend([vendor(1, 10), vendor(2, 20)], MONTHS, "3m", "party");
    expect(s.items.map((i) => i.kind)).toEqual(["party", "party"]);
    expect(s.items[0].share).toBeCloseTo(2 / 3);
  });

  test("sums the same vendor across months and categories", () => {
    const rows = [
      vendor(1, 100, { month: "2026-08", categoryId: 1 }),
      vendor(1, 50, { month: "2026-10", categoryId: 2, partyAvatarVersion: "123" }),
      vendor(2, 120),
    ];
    const s = summarizeSpend(rows, MONTHS, "3m", "party");
    expect(s.items[0]).toMatchObject({ key: "party:1", total: 150, count: 2, avatarVersion: null });
    expect(s.items[1]).toMatchObject({ key: "party:2", total: 120 });
  });

  test("only counts months inside the selected range", () => {
    const rows = [vendor(1, 100, { month: "2026-10" }), vendor(1, 900, { month: "2026-01" }), vendor(2, 50, { month: "2025-11" })];
    expect(summarizeSpend(rows, MONTHS, "month", "party").total).toBe(100);
    expect(summarizeSpend(rows, MONTHS, "3m", "party").total).toBe(100);
    expect(summarizeSpend(rows, MONTHS, "12m", "party").total).toBe(1050);
  });

  test("groups by category when asked, with uncategorized as its own bucket", () => {
    const rows = [
      vendor(1, 100, { categoryId: 7, categoryName: "雲端" }),
      vendor(2, 50, { categoryId: 7, categoryName: "雲端" }),
      vendor(3, 30),
    ];
    const s = summarizeSpend(rows, MONTHS, "3m", "category");
    expect(s.items.map((i) => [i.key, i.total])).toEqual([
      ["category:7", 150],
      ["category:none", 30],
    ]);
    expect(s.items[0].avatarVersion).toBeNull();
    expect(s.items[1].kind).toBe("none");
  });

  test("expenses without a counterparty form an unassigned bucket", () => {
    const s = summarizeSpend([row({ totalTwd: 80 }), vendor(1, 20)], MONTHS, "3m", "party");
    expect(s.items[0]).toMatchObject({ key: "party:none", kind: "none", id: null, total: 80 });
  });

  test("drops groups whose net total is zero or negative (refunds) from items and the total", () => {
    const s = summarizeSpend([vendor(1, 100), vendor(2, -40), vendor(3, 0)], MONTHS, "3m", "party");
    expect(s.items.map((i) => i.id)).toEqual([1]);
    expect(s.total).toBe(100);
    expect(s.items[0].share).toBe(1);
  });

  test("reports unconverted foreign-currency rows in range", () => {
    const rows = [vendor(1, 100, { unconverted: 2 }), vendor(1, 0, { month: "2026-01", unconverted: 5 })];
    expect(summarizeSpend(rows, MONTHS, "3m", "party").unconverted).toBe(2);
    expect(summarizeSpend(rows, MONTHS, "12m", "party").unconverted).toBe(7);
  });

  test("ties are ordered by name so the chart is stable", () => {
    const s = summarizeSpend(
      [row({ partyId: 2, partyName: "Beta", totalTwd: 10 }), row({ partyId: 1, partyName: "Alpha", totalTwd: 10 })],
      MONTHS,
      "3m",
      "party",
    );
    expect(s.items.map((i) => i.name)).toEqual(["Alpha", "Beta"]);
  });

  test("empty input gives an empty summary", () => {
    expect(summarizeSpend([], MONTHS, "3m", "party")).toEqual({ items: [], total: 0, unconverted: 0 });
  });
});

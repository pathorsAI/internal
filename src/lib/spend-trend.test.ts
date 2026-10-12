import { describe, expect, test } from "bun:test";
import {
  changeRatio,
  compositionOf,
  monthWindow,
  shiftMonth,
  sortTrendItems,
  summarizeSpendTrend,
  transactionsHref,
  yearMonthIn,
  type TrendInputRow,
} from "./spend-trend";
import { summarizeSpend } from "./spend";

const MONTHS = monthWindow("2026-10", 12);

function row(partial: Partial<TrendInputRow> & { totalTwd: number }): TrendInputRow {
  return {
    month: "2026-10",
    partyId: null,
    partyName: null,
    partyAvatarVersion: null,
    categoryId: null,
    categoryName: null,
    count: 1,
    unconverted: 0,
    partyFirstMonth: null,
    categoryFirstMonth: null,
    ...partial,
  };
}

const vendor = (id: number, month: string, totalTwd: number, extra: Partial<TrendInputRow> = {}) =>
  row({ partyId: id, partyName: `V${id}`, partyFirstMonth: "2020-01", month, totalTwd, ...extra });
const category = (id: number, month: string, totalTwd: number, extra: Partial<TrendInputRow> = {}) =>
  row({ categoryId: id, categoryName: `C${id}`, categoryFirstMonth: "2020-01", month, totalTwd, ...extra });

describe("month helpers", () => {
  test("shiftMonth crosses year boundaries both ways", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2025-12", 1)).toBe("2026-01");
    expect(shiftMonth("2026-10", -12)).toBe("2025-10");
  });

  test("monthWindow ends on the given month, oldest first", () => {
    expect(MONTHS).toHaveLength(12);
    expect(MONTHS[0]).toBe("2025-11");
    expect(MONTHS.at(-1)).toBe("2026-10");
    expect(monthWindow("2026-02", 3)).toEqual(["2025-12", "2026-01", "2026-02"]);
  });

  test("yearMonthIn buckets by Asia/Taipei, not UTC", () => {
    // 2026-09-30 20:00 UTC = 2026-10-01 04:00 in Taipei
    const d = new Date("2026-09-30T20:00:00Z");
    expect(yearMonthIn(d)).toBe("2026-10");
    expect(yearMonthIn(d, "UTC")).toBe("2026-09");
  });

  test("changeRatio is null without a positive base", () => {
    expect(changeRatio(150, 100)).toBe(0.5);
    expect(changeRatio(50, 0)).toBeNull();
    expect(changeRatio(50, -10)).toBeNull();
  });
});

describe("summarizeSpendTrend", () => {
  test("fills missing months with zero and keeps months aligned", () => {
    const t = summarizeSpendTrend([vendor(1, "2026-08", 300), vendor(1, "2026-10", 100)], MONTHS, 6, "party");
    expect(t.months).toEqual(["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"]);
    expect(t.items[0].monthly).toEqual([0, 0, 0, 300, 0, 100]);
    expect(t.items[0].total).toBe(400);
    expect(t.items[0].average).toBeCloseTo(400 / 6);
    expect(t.stack.map((d) => d.s0)).toEqual([0, 0, 0, 300, 0, 100]);
  });

  test("drops rows outside the selected period", () => {
    const rows = [vendor(1, "2025-12", 999), vendor(1, "2026-10", 1)];
    expect(summarizeSpendTrend(rows, MONTHS, 6, "party").items[0].total).toBe(1);
    expect(summarizeSpendTrend(rows, MONTHS, 12, "party").items[0].total).toBe(1000);
  });

  test("the same rows group by category or by party", () => {
    const rows = [
      row({ partyId: 1, partyName: "AWS", categoryId: 7, categoryName: "技術服務成本", totalTwd: 100 }),
      row({ partyId: 2, partyName: "GCP", categoryId: 7, categoryName: "技術服務成本", totalTwd: 50 }),
      row({ partyId: 2, partyName: "GCP", categoryId: null, totalTwd: 20 }),
    ];
    const byCat = summarizeSpendTrend(rows, MONTHS, 12, "category");
    expect(byCat.items.map((i) => [i.key, i.total])).toEqual([["category:7", 150], ["category:none", 20]]);
    expect(byCat.items[1]).toMatchObject({ kind: "none", id: null, name: null });
    const byParty = summarizeSpendTrend(rows, MONTHS, 12, "party");
    expect(byParty.items.map((i) => [i.key, i.total])).toEqual([["party:1", 100], ["party:2", 70]]);
  });

  test("keeps the top 8 as series and folds the rest into 其他", () => {
    const rows = Array.from({ length: 11 }, (_, i) => category(i + 1, "2026-10", (i + 1) * 100));
    const t = summarizeSpendTrend(rows, MONTHS, 12, "category");

    expect(t.items).toHaveLength(11);
    expect(t.series).toHaveLength(9);
    expect(t.series.slice(0, 8).map((s) => s.itemKey)).toEqual(
      [11, 10, 9, 8, 7, 6, 5, 4].map((id) => `category:${id}`),
    );
    expect(t.series[8]).toMatchObject({ key: "other", kind: "other", itemKey: null, members: 3, total: 600 });
    const oct = t.stack.at(-1)!;
    expect(oct.other).toBe(600);
    expect(oct.s0).toBe(1100);
    expect(t.monthTotals.at(-1)).toBe(6600);
  });

  test("no 其他 series with 8 items or fewer", () => {
    const rows = Array.from({ length: 8 }, (_, i) => vendor(i + 1, "2026-10", 100));
    const t = summarizeSpendTrend(rows, MONTHS, 12, "party");
    expect(t.series.every((s) => s.kind !== "other")).toBe(true);
    expect(t.stack[0]).not.toHaveProperty("other");
  });

  test("month-over-month change per item and for the total", () => {
    const t = summarizeSpendTrend(
      [vendor(1, "2026-09", 200), vendor(1, "2026-10", 300), vendor(2, "2026-10", 100)],
      MONTHS,
      12,
      "party",
    );
    expect(t.items.find((v) => v.id === 1)).toMatchObject({ last: 300, prev: 200, change: 100, changePct: 0.5 });
    expect(t.items.find((v) => v.id === 2)?.changePct).toBeNull();
    expect(t.summary).toMatchObject({ thisMonth: 400, prevMonth: 200, change: 200, changePct: 1, periodTotal: 600 });
    expect(t.summary.top?.id).toBe(1);
  });

  test("new items are those whose first spend falls inside the period; 未分類 never counts", () => {
    const rows = [
      vendor(1, "2026-10", 100, { partyFirstMonth: "2024-03" }),
      vendor(2, "2026-10", 100, { partyFirstMonth: "2026-07" }),
      vendor(3, "2026-10", 100, { partyFirstMonth: "2026-03" }),
      row({ totalTwd: 50 }),
    ];
    expect(summarizeSpendTrend(rows, MONTHS, 6, "party").summary.newItems).toBe(1); // 期間 2026-05 起
    expect(summarizeSpendTrend(rows, MONTHS, 12, "party").summary.newItems).toBe(2); // 期間 2025-11 起
    expect(summarizeSpendTrend(rows, MONTHS, 12, "category").summary.newItems).toBe(0);
  });

  test("items netting to ≤ 0 (refund only) are dropped", () => {
    const t = summarizeSpendTrend([vendor(1, "2026-10", -50), vendor(2, "2026-10", 10)], MONTHS, 12, "party");
    expect(t.items.map((v) => v.id)).toEqual([2]);
  });

  test("counts unconverted foreign-currency rows within the period only", () => {
    const t = summarizeSpendTrend(
      [vendor(1, "2026-10", 0, { unconverted: 2, count: 0 }), vendor(1, "2026-09", 10), vendor(1, "2025-01", 0, { unconverted: 5 })],
      MONTHS,
      12,
      "party",
    );
    expect(t.unconverted).toBe(2);
  });

  test("empty input gives an empty, zeroed trend", () => {
    const t = summarizeSpendTrend([], MONTHS, 12, "category");
    expect(t.items).toEqual([]);
    expect(t.series).toEqual([]);
    expect(t.stack).toHaveLength(12);
    expect(t.summary).toMatchObject({ thisMonth: 0, prevMonth: 0, changePct: null, top: null, newItems: 0 });
  });

  test("reconciles with the overview's 支出去向 totals for the same window", () => {
    const rows = [
      row({ partyId: 1, partyName: "A", categoryId: 1, categoryName: "X", totalTwd: 120, month: "2026-08" }),
      row({ partyId: 2, partyName: "B", categoryId: null, totalTwd: 30, month: "2026-09" }),
      row({ partyId: null, categoryId: 2, categoryName: "Y", totalTwd: 75, month: "2026-10" }),
    ];
    for (const dim of ["party", "category"] as const) {
      const overview = summarizeSpend(rows, MONTHS, "3m", dim);
      const trend = summarizeSpendTrend(rows, MONTHS, 3, dim);
      expect(trend.summary.periodTotal).toBe(overview.total);
      expect(trend.items.map((i) => [i.key, i.total])).toEqual(overview.items.map((i) => [i.key, i.total]));
    }
  });
});

describe("compositionOf", () => {
  test("a category's vendors: top 5 + 其他, with shares", () => {
    const rows = Array.from({ length: 7 }, (_, i) =>
      row({ partyId: i + 1, partyName: `V${i + 1}`, categoryId: 9, categoryName: "勞務成本", totalTwd: (i + 1) * 10 }),
    );
    rows.push(row({ partyId: 99, partyName: "Elsewhere", categoryId: 3, totalTwd: 1000 }));
    const c = compositionOf(rows, MONTHS, 12, "category", "category:9");
    expect(c.map((x) => x.key)).toEqual(["party:7", "party:6", "party:5", "party:4", "party:3", "other"]);
    expect(c.at(-1)).toMatchObject({ total: 30, members: 2 });
    expect(c.reduce((s, x) => s + x.share, 0)).toBeCloseTo(1);
  });

  test("a vendor's categories, keeping 未分類 as its own slice", () => {
    const rows = [
      row({ partyId: 1, partyName: "A", categoryId: 2, categoryName: "差旅費用", totalTwd: 60 }),
      row({ partyId: 1, partyName: "A", categoryId: null, totalTwd: 40 }),
    ];
    const c = compositionOf(rows, MONTHS, 12, "party", "party:1");
    expect(c.map((x) => [x.key, x.share])).toEqual([["category:2", 0.6], ["category:none", 0.4]]);
  });

  test("未分類 itself can be decomposed by vendor", () => {
    const rows = [row({ partyId: 1, partyName: "A", totalTwd: 5 }), row({ partyId: 2, partyName: "B", categoryId: 1, totalTwd: 9 })];
    expect(compositionOf(rows, MONTHS, 12, "category", "category:none").map((x) => x.key)).toEqual(["party:1"]);
  });
});

describe("sortTrendItems", () => {
  const t = summarizeSpendTrend(
    [vendor(1, "2026-09", 500), vendor(1, "2026-10", 100), vendor(2, "2026-10", 300), vendor(3, "2026-09", 10), vendor(3, "2026-10", 210)],
    MONTHS,
    12,
    "party",
  );

  test("by total, descending by default", () => {
    expect(sortTrendItems(t.items, "total").map((v) => v.id)).toEqual([1, 2, 3]);
    expect(sortTrendItems(t.items, "total", "asc").map((v) => v.id)).toEqual([3, 2, 1]);
  });

  test("by month-over-month change", () => {
    // 1: -400, 2: +300, 3: +200
    expect(sortTrendItems(t.items, "change").map((v) => v.id)).toEqual([2, 3, 1]);
  });
});

describe("transactionsHref", () => {
  test("links categories, parties and the unassigned buckets", () => {
    expect(transactionsHref({ key: "category:3", id: 3 })).toBe("/dashboard/transactions?category=3");
    expect(transactionsHref({ key: "category:none", id: null })).toBe("/dashboard/transactions?category=none");
    expect(transactionsHref({ key: "party:none", id: null })).toBe("/dashboard/transactions?party=none");
  });
});

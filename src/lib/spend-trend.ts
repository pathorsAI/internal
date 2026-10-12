/**
 * 報表「支出分析」的彙總：把 getMonthlySpendBreakdown 的 (月 × 交易對象 × 分類) 列，
 * 依選定的維度（類別 / 廠商）整理成摘要卡、堆疊月柱（前 8 名 + 其他）、單一項目的月柱、
 * 該項目的組成（類別 × 廠商）與明細表要用的形狀。
 *
 * 純函式（不碰 DB、不碰 React）：client 端切維度與 6 / 12 個月時直接重算，MCP 工具也共用。
 * 支出口徑與總覽「支出去向」相同（src/db/queries.ts 的 spendConditions），分組規則也同
 * （src/lib/spend.ts：未指定對象 / 未分類是獨立一組、合計 ≤ 0 的不列），所以兩邊數字對得起來。
 * 金額一律是台幣（amount_twd；台幣交易用 amount），沒換算的外幣只計筆數。
 */

export const TREND_TOP_N = 8;
export const COMPOSITION_TOP_N = 5;
export const TREND_PERIODS = [6, 12] as const;
export type TrendPeriod = (typeof TREND_PERIODS)[number];
export type TrendDimension = "category" | "party";

/** 「本月」以台北時間判斷（txn_date 本身是日期，沒有時區）。 */
export const REPORT_TIME_ZONE = "Asia/Taipei";

/** 與 MonthlySpendRow（src/db/queries.ts）同形；這裡只描述需要的欄位，避免 client 引到 DB 模組。 */
export type TrendInputRow = {
  month: string;
  partyId: number | null;
  partyName: string | null;
  partyAvatarVersion: string | null;
  categoryId: number | null;
  categoryName: string | null;
  totalTwd: number;
  count: number;
  unconverted: number;
  /** 這個交易對象 / 分類有史以來第一筆支出的月份（YYYY-MM）；未指定的為 null */
  partyFirstMonth: string | null;
  categoryFirstMonth: string | null;
};

export type TrendItemKind = "party" | "category" | "none";

export type TrendItem = {
  /** 穩定的 key：category:3、party:12、category:none、party:none */
  key: string;
  kind: TrendItemKind;
  /** 分類 / 交易對象 id；未分類、未指定對象為 null */
  id: number | null;
  /** 顯示名稱；未分類 / 未指定為 null（由畫面套翻譯） */
  name: string | null;
  avatarVersion: string | null;
  /** 與 months 對齊的每月金額（沒有支出的月份補 0） */
  monthly: number[];
  total: number;
  average: number;
  count: number;
  /** 期間最後一個月（本月）與前一個月 */
  last: number;
  prev: number;
  change: number;
  /** 前一個月 ≤ 0 時無法算比例 → null */
  changePct: number | null;
  firstMonth: string | null;
  /** 第一筆支出落在這段期間內（未分類 / 未指定永遠是 false） */
  isNew: boolean;
};

export type TrendSeries = {
  /** recharts dataKey：s0…s7 或 other */
  key: string;
  /** 對應的項目 key；「其他」為 null */
  itemKey: string | null;
  kind: TrendItemKind | "other";
  total: number;
  /** 「其他」併了幾項 */
  members: number;
};

export type TrendStackDatum = { month: string } & Record<string, number | string>;

export type SpendTrend = {
  dimension: TrendDimension;
  months: string[];
  items: TrendItem[];
  series: TrendSeries[];
  stack: TrendStackDatum[];
  monthTotals: number[];
  summary: {
    thisMonth: number;
    prevMonth: number;
    change: number;
    changePct: number | null;
    periodTotal: number;
    top: TrendItem | null;
    newItems: number;
  };
  /** 期間內沒換算台幣、所以沒計入的外幣筆數 */
  unconverted: number;
};

// ---- 月份工具 ----

/** 某個時間點在台北是哪個月（YYYY-MM）。Workers 跑在 UTC，月初 00:00–08:00 會差一個月。 */
export function yearMonthIn(date: Date, timeZone = REPORT_TIME_ZONE): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit" }).formatToParts(date);
  const y = parts.find((p) => p.type === "year")?.value ?? "1970";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  return `${y}-${m}`;
}

/** "2026-10" 往前 / 往後 n 個月。 */
export function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split("-").map(Number);
  const idx = y * 12 + (m - 1) + delta;
  const ny = Math.floor(idx / 12);
  const nm = idx - ny * 12 + 1;
  return `${String(ny).padStart(4, "0")}-${String(nm).padStart(2, "0")}`;
}

/** 以 endMonth 結尾、共 n 個月的視窗（由舊到新、含 endMonth）。 */
export function monthWindow(endMonth: string, n: number): string[] {
  return Array.from({ length: n }, (_, i) => shiftMonth(endMonth, i - (n - 1)));
}

/** 變化比例；基期 ≤ 0 時沒有意義 → null。 */
export function changeRatio(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return (current - previous) / previous;
}

// ---- 分組 ----

type Identity = Pick<TrendItem, "key" | "kind" | "id" | "name" | "avatarVersion" | "firstMonth">;

/** 一列屬於哪一組。與 src/lib/spend.ts 的 bucketOf 同一個規則。 */
export function identityOf(row: TrendInputRow, dimension: TrendDimension): Identity {
  if (dimension === "party") {
    if (row.partyId == null) {
      return { key: "party:none", kind: "none", id: null, name: null, avatarVersion: null, firstMonth: null };
    }
    return {
      key: `party:${row.partyId}`,
      kind: "party",
      id: row.partyId,
      name: row.partyName,
      avatarVersion: row.partyAvatarVersion,
      firstMonth: row.partyFirstMonth,
    };
  }
  if (row.categoryId == null) {
    return { key: "category:none", kind: "none", id: null, name: null, avatarVersion: null, firstMonth: null };
  }
  return {
    key: `category:${row.categoryId}`,
    kind: "category",
    id: row.categoryId,
    name: row.categoryName,
    avatarVersion: null,
    firstMonth: row.categoryFirstMonth,
  };
}

const byTotalThenName = (a: TrendItem, b: TrendItem) =>
  b.total - a.total || (a.name ?? "").localeCompare(b.name ?? "") || a.key.localeCompare(b.key);

/** 依維度把期間內的列加總成項目（每月補 0），合計 ≤ 0 的不列，依金額大到小。 */
function collectItems(
  rows: readonly TrendInputRow[],
  window: readonly string[],
  dimension: TrendDimension,
): { items: TrendItem[]; unconverted: number } {
  const index = new Map(window.map((m, i) => [m, i]));
  const periodStart = window[0] ?? "";
  type Acc = Identity & { monthly: number[]; count: number };
  const acc = new Map<string, Acc>();
  let unconverted = 0;

  for (const row of rows) {
    const i = index.get(row.month);
    if (i === undefined) continue;
    unconverted += row.unconverted;
    const id = identityOf(row, dimension);
    let a = acc.get(id.key);
    if (!a) {
      a = { ...id, monthly: window.map(() => 0), count: 0 };
      acc.set(id.key, a);
    }
    a.monthly[i] += row.totalTwd;
    a.count += row.count;
    if (id.firstMonth && (!a.firstMonth || id.firstMonth < a.firstMonth)) a.firstMonth = id.firstMonth;
  }

  const n = window.length;
  const items = [...acc.values()]
    .map((a): TrendItem => {
      const total = a.monthly.reduce((s, v) => s + v, 0);
      const last = n > 0 ? a.monthly[n - 1] : 0;
      const prev = n > 1 ? a.monthly[n - 2] : 0;
      return {
        ...a,
        total,
        average: n > 0 ? total / n : 0,
        last,
        prev,
        change: last - prev,
        changePct: changeRatio(last, prev),
        isNew: a.kind !== "none" && a.firstMonth != null && a.firstMonth >= periodStart,
      };
    })
    .filter((it) => it.total > 0)
    .sort(byTotalThenName);
  return { items, unconverted };
}

/**
 * months：server 抓的完整視窗（由舊到新）；period：要看最後幾個月。
 * 前 topN 名各自一條堆疊序列，其餘併成「其他」。
 */
export function summarizeSpendTrend(
  rows: readonly TrendInputRow[],
  months: readonly string[],
  period: number,
  dimension: TrendDimension,
  topN = TREND_TOP_N,
): SpendTrend {
  const window = months.slice(-period);
  const { items, unconverted } = collectItems(rows, window, dimension);

  const top = items.slice(0, topN);
  const rest = items.slice(topN);
  const series: TrendSeries[] = top.map((it, i) => ({
    key: `s${i}`,
    itemKey: it.key,
    kind: it.kind,
    total: it.total,
    members: 1,
  }));
  if (rest.length > 0) {
    series.push({
      key: "other",
      itemKey: null,
      kind: "other",
      total: rest.reduce((s, it) => s + it.total, 0),
      members: rest.length,
    });
  }

  const monthTotals = window.map((_, i) => items.reduce((s, it) => s + it.monthly[i], 0));
  const stack: TrendStackDatum[] = window.map((month, i) => {
    const datum: TrendStackDatum = { month };
    top.forEach((it, j) => {
      datum[`s${j}`] = it.monthly[i];
    });
    if (rest.length > 0) datum.other = rest.reduce((s, it) => s + it.monthly[i], 0);
    return datum;
  });

  const n = window.length;
  const thisMonth = n > 0 ? monthTotals[n - 1] : 0;
  const prevMonth = n > 1 ? monthTotals[n - 2] : 0;

  return {
    dimension,
    months: window,
    items,
    series,
    stack,
    monthTotals,
    summary: {
      thisMonth,
      prevMonth,
      change: thisMonth - prevMonth,
      changePct: changeRatio(thisMonth, prevMonth),
      periodTotal: monthTotals.reduce((s, v) => s + v, 0),
      top: items[0] ?? null,
      newItems: items.filter((it) => it.isNew).length,
    },
    unconverted,
  };
}

export type CompositionItem = {
  key: string;
  kind: TrendItemKind | "other";
  id: number | null;
  name: string | null;
  avatarVersion: string | null;
  total: number;
  /** 占所選項目期間合計的比例（0–1） */
  share: number;
  /** 「其他」併了幾項 */
  members: number;
};

/**
 * 所選項目在期間內由什麼組成：選了分類 → 看是哪些廠商；選了廠商 → 看落在哪些分類。
 * 前 topN 名 + 其他（未指定 / 未分類也是一項，跟主圖一致）。
 */
export function compositionOf(
  rows: readonly TrendInputRow[],
  months: readonly string[],
  period: number,
  dimension: TrendDimension,
  itemKey: string,
  topN = COMPOSITION_TOP_N,
): CompositionItem[] {
  const window = months.slice(-period);
  const other: TrendDimension = dimension === "category" ? "party" : "category";
  const inside = rows.filter((r) => identityOf(r, dimension).key === itemKey);
  const { items } = collectItems(inside, window, other);
  const total = items.reduce((s, it) => s + it.total, 0);
  const share = (v: number) => (total > 0 ? v / total : 0);
  const out: CompositionItem[] = items.slice(0, topN).map((it) => ({
    key: it.key,
    kind: it.kind,
    id: it.id,
    name: it.name,
    avatarVersion: it.avatarVersion,
    total: it.total,
    share: share(it.total),
    members: 1,
  }));
  const rest = items.slice(topN);
  if (rest.length > 0) {
    const restTotal = rest.reduce((s, it) => s + it.total, 0);
    out.push({
      key: "other",
      kind: "other",
      id: null,
      name: null,
      avatarVersion: null,
      total: restTotal,
      share: share(restTotal),
      members: rest.length,
    });
  }
  return out;
}

export type TrendSort = "total" | "change";

/** 明細表排序：依期間合計或本月變化（金額），方向可切；同值依名稱。 */
export function sortTrendItems(
  items: readonly TrendItem[],
  by: TrendSort,
  dir: "asc" | "desc" = "desc",
): TrendItem[] {
  const sign = dir === "desc" ? -1 : 1;
  const value = (it: TrendItem) => (by === "total" ? it.total : it.change);
  return [...items].sort(
    (a, b) => sign * (value(a) - value(b)) || (a.name ?? "").localeCompare(b.name ?? "") || a.key.localeCompare(b.key),
  );
}

/** 項目 → 交易帳本的篩選網址（未分類 / 未指定對象用 none）。 */
export function transactionsHref(item: Pick<TrendItem, "id" | "key">): string {
  const param = item.key.startsWith("category:") ? "category" : "party";
  return `/dashboard/transactions?${param}=${item.id ?? "none"}`;
}

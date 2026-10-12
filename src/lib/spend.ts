/**
 * 總覽頁「支出去向」的彙總：把 getSpendBreakdown 的 (月 × 交易對象 × 分類) 列，
 * 依選定的範圍與分組方式加總，取前 8 名，其餘併成「其他」。
 *
 * 純函式（不碰 DB、不碰 React），client 端切範圍時直接重算，也方便單元測試。
 */

export const SPEND_TOP_N = 8;

export type SpendRange = "month" | "3m" | "12m";
export type SpendGroupBy = "party" | "category";

/** 與 SpendRow（src/db/queries.ts）同形；這裡只描述彙總需要的欄位，避免 client 引到 DB 模組。 */
export type SpendInputRow = {
  month: string;
  partyId: number | null;
  partyName: string | null;
  partyAvatarVersion: string | null;
  categoryId: number | null;
  categoryName: string | null;
  totalTwd: number;
  count: number;
  unconverted: number;
};

export type SpendItem = {
  /** 穩定的 React key：party:12、category:3、party:none、other */
  key: string;
  kind: "party" | "category" | "none" | "other";
  /** 交易對象 / 分類 id；未指定與「其他」為 null */
  id: number | null;
  /** 顯示名稱；未指定與「其他」為 null（由畫面套翻譯） */
  name: string | null;
  avatarVersion: string | null;
  total: number;
  /** 占這個範圍總支出的比例（0–1） */
  share: number;
  count: number;
  /** 「其他」裡併了幾個交易對象 / 分類 */
  members: number;
};

export type SpendSummary = {
  items: SpendItem[];
  total: number;
  /** 範圍內沒換算台幣、所以沒計入的外幣筆數 */
  unconverted: number;
};

const RANGE_MONTHS: Record<SpendRange, number> = { month: 1, "3m": 3, "12m": 12 };

/** 範圍內的月份：取視窗最後 N 個月（視窗本身由舊到新、含當月）。 */
export function monthsInRange(months: readonly string[], range: SpendRange): Set<string> {
  return new Set(months.slice(-RANGE_MONTHS[range]));
}

type Bucket = Omit<SpendItem, "share" | "members">;

function bucketOf(row: SpendInputRow, groupBy: SpendGroupBy): Pick<Bucket, "key" | "kind" | "id" | "name" | "avatarVersion"> {
  if (groupBy === "party") {
    if (row.partyId == null) return { key: "party:none", kind: "none", id: null, name: null, avatarVersion: null };
    return {
      key: `party:${row.partyId}`,
      kind: "party",
      id: row.partyId,
      name: row.partyName,
      avatarVersion: row.partyAvatarVersion,
    };
  }
  if (row.categoryId == null) return { key: "category:none", kind: "none", id: null, name: null, avatarVersion: null };
  return {
    key: `category:${row.categoryId}`,
    kind: "category",
    id: row.categoryId,
    name: row.categoryName,
    avatarVersion: null,
  };
}

/**
 * 加總 → 排序（金額大到小，同額依名稱）→ 前 8 名 + 其他。
 * 合計 ≤ 0 的分組（例如整段範圍只有退款沖銷）不列出，也不算進總額，
 * 否則比例會超過 100% 或出現負的長條。
 */
export function summarizeSpend(
  rows: readonly SpendInputRow[],
  months: readonly string[],
  range: SpendRange,
  groupBy: SpendGroupBy,
  topN = SPEND_TOP_N,
): SpendSummary {
  const inRange = monthsInRange(months, range);
  const buckets = new Map<string, Bucket>();
  let unconverted = 0;

  for (const row of rows) {
    if (!inRange.has(row.month)) continue;
    unconverted += row.unconverted;
    const b = bucketOf(row, groupBy);
    const cur = buckets.get(b.key);
    if (cur) {
      cur.total += row.totalTwd;
      cur.count += row.count;
    } else {
      buckets.set(b.key, { ...b, total: row.totalTwd, count: row.count });
    }
  }

  const sorted = [...buckets.values()]
    .filter((b) => b.total > 0)
    .sort((a, b) => b.total - a.total || (a.name ?? "").localeCompare(b.name ?? "") || a.key.localeCompare(b.key));
  const total = sorted.reduce((sum, b) => sum + b.total, 0);
  const share = (v: number) => (total > 0 ? v / total : 0);

  const top: SpendItem[] = sorted.slice(0, topN).map((b) => ({ ...b, share: share(b.total), members: 1 }));
  const rest = sorted.slice(topN);
  if (rest.length > 0) {
    const restTotal = rest.reduce((sum, b) => sum + b.total, 0);
    top.push({
      key: "other",
      kind: "other",
      id: null,
      name: null,
      avatarVersion: null,
      total: restTotal,
      share: share(restTotal),
      count: rest.reduce((sum, b) => sum + b.count, 0),
      members: rest.length,
    });
  }

  return { items: top, total, unconverted };
}

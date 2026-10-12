import { addDays } from "./match";

// 同步要用的純函式：抓多久以前的資料、怎麼切月份、費用明細怎麼歸戶。client 也可以 import。

/** 第一次同步往回抓幾個月（含本月之前的 13 個月）。 */
export const FIRST_SYNC_MONTHS = 13;
/** 之後每次從「最後一張發票日 − 60 天」開始，涵蓋晚到的調整與重開的發票。 */
export const RESYNC_OVERLAP_DAYS = 60;
/** Cost Management 一次查詢的期間上限是一年，切成最多 12 個月一段。 */
export const COST_CHUNK_MONTHS = 12;

const taipeiFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Taipei",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** 現在 → 台北日期 YYYY-MM-DD。 */
export function taipeiToday(now: Date = new Date()): string {
  return taipeiFmt.format(now);
}

export function firstOfMonth(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

/** YYYY-MM-01 加減月份。 */
export function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 10);
}

/** 月份最後一天。 */
export function endOfMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
}

/**
 * 這個帳號這次要從哪天抓起：
 * - 從沒同步過發票 → 13 個月前的 1 號
 * - 同步過 → 最後一張發票日 − 60 天
 */
export function syncWindowStart(lastInvoiceDate: string | null, today: string): string {
  if (!lastInvoiceDate) return addMonths(firstOfMonth(today), -FIRST_SYNC_MONTHS);
  return addDays(lastInvoiceDate, -RESYNC_OVERLAP_DAYS);
}

/** [from, to] 切成每段最多 maxMonths 個日曆月（第一段從 from 所在月份的 1 號開始）。 */
export function monthChunks(from: string, to: string, maxMonths = COST_CHUNK_MONTHS): { from: string; to: string }[] {
  const out: { from: string; to: string }[] = [];
  let cur = firstOfMonth(from);
  while (cur <= to) {
    const nextStart = addMonths(cur, maxMonths);
    const end = addDays(nextStart, -1);
    out.push({ from: cur, to: end < to ? end : to });
    cur = nextStart;
  }
  return out;
}

/** YYYY-MM-01 → 'YYYYMM'（GCP invoice.month 的格式）。 */
export function yyyymm(month: string): string {
  return month.slice(0, 4) + month.slice(5, 7);
}

export type CostLineInput = {
  month: string;
  resourceExternalId: string;
  resourceName: string | null;
  service: string;
  amount: number;
  currency: string;
};

/**
 * 同一個 (月, 資源, 服務) 合併成一列 —— 同一次 upsert 裡出現重複鍵，Postgres 會拒絕。
 * 同鍵不同幣別的極端情況：保留第一個幣別、金額照加（Azure / GCP 一個帳號只有一種幣別）。
 */
export function aggregateCostLines(rows: readonly CostLineInput[]): CostLineInput[] {
  const map = new Map<string, CostLineInput>();
  for (const r of rows) {
    const key = `${r.month}|${r.resourceExternalId}|${r.service}`;
    const cur = map.get(key);
    if (cur) {
      cur.amount = Math.round((cur.amount + r.amount) * 10_000) / 10_000;
      cur.resourceName ??= r.resourceName;
    } else {
      map.set(key, { ...r });
    }
  }
  return [...map.values()];
}

export const UNALLOCATED_LABEL = "(未分配)";

/**
 * Azure 費用列的資源歸戶：billing profile 範圍的 Cost Management 只能依 SubscriptionName 分組，
 * 用名稱對回 subscription id；對不到就用名稱本身；名稱空白（折扣 / 調整列）歸到「(未分配)」。
 */
export function azureCostResource(
  subscriptionName: string,
  subscriptionId: string,
  subs: readonly { subscriptionId: string; displayName: string | null }[],
): { resourceExternalId: string; resourceName: string } {
  if (subscriptionId) {
    const byId = subs.find((x) => x.subscriptionId.toLowerCase() === subscriptionId.toLowerCase());
    return { resourceExternalId: subscriptionId.toLowerCase(), resourceName: byId?.displayName ?? subscriptionName ?? subscriptionId };
  }
  const name = subscriptionName.trim();
  if (!name) return { resourceExternalId: "", resourceName: UNALLOCATED_LABEL };
  const match = subs.find((x) => (x.displayName ?? "").trim() === name);
  return { resourceExternalId: match ? match.subscriptionId.toLowerCase() : name, resourceName: name };
}

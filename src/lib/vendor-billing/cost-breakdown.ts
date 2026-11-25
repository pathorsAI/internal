/**
 * 雲端花費明細：vendor_cost_lines（月 × 資源 × 服務 × 明細）→ 廠商計費頁「花費明細」要的形狀。
 * 純函式，server 撈好列之後在這裡彙總（可單元測試）。
 *
 * 三個金額（同一個幣別）：
 * - listAmount 原價：用量的定價，還沒扣任何 credits。
 * - discount 折扣：免費額度、承諾使用折扣這類直接降低成本的 credits（負數）。
 * - credit 抵用：GCP PROMOTION 抵用點數（負數）。
 * - net 淨額 = listAmount + discount + credit（實際要付的錢）。
 */

export type CostLineRow = {
  /** YYYY-MM-01 */
  month: string;
  service: string;
  resourceExternalId: string;
  resourceName: string | null;
  /** GCP SKU 說明；舊列或 Azure 為空字串 */
  sku: string;
  /** GKE cluster（goog-k8s-cluster-name）；沒有為空字串 */
  cluster: string;
  listAmount: number;
  discount: number;
  credit: number;
  net: number;
  currency: string;
};

export type CostAmounts = { listAmount: number; discount: number; credit: number; net: number };

export type CostDetail = CostAmounts & {
  key: string;
  /** SKU 或資源名稱 */
  label: string;
  /** 次要說明：cluster、專案 */
  sub: string | null;
  prevListAmount: number;
};

export type CostService = CostAmounts & {
  service: string;
  prevListAmount: number;
  prevNet: number;
  details: CostDetail[];
};

export type CostTrendPoint = { month: string; total: number; byService: Record<string, number> };

export type CostBreakdown = {
  month: string;
  prevMonth: string;
  currency: string | null;
  total: CostAmounts;
  prevTotal: CostAmounts;
  services: CostService[];
  /** 近 N 個月（舊 → 新）各服務原價，給堆疊長條用 */
  trend: CostTrendPoint[];
  /** 堆疊長條要畫的服務（依期間原價排序，前幾名，其餘合成「其他」） */
  trendServices: string[];
};

export const OTHER_SERVICE = "__other__";
const EMPTY_SERVICE = "(未分類)";

const round2 = (n: number) => Math.round(n * 100) / 100;

function zero(): CostAmounts {
  return { listAmount: 0, discount: 0, credit: 0, net: 0 };
}

function add(into: CostAmounts, r: CostAmounts) {
  into.listAmount += r.listAmount;
  into.discount += r.discount;
  into.credit += r.credit;
  into.net += r.net;
}

function rounded<T extends CostAmounts>(a: T): T {
  return { ...a, listAmount: round2(a.listAmount), discount: round2(a.discount), credit: round2(a.credit), net: round2(a.net) };
}

/** YYYY-MM-01 往前 / 往後 n 個月 */
export function shiftMonth(month: string, n: number): string {
  const y = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7)) - 1 + n;
  const yy = y + Math.floor(m / 12);
  const mm = ((m % 12) + 12) % 12;
  return `${yy}-${String(mm + 1).padStart(2, "0")}-01`;
}

/**
 * 明細的分組鍵：有 SKU 用 SKU × cluster × 專案，沒有（舊列、Azure）就用資源。
 * 整個帳號只有一個專案時，說明不重複寫專案名稱。
 */
function detailOf(r: CostLineRow, showResource: boolean): { key: string; label: string; sub: string | null } {
  const resource = r.resourceName || r.resourceExternalId || EMPTY_SERVICE;
  if (r.sku) {
    const parts = [r.cluster, showResource ? resource : ""].filter(Boolean);
    return { key: `${r.sku}|${r.cluster}|${r.resourceExternalId}`, label: r.sku, sub: parts.join(" · ") || null };
  }
  return { key: `|${r.cluster}|${r.resourceExternalId}`, label: resource, sub: r.cluster || null };
}

/** 一個月的金額全是 0 的服務 / 明細不顯示（GCP 有一堆 0 元的 API）。 */
const isZero = (a: CostAmounts) =>
  Math.abs(a.listAmount) < 0.005 && Math.abs(a.discount) < 0.005 && Math.abs(a.credit) < 0.005 && Math.abs(a.net) < 0.005;

export function buildCostBreakdown(
  rows: readonly CostLineRow[],
  month: string,
  opts: { trendMonths?: number; trendServices?: number } = {},
): CostBreakdown {
  const trendMonths = opts.trendMonths ?? 6;
  const maxTrendServices = opts.trendServices ?? 6;
  const prevMonth = shiftMonth(month, -1);
  const currency = rows.find((r) => r.month === month)?.currency ?? rows[0]?.currency ?? null;
  const showResource = new Set(rows.map((r) => r.resourceExternalId)).size > 1;

  type Acc = CostAmounts & { prevListAmount: number; prevNet: number; details: Map<string, CostDetail> };
  const services = new Map<string, Acc>();
  const total = zero();
  const prevTotal = zero();
  const svc = (name: string): Acc => {
    let s = services.get(name);
    if (!s) {
      s = { ...zero(), prevListAmount: 0, prevNet: 0, details: new Map() };
      services.set(name, s);
    }
    return s;
  };

  for (const r of rows) {
    if (r.month !== month && r.month !== prevMonth) continue;
    const name = r.service || EMPTY_SERVICE;
    const s = svc(name);
    const d = detailOf(r, showResource);
    let detail = s.details.get(d.key);
    if (!detail) {
      detail = { ...d, ...zero(), prevListAmount: 0 };
      s.details.set(d.key, detail);
    }
    if (r.month === month) {
      add(s, r);
      add(detail, r);
      add(total, r);
    } else {
      s.prevListAmount += r.listAmount;
      s.prevNet += r.net;
      detail.prevListAmount += r.listAmount;
      add(prevTotal, r);
    }
  }

  const serviceList: CostService[] = [...services.entries()]
    .map(([service, s]) => ({
      ...rounded({ listAmount: s.listAmount, discount: s.discount, credit: s.credit, net: s.net }),
      service,
      prevListAmount: round2(s.prevListAmount),
      prevNet: round2(s.prevNet),
      details: [...s.details.values()]
        .map((d) => ({ ...rounded(d), prevListAmount: round2(d.prevListAmount) }))
        .filter((d) => !isZero(d) || Math.abs(d.prevListAmount) >= 0.005)
        .sort((a, b) => b.listAmount - a.listAmount || b.prevListAmount - a.prevListAmount),
    }))
    .filter((s) => !isZero(s) || Math.abs(s.prevListAmount) >= 0.005)
    .sort((a, b) => b.listAmount - a.listAmount || b.prevListAmount - a.prevListAmount);

  const { trend, trendServices } = buildTrend(rows, month, trendMonths, maxTrendServices);

  return {
    month,
    prevMonth,
    currency,
    total: rounded(total),
    prevTotal: rounded(prevTotal),
    services: serviceList,
    trend,
    trendServices,
  };
}

/** 近 trendMonths 個月 × 服務的原價；帳號還沒開始計費的前段空月份不畫，尾端的服務併成「其他」。 */
function buildTrend(
  rows: readonly CostLineRow[],
  month: string,
  trendMonths: number,
  maxTrendServices: number,
): { trend: CostTrendPoint[]; trendServices: string[] } {
  const firstWithData = rows.reduce<string | null>((min, r) => (min === null || r.month < min ? r.month : min), null);
  const months: string[] = [];
  for (let i = trendMonths - 1; i >= 0; i--) {
    const m = shiftMonth(month, -i);
    if (i === 0 || (firstWithData !== null && m >= firstWithData)) months.push(m);
  }
  const inWindow = new Set(months);
  const periodBySvc = new Map<string, number>();
  const cell = new Map<string, number>();
  for (const r of rows) {
    if (!inWindow.has(r.month)) continue;
    const name = r.service || EMPTY_SERVICE;
    periodBySvc.set(name, (periodBySvc.get(name) ?? 0) + r.listAmount);
    const k = `${r.month}|${name}`;
    cell.set(k, (cell.get(k) ?? 0) + r.listAmount);
  }
  const ranked = [...periodBySvc.entries()].filter(([, v]) => v >= 0.005).sort((a, b) => b[1] - a[1]).map(([k]) => k);
  const shown = ranked.length > maxTrendServices ? ranked.slice(0, maxTrendServices - 1) : ranked;
  const hasOther = ranked.length > shown.length;
  const shownSet = new Set(shown);
  const trend: CostTrendPoint[] = months.map((m) => {
    const byService: Record<string, number> = {};
    let t = 0;
    let other = 0;
    for (const name of ranked) {
      const v = cell.get(`${m}|${name}`) ?? 0;
      t += v;
      if (shownSet.has(name)) byService[name] = round2(v);
      else other += v;
    }
    if (hasOther) byService[OTHER_SERVICE] = round2(other);
    return { month: m, total: round2(t), byService };
  });

  return { trend, trendServices: hasOther ? [...shown, OTHER_SERVICE] : shown };
}

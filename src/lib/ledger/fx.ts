/** 匯率查詢：當天或之前最近一筆；本位幣永遠是 1。 */
import { daysBetween } from "./periods";
import { round2 } from "./round";
import type { FxRate } from "./types";

/** 超過這麼多天才找到的匯率算「推估」（待處理 fx_estimated）。 */
export const FX_STALE_DAYS = 7;

export type RateHit = { rate: number; date: string; estimated: boolean };

export class FxTable {
  private byCurrency = new Map<string, { date: string; rate: number }[]>();

  constructor(
    rates: FxRate[],
    private functional: string,
  ) {
    for (const r of rates) {
      if (!(r.rate > 0)) continue;
      const cur = r.currency.toUpperCase();
      const list = this.byCurrency.get(cur) ?? [];
      list.push({ date: r.date.slice(0, 10), rate: r.rate });
      this.byCurrency.set(cur, list);
    }
    for (const list of this.byCurrency.values()) list.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  }

  isFunctional(currency: string | null | undefined): boolean {
    return !currency || currency.toUpperCase() === this.functional.toUpperCase();
  }

  rateAt(currency: string, date: string): RateHit | null {
    if (this.isFunctional(currency)) return { rate: 1, date, estimated: false };
    const list = this.byCurrency.get(currency.toUpperCase());
    if (!list || list.length === 0) return null;
    // 二分搜尋最後一筆 date <= 目標日
    let lo = 0;
    let hi = list.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid].date <= date) {
        found = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    if (found < 0) return null;
    const hit = list[found];
    return { rate: hit.rate, date: hit.date, estimated: daysBetween(hit.date, date) > FX_STALE_DAYS };
  }

  /** 原幣 → 本位幣。amountTwd 有值就用它。 */
  toFunctional(amount: number, currency: string, amountTwd: number | null, date: string): { amount: number; estimated: boolean } | null {
    if (amountTwd != null) return { amount: round2(amountTwd), estimated: false };
    const hit = this.rateAt(currency, date);
    if (!hit) return null;
    return { amount: round2(amount * hit.rate), estimated: hit.estimated };
  }
}

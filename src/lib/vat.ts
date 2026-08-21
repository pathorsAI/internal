/**
 * 台灣營業稅（5%）與雙月申報期的共用計算。
 *
 * 「這期該開多少發票」是財務每兩個月一定會問的問題，發票草稿的稅額預填與稅期
 * 報表都靠這裡，避免兩邊各算各的。
 */

export const TW_VAT_RATE = 0.05;

const round2 = (n: number) => Math.round(n * 100) / 100;

/** 含稅金額 → { 未稅, 稅額 }。稅額用減法算，保證未稅 + 稅額 === 含稅。 */
export function splitGross(gross: number): { net: number; tax: number } {
  const net = round2(gross / (1 + TW_VAT_RATE));
  return { net, tax: round2(gross - net) };
}

/** 未稅金額 → { 稅額, 含稅 }。 */
export function grossFromNet(net: number): { tax: number; gross: number } {
  const tax = round2(net * TW_VAT_RATE);
  return { tax, gross: round2(net + tax) };
}

/**
 * 營業稅申報期別：雙月一期，1-2 月為第 1 期、3-4 月為第 2 期，依此類推。
 * 回傳 { year, period, startMonth, endMonth, start, end }，start/end 為 YYYY-MM-DD。
 * 期別的顯示字串由畫面端組（要跟著語系走），這裡只給組字串需要的數字。
 */
export type TaxPeriod = {
  year: number;
  /** 1 ~ 6 */
  period: number;
  /** 期別涵蓋的頭尾月份，例：第 3 期為 5 與 6 */
  startMonth: number;
  endMonth: number;
  start: string;
  end: string;
};

const pad = (n: number) => String(n).padStart(2, "0");

export function taxPeriodOf(date: string): TaxPeriod {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  return taxPeriod(year, Math.ceil(month / 2));
}

export function taxPeriod(year: number, period: number): TaxPeriod {
  const startMonth = period * 2 - 1;
  const endMonth = startMonth + 1;
  // 期末當月最後一天：下個月的第 0 天。
  const endDay = new Date(year, endMonth, 0).getDate();
  return {
    year,
    period,
    startMonth,
    endMonth,
    start: `${year}-${pad(startMonth)}-01`,
    end: `${year}-${pad(endMonth)}-${pad(endDay)}`,
  };
}

/** 往前推 n 期（n = 0 為當期）。 */
export function shiftTaxPeriod(p: TaxPeriod, n: number): TaxPeriod {
  const abs = p.year * 6 + (p.period - 1) + n;
  return taxPeriod(Math.floor(abs / 6), (abs % 6) + 1);
}

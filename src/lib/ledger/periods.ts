/** 日期都是 'YYYY-MM-DD' 字串，用 UTC 算，避免時區把日期推前一天。 */
import type { Period } from "./types";

const pad = (n: number) => String(n).padStart(2, "0");

function parse(date: string): [number, number, number] {
  const [y, m, d] = date.slice(0, 10).split("-").map(Number);
  return [y, m, d];
}

function fmt(t: Date): string {
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

export function addDays(date: string, n: number): string {
  const [y, m, d] = parse(date);
  return fmt(new Date(Date.UTC(y, m - 1, d + n)));
}

/** 某月第一天加 n 個月（只用在月初，不會有 1/31 + 1 個月的問題）。 */
export function addMonths(firstOfMonth: string, n: number): string {
  const [y, m] = parse(firstOfMonth);
  return fmt(new Date(Date.UTC(y, m - 1 + n, 1)));
}

export function monthStart(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

export function monthEnd(date: string): string {
  const [y, m] = parse(date);
  return fmt(new Date(Date.UTC(y, m, 0)));
}

export function monthEndOf(year: number, month: number): string {
  return fmt(new Date(Date.UTC(year, month, 0)));
}

/** 'YYYY-MM' */
export function ym(date: string): string {
  return date.slice(0, 7);
}

export function daysBetween(a: string, b: string): number {
  const [y1, m1, d1] = parse(a);
  const [y2, m2, d2] = parse(b);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
}

/** date 所在會計年度的第一天。 */
export function fiscalYearStart(date: string, startMonth: number): string {
  const [y, m] = parse(date);
  const sm = Math.min(12, Math.max(1, Math.trunc(startMonth) || 1));
  return `${m >= sm ? y : y - 1}-${pad(sm)}-01`;
}

type PresetKey = "this_month" | "last_month" | "this_quarter" | "last_quarter" | "ytd" | "this_year" | "last_year";

/** 季是「會計季」：從會計年度起始月算起每三個月一季。 */
export function periodPresets(today: string, startMonth: number): { key: PresetKey; period: Period }[] {
  const thisMonth = monthStart(today);
  const lastMonth = addMonths(thisMonth, -1);
  const fy = fiscalYearStart(today, startMonth);
  const monthsIn = (parse(thisMonth)[0] - parse(fy)[0]) * 12 + (parse(thisMonth)[1] - parse(fy)[1]);
  const q = addMonths(fy, Math.floor(monthsIn / 3) * 3);
  const lastQ = addMonths(q, -3);
  const lastFy = addMonths(fy, -12);
  const span = (from: string, months: number): Period => ({ from, to: addDays(addMonths(from, months), -1) });
  return [
    { key: "this_month", period: span(thisMonth, 1) },
    { key: "last_month", period: span(lastMonth, 1) },
    { key: "this_quarter", period: span(q, 3) },
    { key: "last_quarter", period: span(lastQ, 3) },
    { key: "ytd", period: { from: fy, to: today.slice(0, 10) } },
    { key: "this_year", period: span(fy, 12) },
    { key: "last_year", period: span(lastFy, 12) },
  ];
}

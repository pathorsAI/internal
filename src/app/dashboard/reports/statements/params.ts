/**
 * 財務報表頁的網址參數：頁面、匯出、列印、MCP 共用同一套解析，數字才會一致。
 *
 *   report  bs | is | cf | eq | tb | vat | review | notes（預設 bs）
 *   ledger  government | management（預設 government）
 *   period  periodPresets 的 key，或 custom（搭配 from / to）；預設 ytd
 *   compare none | prev | yoy
 *   year    營業稅的年度
 *
 * 純函式，client / server 都能 import。
 */
import { addDays, addMonths, differenceInCalendarDays, endOfMonth, format, parseISO } from "date-fns";
import type { LedgerKind, Period } from "@/lib/ledger/types";

export const REPORTS = ["bs", "is", "cf", "eq", "tb", "vat", "review", "notes"] as const;
export type ReportKey = (typeof REPORTS)[number];

export const COMPARES = ["none", "prev", "yoy"] as const;
export type CompareKey = (typeof COMPARES)[number];

export const PRESET_KEYS = [
  "this_month",
  "last_month",
  "this_quarter",
  "last_quarter",
  "ytd",
  "this_year",
  "last_year",
] as const;
export type PresetKey = (typeof PRESET_KEYS)[number];

export type Preset = { key: PresetKey; period: Period };

export type StatementParams = {
  report: ReportKey;
  ledger: LedgerKind;
  /** 預設 key，或 custom */
  periodKey: PresetKey | "custom";
  period: Period;
  compare: CompareKey;
  comparePeriod: Period | null;
  /** 營業稅年度 */
  year: number;
};

type RawParams = Record<string, string | string[] | undefined>;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function isDate(v: string | undefined): v is string {
  return !!v && DATE_RE.test(v) && !Number.isNaN(parseISO(v).getTime());
}

const fmt = (d: Date) => format(d, "yyyy-MM-dd");

/** 整月的期間（from 是 1 號、to 是月底）→ 月數；否則 null。 */
function wholeMonths(period: Period): number | null {
  const from = parseISO(period.from);
  const to = parseISO(period.to);
  if (from.getDate() !== 1) return null;
  if (fmt(endOfMonth(to)) !== period.to) return null;
  return (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth()) + 1;
}

/** 上一期：整月的期間往前推同樣的月數，否則往前推同樣的天數。 */
export function previousPeriod(period: Period): Period {
  const months = wholeMonths(period);
  if (months !== null) {
    const from = addMonths(parseISO(period.from), -months);
    const to = endOfMonth(addMonths(parseISO(period.to), -months));
    return { from: fmt(from), to: fmt(to) };
  }
  const days = differenceInCalendarDays(parseISO(period.to), parseISO(period.from)) + 1;
  return {
    from: fmt(addDays(parseISO(period.from), -days)),
    to: fmt(addDays(parseISO(period.to), -days)),
  };
}

/** 去年同期（2/29 落到 2/28；整月的 to 對齊月底）。 */
export function sameLastYear(period: Period): Period {
  const months = wholeMonths(period);
  const from = addMonths(parseISO(period.from), -12);
  const toRaw = addMonths(parseISO(period.to), -12);
  return { from: fmt(from), to: fmt(months === null ? toRaw : endOfMonth(toRaw)) };
}

export function comparePeriodOf(period: Period, compare: CompareKey): Period | null {
  if (compare === "prev") return previousPeriod(period);
  if (compare === "yoy") return sameLastYear(period);
  return null;
}

/**
 * 解析網址參數。presets 由呼叫端用 periodPresets(today, fiscalYearStartMonth) 算好傳進來，
 * 這支就不必知道會計年度怎麼切。
 */
export function parseStatementParams(raw: RawParams, presets: Preset[], today: string): StatementParams {
  const reportRaw = one(raw.report);
  const report = (REPORTS as readonly string[]).includes(reportRaw ?? "") ? (reportRaw as ReportKey) : "bs";
  const ledger: LedgerKind = one(raw.ledger) === "management" ? "management" : "government";
  const compareRaw = one(raw.compare);
  const compare = (COMPARES as readonly string[]).includes(compareRaw ?? "") ? (compareRaw as CompareKey) : "none";

  const from = one(raw.from);
  const to = one(raw.to) ?? one(raw.asOf);
  const periodRaw = one(raw.period);
  let periodKey: PresetKey | "custom";
  let period: Period;
  const preset = presets.find((p) => p.key === periodRaw);
  if (preset) {
    periodKey = preset.key;
    period = preset.period;
  } else if (isDate(to) && (periodRaw === "custom" || periodRaw === undefined)) {
    periodKey = "custom";
    // 只給 to（資產負債表的 as-of）時，期間從當年 1/1 起算
    const start = isDate(from) ? from : `${to.slice(0, 4)}-01-01`;
    period = start <= to ? { from: start, to } : { from: to, to: start };
  } else {
    const fallback = presets.find((p) => p.key === "ytd") ?? presets[0];
    periodKey = fallback?.key ?? "custom";
    period = fallback?.period ?? { from: `${today.slice(0, 4)}-01-01`, to: today };
  }

  const yearRaw = Number(one(raw.year));
  const year = Number.isInteger(yearRaw) && yearRaw >= 2000 && yearRaw <= 2100 ? yearRaw : Number(period.to.slice(0, 4));

  return { report, ledger, periodKey, period, compare, comparePeriod: comparePeriodOf(period, compare), year };
}

/** 把參數寫回 query string（匯出、列印、頁籤連結用）。 */
export function statementQuery(p: Partial<StatementParams> & { period?: Period }, extra?: Record<string, string>): string {
  const q = new URLSearchParams();
  if (p.report) q.set("report", p.report);
  if (p.ledger) q.set("ledger", p.ledger);
  if (p.periodKey && p.periodKey !== "custom") q.set("period", p.periodKey);
  else if (p.period) {
    q.set("period", "custom");
    q.set("from", p.period.from);
    q.set("to", p.period.to);
  }
  if (p.compare && p.compare !== "none") q.set("compare", p.compare);
  if (p.year) q.set("year", String(p.year));
  for (const [k, v] of Object.entries(extra ?? {})) q.set(k, v);
  return q.toString();
}

/** 下鑽、待處理清單連回來源的網址。 */
export function sourceHref(sourceType: string, sourceId: number | null): string | null {
  switch (sourceType) {
    case "transaction":
      return sourceId === null ? null : `/dashboard/transactions?ids=${sourceId}`;
    case "invoice":
      return "/dashboard/invoices";
    case "manual":
      return "/dashboard/accounting";
    case "depreciation":
      return "/dashboard/accounting";
    case "opening":
      return "/dashboard/settings/accounting";
    default:
      return null;
  }
}

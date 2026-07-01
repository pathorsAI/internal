// 金額格式化的唯一實作在 @/lib/currency（幣別的 single source of truth）。
// 這裡再匯出一次，維持既有 `@/lib/format` 的 import 不變。
export { formatCurrency } from "./currency";

export function formatDate(value: Date | string) {
  const d = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("zh-TW", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** 年/月顯示，補零（例：2026/07）。 */
export function formatYearMonth(year: number, month: number) {
  return `${year}/${String(month).padStart(2, "0")}`;
}

/** 日期 + 時:分（24 小時制），補零（例：2026/07/01 14:30）。 */
export function formatDateTime(value: Date | string) {
  const d = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("zh-TW", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

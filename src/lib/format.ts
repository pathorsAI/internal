const CURRENCY_PREFIX: Record<string, string> = {
  TWD: "NT$",
  USD: "US$",
  EUR: "€",
  JPY: "¥",
  CNY: "CN¥",
};

export function formatCurrency(value: number | string, currency = "TWD") {
  const n = typeof value === "string" ? Number(value) : value;
  const prefix = CURRENCY_PREFIX[currency] ?? `${currency} `;
  const num = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(
    Math.abs(n),
  );
  return `${n < 0 ? "-" : ""}${prefix}${num}`;
}

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

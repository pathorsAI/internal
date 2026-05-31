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

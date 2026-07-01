/**
 * 幣別的唯一真實來源（single source of truth）。
 *
 * 要新增一種幣別，只要在 CURRENCIES 加一行：所有下拉選單、標籤、金額格式化
 * 都會自動跟上。格式化本身走 Intl，就算是這裡沒登記的 ISO 代碼也能正確顯示符號與小數位。
 *
 * 注意：本系統「不做匯率換算」（不同幣別分開加總），這裡只負責挑選與顯示。
 */

export type CurrencyMeta = {
  /** ISO 4217 代碼，例如 "TWD"。 */
  code: string;
  /** 中文名稱，下拉選單用，例如 "台幣"。 */
  name: string;
  /** 顯示符號（刻意用可辨識的形式，例如 US$ 而非 $）。 */
  symbol: string;
  /** 顯示小數位；金額為整數時一律不顯示小數，有小數時才補到這個位數。 */
  decimals: number;
  /** public/flags 內的國旗檔名（國家名稱）；下拉與金額前的小圖示用，缺就退回地球圖示。 */
  flag?: string;
};

/** 提供給選單的幣別。新增幣別＝在這裡加一行（flag 對應 public/flags/<名稱>.svg）。 */
export const CURRENCIES: CurrencyMeta[] = [
  { code: "TWD", name: "台幣", symbol: "NT$", decimals: 0, flag: "Taiwan" },
  { code: "USD", name: "美金", symbol: "US$", decimals: 2, flag: "United States" },
  { code: "EUR", name: "歐元", symbol: "€", decimals: 2, flag: "European Union" },
  { code: "JPY", name: "日圓", symbol: "¥", decimals: 0, flag: "Japan" },
  { code: "CNY", name: "人民幣", symbol: "CN¥", decimals: 2, flag: "China" },
];

export const DEFAULT_CURRENCY = "TWD";

const BY_CODE = new Map(CURRENCIES.map((c) => [c.code, c]));

/** 用 Intl 推導未登記幣別的符號（universal fallback）。 */
function deriveSymbol(code: string): string {
  try {
    const parts = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: code,
      currencyDisplay: "symbol",
      maximumFractionDigits: 0,
    }).formatToParts(0);
    return parts.find((p) => p.type === "currency")?.value ?? `${code} `;
  } catch {
    return `${code} `;
  }
}

/** 用 Intl 推導未登記幣別的小數位（例如 USD→2、JPY→0）。 */
function deriveDecimals(code: string): number {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: code })
      .resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

/** 取得幣別的顯示設定；登記過的直接用，未登記的用 Intl 推導後快取。 */
export function currencyMeta(code: string): CurrencyMeta {
  const known = BY_CODE.get(code);
  if (known) return known;
  const derived: CurrencyMeta = {
    code,
    name: code,
    symbol: deriveSymbol(code),
    decimals: deriveDecimals(code),
  };
  BY_CODE.set(code, derived);
  return derived;
}

/** 選單標籤，例如 "NT$ 台幣"；未登記幣別則退回符號＋代碼。 */
export function currencyLabel(code: string): string {
  const m = currencyMeta(code);
  return m.name === code ? `${m.symbol}${code}` : `${m.symbol} ${m.name}`;
}

/** 幣別對應的國旗檔名（public/flags/<name>.svg）；未登記幣別回傳 undefined（顯示地球圖示）。 */
export function currencyFlag(code: string): string | undefined {
  return currencyMeta(code).flag;
}

const nfCache = new Map<string, Intl.NumberFormat>();
function numberFormat(decimals: number): Intl.NumberFormat {
  let nf = nfCache.get(String(decimals));
  if (!nf) {
    nf = new Intl.NumberFormat("en-US", {
      minimumFractionDigits: 0,
      maximumFractionDigits: decimals,
    });
    nfCache.set(String(decimals), nf);
  }
  return nf;
}

/**
 * 依幣別格式化金額：整數乾淨顯示（NT$1,000），有小數才補到該幣別的位數（US$1,000.50）。
 * 任何 ISO 代碼都能用，未登記的也會走 Intl 推導。
 */
export function formatCurrency(value: number | string, currency = DEFAULT_CURRENCY): string {
  const n = typeof value === "string" ? Number(value) : value;
  const safe = Number.isFinite(n) ? n : 0;
  const meta = currencyMeta(currency);
  const decimals = Number.isInteger(safe) ? 0 : meta.decimals;
  const num = numberFormat(decimals).format(Math.abs(safe));
  return `${safe < 0 ? "-" : ""}${meta.symbol}${num}`;
}

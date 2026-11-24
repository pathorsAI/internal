/**
 * 營業稅別：合約／訂閱／請款項目的 amount 是「未稅」還是「含稅」、要不要加收 5%。
 *
 * 解析順序（resolveTaxSetting）：
 *   - 訂閱、請款項目有綁合約 → 一律跟著合約；
 *   - 合約或沒綁合約的訂閱／請款項目 → 自己的欄位，NULL 沿用組織預設；
 *   - 組織預設存在 organization.tax_treatment / amount_basis（migrations/0040）。
 *
 * 金額拆解（taxBreakdown）回傳客戶實際要付的含稅應收、未稅、稅額。收齊判斷一律拿 gross 去比入帳，
 * 營收推算一律用 net。稅率沿用 src/lib/vat.ts 的 TW_VAT_RATE。
 *
 * client / server 共用，不能 import server-only 的東西。
 */
import { TW_VAT_RATE } from "./vat";

export const TAX_TREATMENTS = ["taxable", "zero_rated", "exempt", "none"] as const;
export type TaxTreatment = (typeof TAX_TREATMENTS)[number];

export const AMOUNT_BASES = ["net", "gross"] as const;
export type AmountBasis = (typeof AMOUNT_BASES)[number];

export type TaxSetting = { treatment: TaxTreatment; basis: AmountBasis };

/** 新組織、或組織欄位讀不到時的預設：應稅 5%，金額為未稅（報價單寫「金額（未稅）」）。 */
export const DEFAULT_TAX_SETTING: TaxSetting = { treatment: "taxable", basis: "net" };

export function isTaxTreatment(v: unknown): v is TaxTreatment {
  return typeof v === "string" && (TAX_TREATMENTS as readonly string[]).includes(v);
}
export function isAmountBasis(v: unknown): v is AmountBasis {
  return typeof v === "string" && (AMOUNT_BASES as readonly string[]).includes(v);
}

type Partial = { treatment?: string | null; basis?: string | null } | null | undefined;

function pick(p: Partial, fallback: TaxSetting): TaxSetting {
  return {
    treatment: isTaxTreatment(p?.treatment) ? p.treatment : fallback.treatment,
    basis: isAmountBasis(p?.basis) ? p.basis : fallback.basis,
  };
}

/**
 * 有效稅別。`contract` 給了（代表綁了合約）就以合約為準，不看 `own`；
 * 各欄位 NULL 就往上沿用（合約 → 組織 → DEFAULT_TAX_SETTING）。
 */
export function resolveTaxSetting(opts: {
  org?: Partial;
  contract?: Partial;
  own?: Partial;
}): TaxSetting {
  const org = pick(opts.org, DEFAULT_TAX_SETTING);
  if (opts.contract !== undefined && opts.contract !== null) return pick(opts.contract, org);
  return pick(opts.own, org);
}

/** 只有應稅要加收／內含稅額；零稅率、免稅、不加收都沒有稅額。 */
export function chargesTax(treatment: TaxTreatment): boolean {
  return treatment === "taxable";
}

export type TaxBreakdown = {
  /** 未稅（營收推算用這個） */
  net: number;
  /** 稅額 */
  tax: number;
  /** 含稅應收：客戶實際要付的錢（收齊判斷用這個） */
  gross: number;
};

/** 台幣的稅額照發票慣例四捨五入到元；其他幣別到分。 */
function roundTax(n: number, currency: string): number {
  if (currency.toUpperCase() === "TWD") return Math.round(n);
  return Math.round(n * 100) / 100;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * 依有效稅別把一個 amount 拆成未稅／稅額／含稅。
 * - 應稅＋未稅：tax = round(amount × 5%)，gross = amount + tax（5,800×3＝17,400 → 870 → 18,270）
 * - 應稅＋含稅：net = round(amount ÷ 1.05)，tax = amount − net（保證 net + tax === amount）
 * - 其他：沒有稅額，三個數字都是 amount。
 */
export function taxBreakdown(amount: number, setting: TaxSetting, currency = "TWD"): TaxBreakdown {
  const a = round2(amount);
  if (!chargesTax(setting.treatment)) return { net: a, tax: 0, gross: a };
  if (setting.basis === "net") {
    const tax = roundTax(a * TW_VAT_RATE, currency);
    return { net: a, tax, gross: round2(a + tax) };
  }
  const net = roundTax(a / (1 + TW_VAT_RATE), currency);
  return { net, tax: round2(a - net), gross: a };
}

/** 可為 null 的 amount（合約金額未定）。 */
export function taxBreakdownOrNull(
  amount: number | string | null | undefined,
  setting: TaxSetting,
  currency = "TWD",
): TaxBreakdown | null {
  if (amount === null || amount === undefined || amount === "") return null;
  const n = Number(amount);
  return Number.isFinite(n) ? taxBreakdown(n, setting, currency) : null;
}

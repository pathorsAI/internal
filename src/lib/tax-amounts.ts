/**
 * 讀取路徑用的稅別小工具：把「組織預設 + 合約欄位 + 自己的欄位」收斂成有效稅別，
 * 再把 amount 拆成 net / tax / gross 附在列上。規則見 src/lib/tax-treatment.ts。
 *
 * 純函式，client / server 共用。
 */
import {
  resolveTaxSetting,
  taxBreakdown,
  type AmountBasis,
  type TaxBreakdown,
  type TaxSetting,
  type TaxTreatment,
} from "./tax-treatment";

/** 資料表上那兩欄的原樣（可為 NULL＝沿用）。 */
export type TaxColumns = { taxTreatment: string | null; amountBasis: string | null };

/** 附在列上的稅別資訊：有效稅別 + 金額拆解。 */
export type TaxedAmount = TaxBreakdown & {
  taxTreatment: TaxTreatment;
  amountBasis: AmountBasis;
};

function partialOf(c: TaxColumns | null | undefined) {
  return { treatment: c?.taxTreatment ?? null, basis: c?.amountBasis ?? null };
}

/**
 * 有效稅別。`contractId` 不是 null 就代表綁了合約 → 一律跟著合約（合約欄位 NULL 再沿用組織），
 * 沒綁合約才看自己的欄位。合約本身呼叫時不給 contractId（傳 null）即可。
 */
export function effectiveTaxSetting(
  org: TaxSetting,
  own: TaxColumns | null | undefined,
  contractId: number | null | undefined = null,
  contract: TaxColumns | null | undefined = null,
): TaxSetting {
  return resolveTaxSetting({
    org,
    own: partialOf(own),
    contract: contractId == null ? undefined : partialOf(contract),
  });
}

/** amount → { net, tax, gross, taxTreatment, amountBasis }。 */
export function taxedAmount(amount: number, setting: TaxSetting, currency: string): TaxedAmount {
  return {
    ...taxBreakdown(amount, setting, currency),
    taxTreatment: setting.treatment,
    amountBasis: setting.basis,
  };
}

/** 可為 null 的 amount（合約金額未定）：拆不出來就三個數字都是 null，稅別照樣回。 */
export function taxedAmountOrNull(
  amount: number | string | null | undefined,
  setting: TaxSetting,
  currency: string,
): { net: number | null; tax: number | null; gross: number | null; taxTreatment: TaxTreatment; amountBasis: AmountBasis } {
  const n = amount === null || amount === undefined || amount === "" ? Number.NaN : Number(amount);
  if (!Number.isFinite(n)) {
    return { net: null, tax: null, gross: null, taxTreatment: setting.treatment, amountBasis: setting.basis };
  }
  return taxedAmount(n, setting, currency);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * 收款進度：入帳（含稅）一律拿含稅應收去比。gross 為 null（金額未定）時沒有未收、也沒有收齊；
 * gross 0 也不算收齊（沒有東西可收）。
 */
export function collectionProgress(
  gross: number | null,
  received: number,
): { remaining: number | null; fullyCollected: boolean } {
  if (gross == null) return { remaining: null, fullyCollected: false };
  return { remaining: round2(gross - received), fullyCollected: gross > 0 && received >= gross };
}

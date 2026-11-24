"use client";

import { useTranslations } from "next-intl";
import { SelectField } from "@/components/form-field";
import { SelectItem } from "@/components/ui/select";
import {
  AMOUNT_BASES,
  TAX_TREATMENTS,
  isAmountBasis,
  isTaxTreatment,
  type TaxSetting,
} from "@/lib/tax-treatment";

/** 「沿用」選項的值；mutations 的 taxFormColumns 會轉回 NULL（Radix Select 不收空字串）。 */
export const TAX_INHERIT = "inherit";

/**
 * 稅別＋金額基準兩個下拉，表單欄位名 taxTreatment / amountBasis。
 *
 * - `orgDefault` 有給：多一個「沿用組織預設（應稅 5%）」選項，NULL 就選它（合約、沒綁合約的訂閱／請款項目）。
 * - 沒給：只能選明確的值（組織設定本身）。
 */
export function TaxFields({
  treatment,
  basis,
  orgDefault,
}: Readonly<{
  treatment: string | null | undefined;
  basis: string | null | undefined;
  orgDefault?: TaxSetting;
}>) {
  const t = useTranslations("common.tax");
  const inherit = orgDefault != null;
  // 沒存值時：可沿用就選「沿用」，不能沿用（組織預設本身）就給系統預設
  let treatmentValue: string = inherit ? TAX_INHERIT : "taxable";
  if (isTaxTreatment(treatment)) treatmentValue = treatment;
  let basisValue: string = inherit ? TAX_INHERIT : "net";
  if (isAmountBasis(basis)) basisValue = basis;

  return (
    <>
      <SelectField
        name="taxTreatment"
        label={t("treatmentLabel")}
        defaultValue={treatmentValue}
      >
        {orgDefault && (
          <SelectItem value={TAX_INHERIT}>
            {t("inheritWithValue", { value: t(`treatment.${orgDefault.treatment}`) })}
          </SelectItem>
        )}
        {TAX_TREATMENTS.map((v) => (
          <SelectItem key={v} value={v}>
            {t(`treatment.${v}`)}
          </SelectItem>
        ))}
      </SelectField>
      <SelectField name="amountBasis" label={t("basisLabel")} defaultValue={basisValue}>
        {orgDefault && (
          <SelectItem value={TAX_INHERIT}>
            {t("inheritWithValue", { value: t(`basis.${orgDefault.basis}`) })}
          </SelectItem>
        )}
        {AMOUNT_BASES.map((v) => (
          <SelectItem key={v} value={v}>
            {t(`basis.${v}`)}
          </SelectItem>
        ))}
      </SelectField>
    </>
  );
}

/** 綁了合約的訂閱／請款項目：不給選，只說明跟著合約走。 */
export function TaxFollowsContract() {
  const t = useTranslations("common.tax");
  return <p className="text-xs text-muted-foreground sm:col-span-2">{t("followsContract")}</p>;
}

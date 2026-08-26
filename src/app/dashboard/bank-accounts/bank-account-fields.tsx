"use client";

import { useTranslations } from "next-intl";
import { Field, SelectField, TextField } from "@/components/form-field";
import { CurrencySelect } from "@/components/currency-select";
import { SelectItem } from "@/components/ui/select";

const KINDS = ["bank", "wise", "cash"] as const;

export type BankAccountFormValues = {
  name: string;
  kind: string;
  currency: string;
  openingBalance: string;
  isActive: boolean;
};

/** 新增與編輯共用的銀行帳戶欄位群。沒有 values 就是新增模式。 */
export function BankAccountFields({
  values,
}: Readonly<{
  values?: BankAccountFormValues;
}>) {
  const t = useTranslations("bankAccounts");

  return (
    <>
      <TextField
        name="name"
        label={t("form.name")}
        required
        wide
        placeholder={t("form.namePlaceholder")}
        defaultValue={values?.name}
      />
      <SelectField name="kind" label={t("form.type")} defaultValue={values?.kind ?? "bank"}>
        {KINDS.map((k) => (
          <SelectItem key={k} value={k}>
            {t(`kind.${k}`)}
          </SelectItem>
        ))}
      </SelectField>
      <Field label={t("form.currency")}>
        <CurrencySelect defaultValue={values?.currency} />
      </Field>
      {/* 新增時這格獨佔一整列；編輯時下面還有啟用開關，就只佔一欄。 */}
      <TextField
        name="openingBalance"
        label={t("form.openingBalance")}
        wide={!values}
        type="number"
        step="0.01"
        defaultValue={values?.openingBalance ?? "0"}
      />
      {/* 啟用狀態只有編輯時能改，新增一律是啟用。 */}
      {values && (
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" name="isActive" defaultChecked={values.isActive} className="size-4 accent-primary" />
          <span>{t("form.isActive")}</span>
        </label>
      )}
    </>
  );
}

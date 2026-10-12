"use client";

import { useTranslations } from "next-intl";
import { Field, SelectField, TextField } from "@/components/form-field";
import { CurrencySelect } from "@/components/currency-select";
import { SelectItem } from "@/components/ui/select";
import { textareaClass } from "@/app/dashboard/vendor-billing/shared";

export type AccountOption = { id: number; name: string; currency: string };

export type PartyFormValues = {
  name: string;
  label: string;
  taxId: string | null;
  defaultCurrency: string | null;
  defaultAccountId: number | null;
  typicalAmount: string | null;
  contact: string | null;
  note: string | null;
  aliases: string[];
  isActive: boolean;
};

/** 新增與編輯共用的交易對象欄位群。沒有 values 就是新增模式。 */
export function PartyFields({
  accounts,
  values,
}: Readonly<{
  accounts: AccountOption[];
  values?: PartyFormValues;
}>) {
  const t = useTranslations("parties");

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
      <SelectField name="label" label={t("form.type")} defaultValue={values?.label ?? "vendor"}>
        <SelectItem value="vendor">{t("label.vendor")}</SelectItem>
        <SelectItem value="customer">{t("label.customer")}</SelectItem>
        <SelectItem value="gov">{t("label.gov")}</SelectItem>
        <SelectItem value="other">{t("label.other")}</SelectItem>
      </SelectField>
      <TextField
        name="taxId"
        label={t("form.taxId")}
        placeholder={t("form.taxIdPlaceholder")}
        defaultValue={values?.taxId ?? ""}
      />
      <Field label={t("form.defaultCurrency")}>
        <CurrencySelect name="defaultCurrency" defaultValue={values?.defaultCurrency ?? undefined} />
      </Field>
      <SelectField
        name="defaultAccountId"
        label={t("form.defaultAccount")}
        placeholder={t("form.defaultAccountPlaceholder")}
        defaultValue={values?.defaultAccountId == null ? undefined : String(values.defaultAccountId)}
      >
        {accounts.map((a) => (
          <SelectItem key={a.id} value={String(a.id)}>
            {t("accountOption", { name: a.name, currency: a.currency })}
          </SelectItem>
        ))}
      </SelectField>
      <TextField
        name="typicalAmount"
        label={t("form.typicalAmount")}
        type="number"
        step="0.01"
        placeholder={t("form.typicalAmountPlaceholder")}
        defaultValue={values?.typicalAmount ?? ""}
      />
      <TextField
        name="contact"
        label={t("form.contact")}
        wide
        placeholder={t("form.contactPlaceholder")}
        defaultValue={values?.contact ?? ""}
      />
      <TextField
        name="note"
        label={t("form.note")}
        wide
        placeholder={t("form.notePlaceholder")}
        defaultValue={values?.note ?? ""}
      />
      {/* 別名：一行一個。匯入（Wise 等）時名稱或別名對得上就歸到這個對象，見 src/lib/party-aliases.ts。 */}
      <Field label={t("form.aliases")} htmlFor="aliases" wide>
        <textarea
          id="aliases"
          name="aliases"
          rows={3}
          placeholder={t("form.aliasesPlaceholder")}
          defaultValue={values?.aliases.join("\n") ?? ""}
          className={textareaClass}
        />
        <p className="text-xs text-muted-foreground">{t("form.aliasesHint")}</p>
      </Field>
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

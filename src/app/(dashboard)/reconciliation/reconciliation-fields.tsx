"use client";

import { useTranslations } from "next-intl";
import { Field, SelectField, TextField } from "@/components/form-field";
import { DatePicker } from "@/components/date-picker";
import { SelectItem } from "@/components/ui/select";

export type AccountOption = { id: number; name: string; currency: string };

export type ReconciliationFormValues = {
  accountId: number;
  asOfDate: string;
  statementBalance: string;
  note: string | null;
};

/**
 * 新增與編輯共用的對帳欄位群。沒有 values 就是新增模式。
 *
 * 新增走單欄格線、編輯走兩欄，所以整列的 sm:col-span-2 只在編輯時掛上。
 */
export function ReconciliationFields({
  accounts,
  values,
}: Readonly<{
  accounts: AccountOption[];
  values?: ReconciliationFormValues;
}>) {
  const t = useTranslations("reconciliation");
  const today = new Date().toISOString().slice(0, 10);

  return (
    <>
      <SelectField
        name="accountId"
        label={t("form.account")}
        required
        wide={values != null}
        placeholder={t("form.accountPlaceholder")}
        defaultValue={values == null ? undefined : String(values.accountId)}
      >
        {accounts.map((a) => (
          <SelectItem key={a.id} value={String(a.id)}>
            {t("accountOption", { name: a.name, currency: a.currency })}
          </SelectItem>
        ))}
      </SelectField>
      <Field label={t("form.asOfDate")} required>
        <DatePicker name="asOfDate" defaultValue={values?.asOfDate ?? today} />
      </Field>
      <TextField
        name="statementBalance"
        label={t("form.statementBalance")}
        required
        type="number"
        step="0.01"
        placeholder={t("form.statementBalancePlaceholder")}
        defaultValue={values?.statementBalance}
      />
      <TextField
        name="note"
        label={t("form.note")}
        wide={values != null}
        placeholder={t("form.notePlaceholder")}
        defaultValue={values?.note ?? ""}
      />
    </>
  );
}

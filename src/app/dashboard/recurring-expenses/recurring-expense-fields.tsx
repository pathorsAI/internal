"use client";

import { useTranslations } from "next-intl";
import { Field, SelectField, TextField } from "@/components/form-field";
import { DatePicker } from "@/components/date-picker";
import { CurrencySelect } from "@/components/currency-select";
import { PartyField } from "@/components/party-combobox";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export type Option = { id: number; name: string };

/** 付款方式選項：label 例如「MasterCard •1234」，accountName = 卡費最後從哪個帳本帳戶扣。 */
export type PaymentMethodOption = { id: number; label: string; accountName: string | null; isActive: boolean };

export type RecurringExpenseFormValues = {
  name: string;
  /** 目前綁定的廠商名稱，給 PartyCombobox 預填 */
  partyName: string | null;
  matchPattern: string | null;
  paymentMethodId: number | null;
  schedule: string;
  anchorDate: string | null;
  intervalMonths: number;
  expectedAmount: string | null;
  currency: string | null;
  billingUrl: string | null;
  isActive: boolean;
  note: string | null;
};

/** 新增與編輯共用的固定支出欄位群。沒有 values 就是新增模式。 */
export function RecurringExpenseFields({
  parties,
  paymentMethods,
  values,
}: Readonly<{
  parties: Option[];
  paymentMethods: PaymentMethodOption[];
  values?: RecurringExpenseFormValues;
}>) {
  const t = useTranslations("recurringExpenses");
  // 停用的付款方式不給新選，但目前已經選的那個要留著，不然打開編輯再存會被清掉。
  const selectable = paymentMethods.filter((m) => m.isActive || m.id === values?.paymentMethodId);

  return (
    <>
      <TextField
        name="name"
        label={t("form.name.label")}
        required
        placeholder={t("form.name.placeholder")}
        defaultValue={values?.name}
      />
      <PartyField
        parties={parties}
        name="partyName"
        label={t("form.party")}
        defaultName={values?.partyName ?? ""}
      />
      <Field label={t("form.matchPattern.label")} htmlFor="matchPattern" wide>
        <Input
          id="matchPattern"
          name="matchPattern"
          placeholder={t("form.matchPattern.placeholder")}
          defaultValue={values?.matchPattern ?? ""}
        />
        <p className="text-xs text-muted-foreground">{t("form.matchPattern.help")}</p>
      </Field>
      <Field label={t("form.paymentMethod.label")} wide>
        <Select
          name="paymentMethodId"
          defaultValue={values?.paymentMethodId == null ? "none" : String(values.paymentMethodId)}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {/* Radix Select 不接受空字串，「不指定」用 "none"（mutations 那側轉回 null）。 */}
            <SelectItem value="none">{t("form.paymentMethod.none")}</SelectItem>
            {selectable.map((m) => (
              <SelectItem key={m.id} value={String(m.id)}>
                {m.label}
                {m.accountName ? `（${m.accountName}）` : ""}
                {m.isActive ? "" : t("form.paymentMethod.inactive")}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">{t("form.paymentMethod.help")}</p>
      </Field>
      <SelectField name="schedule" label={t("form.schedule")} defaultValue={values?.schedule ?? "fixed"}>
        <SelectItem value="fixed">{t("schedule.fixed")}</SelectItem>
        <SelectItem value="usage">{t("schedule.usage")}</SelectItem>
      </SelectField>
      <TextField
        name="intervalMonths"
        label={t("form.intervalMonths")}
        type="number"
        min="1"
        max="36"
        defaultValue={values?.intervalMonths ?? 1}
      />
      <Field label={t("form.anchorDate.label")} wide>
        <DatePicker name="anchorDate" allowEmpty defaultValue={values?.anchorDate ?? undefined} />
        <p className="text-xs text-muted-foreground">{t("form.anchorDate.help")}</p>
      </Field>
      <TextField
        name="expectedAmount"
        label={t("form.expectedAmount")}
        type="number"
        step="0.01"
        defaultValue={values?.expectedAmount ?? ""}
      />
      <Field label={t("form.currency")}>
        <CurrencySelect defaultValue={values?.currency ?? undefined} />
      </Field>
      <TextField
        name="billingUrl"
        label={t("form.billingUrl.label")}
        type="url"
        wide
        placeholder={t("form.billingUrl.placeholder")}
        defaultValue={values?.billingUrl ?? ""}
      />
      <SelectField
        name="isActive"
        label={t("form.status")}
        defaultValue={values?.isActive === false ? "inactive" : "active"}
      >
        <SelectItem value="active">{t("status.active")}</SelectItem>
        <SelectItem value="inactive">{t("status.inactive")}</SelectItem>
      </SelectField>
      <TextField
        name="note"
        label={t("form.note.label")}
        placeholder={t("form.note.placeholder")}
        defaultValue={values?.note ?? ""}
      />
    </>
  );
}

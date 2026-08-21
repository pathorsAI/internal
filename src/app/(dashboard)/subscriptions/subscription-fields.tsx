"use client";

import { useTranslations } from "next-intl";
import { Field, SelectField, TextField } from "@/components/form-field";
import { DatePicker } from "@/components/date-picker";
import { CurrencySelect } from "@/components/currency-select";
import { PartyField } from "@/components/party-combobox";
import { SelectItem } from "@/components/ui/select";

export type Option = { id: number; name: string };

export type SubscriptionFormValues = {
  customerPartyId: number;
  /** 目前綁定的客戶名稱，給 PartyCombobox 預填 */
  customerName: string | null;
  projectId: number | null;
  name: string;
  amount: string;
  currency: string;
  intervalMonths: number;
  startDate: string;
  endDate: string | null;
  status: string;
  note: string | null;
};

/**
 * 新增與編輯共用的訂閱欄位群。沒有 values 就是新增模式。
 *
 * 標籤一律走 newDialog.* —— editForm.* 的同名項目字串完全一樣，
 * 但只有 newDialog.* 那組帶得出 placeholder。
 */
export function SubscriptionFields({
  parties,
  projects,
  values,
}: Readonly<{
  parties: Option[];
  projects: Option[];
  values?: SubscriptionFormValues;
}>) {
  const t = useTranslations("subscriptions");

  return (
    <>
      <PartyField
        parties={parties}
        name="customerPartyName"
        required
        defaultName={values?.customerName ?? ""}
      />
      <SelectField
        name="projectId"
        label={t("newDialog.project.label")}
        placeholder={t("newDialog.project.placeholder")}
        defaultValue={values?.projectId == null ? undefined : String(values.projectId)}
      >
        {projects.map((p) => (
          <SelectItem key={p.id} value={String(p.id)}>
            {p.name}
          </SelectItem>
        ))}
      </SelectField>
      <TextField
        name="name"
        label={t("newDialog.name.label")}
        required
        wide
        placeholder={t("newDialog.name.placeholder")}
        defaultValue={values?.name}
      />
      <TextField
        name="amount"
        label={t("newDialog.amount")}
        required
        type="number"
        step="0.01"
        defaultValue={values?.amount}
      />
      <Field label={t("newDialog.currency")}>
        <CurrencySelect defaultValue={values?.currency} />
      </Field>
      <TextField
        name="intervalMonths"
        label={t("newDialog.intervalMonths")}
        type="number"
        min="1"
        defaultValue={values?.intervalMonths ?? 1}
      />
      <SelectField
        name="status"
        label={t("newDialog.status")}
        defaultValue={values?.status ?? "active"}
      >
        <SelectItem value="active">{t("status.active")}</SelectItem>
        <SelectItem value="paused">{t("status.paused")}</SelectItem>
        <SelectItem value="ended">{t("status.ended")}</SelectItem>
      </SelectField>
      <Field label={t("newDialog.startDate")} required>
        <DatePicker name="startDate" defaultValue={values?.startDate} />
      </Field>
      <Field label={t("newDialog.endDate")}>
        <DatePicker
          name="endDate"
          allowEmpty
          placeholder={t("newDialog.datePlaceholderNone")}
          defaultValue={values?.endDate ?? undefined}
        />
      </Field>
      <TextField
        name="note"
        label={t("newDialog.note.label")}
        wide
        placeholder={t("newDialog.note.placeholder")}
        defaultValue={values?.note ?? ""}
      />
    </>
  );
}

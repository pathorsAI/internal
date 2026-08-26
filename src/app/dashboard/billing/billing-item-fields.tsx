"use client";

import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Field, SelectField } from "@/components/form-field";
import { DatePicker } from "@/components/date-picker";
import { CurrencySelect } from "@/components/currency-select";
import { PartyField } from "@/components/party-combobox";
import { SelectItem } from "@/components/ui/select";

export type Option = { id: number; name: string };

export type BillingItemFormValues = {
  customerPartyId: number | null;
  /** 目前綁定的客戶名稱，給 PartyCombobox 預填 */
  customerName: string | null;
  contractId: number | null;
  projectId: number | null;
  title: string;
  amount: string;
  currency: string;
  dueDate: string | null;
  billedOn: string | null;
  paidOn: string | null;
  invoicedOn: string | null;
  needsInvoice: boolean;
  status: string;
  note: string | null;
};

/**
 * 新增與編輯共用的欄位群。兩張表單的差異只有 action 與按鈕，
 * 欄位一份就好，避免兩邊漂移。
 */
export function BillingItemFields({
  parties,
  contracts,
  projects,
  values,
  hideContract = false,
}: Readonly<{
  parties: Option[];
  contracts: Option[];
  projects: Option[];
  values?: BillingItemFormValues;
  /** 從合約頁開啟時合約已固定，改用 hidden input 帶值，這裡就不再渲染下拉。 */
  hideContract?: boolean;
}>) {
  const t = useTranslations("billing");

  return (
    <>
      <PartyField
        parties={parties}
        name="customerPartyName"
        required
        defaultName={values?.customerName ?? ""}
      />

      <Field label={t("form.fields.title")} htmlFor="bi-title" required>
        <Input
          id="bi-title"
          name="title"
          required
          placeholder={t("form.fields.titlePlaceholder")}
          defaultValue={values?.title}
        />
      </Field>

      {!hideContract && (
        <SelectField
          name="contractId"
          label={t("form.fields.contract")}
          placeholder={t("common.unspecified")}
          defaultValue={values?.contractId == null ? undefined : String(values.contractId)}
        >
          {contracts.map((c) => (
            <SelectItem key={c.id} value={String(c.id)}>
              {c.name}
            </SelectItem>
          ))}
        </SelectField>
      )}

      <SelectField
        name="projectId"
        label={t("form.fields.project")}
        placeholder={t("common.unspecified")}
        defaultValue={values?.projectId == null ? undefined : String(values.projectId)}
      >
        {projects.map((p) => (
          <SelectItem key={p.id} value={String(p.id)}>
            {p.name}
          </SelectItem>
        ))}
      </SelectField>

      <Field label={t("form.fields.amount")} htmlFor="bi-amount" required>
        <Input
          id="bi-amount"
          name="amount"
          type="number"
          step="0.01"
          required
          defaultValue={values?.amount}
        />
      </Field>
      <Field label={t("form.fields.currency")}>
        <CurrencySelect defaultValue={values?.currency} />
      </Field>

      <Field label={t("form.fields.dueDate")}>
        <DatePicker
          name="dueDate"
          allowEmpty
          placeholder={t("form.fields.dueDatePlaceholder")}
          defaultValue={values?.dueDate ?? undefined}
        />
      </Field>
      <SelectField name="status" label={t("form.fields.status")} defaultValue={values?.status ?? "scheduled"}>
        <SelectItem value="scheduled">{t("form.rawStatus.scheduled")}</SelectItem>
        <SelectItem value="billed">{t("form.rawStatus.billed")}</SelectItem>
        <SelectItem value="paid">{t("form.rawStatus.paid")}</SelectItem>
        <SelectItem value="cancelled">{t("form.rawStatus.cancelled")}</SelectItem>
      </SelectField>

      <Field label={t("form.fields.billedOn")}>
        <DatePicker
          name="billedOn"
          allowEmpty
          placeholder={t("form.fields.billedOnPlaceholder")}
          defaultValue={values?.billedOn ?? undefined}
        />
      </Field>
      <Field label={t("form.fields.paidOn")}>
        <DatePicker
          name="paidOn"
          allowEmpty
          placeholder={t("form.fields.paidOnPlaceholder")}
          defaultValue={values?.paidOn ?? undefined}
        />
      </Field>
      <Field label={t("form.fields.invoicedOn")}>
        <DatePicker
          name="invoicedOn"
          allowEmpty
          placeholder={t("form.fields.invoicedOnPlaceholder")}
          defaultValue={values?.invoicedOn ?? undefined}
        />
      </Field>
      <div className="flex items-end pb-2">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="needsInvoice"
            defaultChecked={values?.needsInvoice ?? true}
            className="size-4 accent-primary"
          />
          {t("form.fields.needsInvoice")}
        </label>
      </div>

      <Field label={t("form.fields.note")} htmlFor="bi-note" wide>
        <Input
          id="bi-note"
          name="note"
          placeholder={t("common.optional")}
          defaultValue={values?.note ?? ""}
        />
      </Field>

      <p className="text-xs text-muted-foreground sm:col-span-2">{t("form.paidOnHint")}</p>
    </>
  );
}

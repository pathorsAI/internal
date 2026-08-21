"use client";

import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Field, SelectField } from "@/components/form-field";
import { DatePicker } from "@/components/date-picker";
import { CurrencySelect } from "@/components/currency-select";
import { PartyField } from "@/components/party-combobox";
import { SelectItem } from "@/components/ui/select";

export type Option = { id: number; name: string };

export type InvoiceFormValues = {
  direction: string;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  partyId: number | null;
  /** 目前綁定的對象名稱，給 PartyCombobox 預填 */
  partyName: string | null;
  counterpartyName: string | null;
  counterpartyTaxId: string | null;
  amountNet: string | null;
  tax: string | null;
  amountGross: string | null;
  currency: string;
  status: string;
  note: string | null;
  contractId: number | null;
  billingItemId: number | null;
  externalStatus?: string | null;
};

/** 新增與編輯共用的發票欄位群。 */
export function InvoiceFields({
  parties,
  contracts,
  billingItems,
  values,
}: Readonly<{
  parties: Option[];
  contracts: Option[];
  billingItems: Option[];
  values?: InvoiceFormValues;
}>) {
  const t = useTranslations("invoices");

  // Simpany（外部發票系統）的開立狀態。本系統不開票，只追這一欄。
  const EXTERNAL_STATUS_OPTIONS = [
    { value: "pending", label: t("externalStatus.pending") },
    { value: "issued", label: t("externalStatus.issued") },
    { value: "void", label: t("externalStatus.void") },
    { value: "n_a", label: t("externalStatus.n_a") },
  ];

  return (
    <>
      <SelectField name="direction" label={t("fields.type")} defaultValue={values?.direction ?? "issued"}>
        <SelectItem value="issued">{t("direction.issued")}</SelectItem>
        <SelectItem value="received">{t("direction.received")}</SelectItem>
      </SelectField>
      <Field label={t("fields.invoiceDate")} required>
        <DatePicker name="invoiceDate" defaultValue={values?.invoiceDate ?? undefined} />
      </Field>

      <PartyField
        parties={parties}
        name="partyName"
        label={t("fields.counterparty")}
        defaultName={values?.partyName ?? ""}
      />
      <Field label={t("fields.invoiceNumber")} htmlFor="inv-number">
        <Input
          id="inv-number"
          name="invoiceNumber"
          placeholder={t("fields.invoiceNumberPlaceholder")}
          defaultValue={values?.invoiceNumber ?? ""}
        />
      </Field>

      <SelectField
        name="externalStatus"
        label={t("fields.externalStatus")}
        defaultValue={values?.externalStatus ?? "pending"}
      >
        {EXTERNAL_STATUS_OPTIONS.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectField>

      <SelectField
        name="billingItemId"
        label={t("fields.billingItem")}
        placeholder={t("fields.billingItemPlaceholder")}
        defaultValue={values?.billingItemId == null ? undefined : String(values.billingItemId)}
      >
        {billingItems.map((b) => (
          <SelectItem key={b.id} value={String(b.id)}>
            {b.name}
          </SelectItem>
        ))}
      </SelectField>
      <SelectField
        name="contractId"
        label={t("fields.contract")}
        placeholder={t("fields.contractPlaceholder")}
        defaultValue={values?.contractId == null ? undefined : String(values.contractId)}
      >
        {contracts.map((c) => (
          <SelectItem key={c.id} value={String(c.id)}>
            {c.name}
          </SelectItem>
        ))}
      </SelectField>

      <Field label={t("fields.amountNet")} htmlFor="inv-net">
        <Input
          id="inv-net"
          name="amountNet"
          type="number"
          step="0.01"
          defaultValue={values?.amountNet ?? ""}
        />
      </Field>
      <Field label={t("fields.tax")} htmlFor="inv-tax">
        <Input
          id="inv-tax"
          name="tax"
          type="number"
          step="0.01"
          defaultValue={values?.tax ?? ""}
        />
      </Field>
      <Field label={t("fields.amountGross")} htmlFor="inv-gross">
        <Input
          id="inv-gross"
          name="amountGross"
          type="number"
          step="0.01"
          defaultValue={values?.amountGross ?? ""}
        />
      </Field>
      <Field label={t("fields.currency")}>
        <CurrencySelect defaultValue={values?.currency} />
      </Field>

      <SelectField name="status" label={t("fields.status")} defaultValue={values?.status ?? "valid"}>
        <SelectItem value="valid">{t("status.valid")}</SelectItem>
        <SelectItem value="void">{t("status.void")}</SelectItem>
        <SelectItem value="allowance">{t("status.allowance")}</SelectItem>
      </SelectField>
      <Field label={t("fields.counterpartyTaxId")} htmlFor="inv-taxid">
        <Input
          id="inv-taxid"
          name="counterpartyTaxId"
          placeholder={t("fields.counterpartyTaxIdPlaceholder")}
          defaultValue={values?.counterpartyTaxId ?? ""}
        />
      </Field>

      <Field label={t("fields.counterpartyName")} htmlFor="inv-name" wide>
        <Input
          id="inv-name"
          name="counterpartyName"
          placeholder={t("fields.counterpartyNamePlaceholder")}
          defaultValue={values?.counterpartyName ?? ""}
        />
      </Field>
      <Field label={t("fields.note")} htmlFor="inv-note" wide>
        <Input
          id="inv-note"
          name="note"
          placeholder={t("fields.notePlaceholder")}
          defaultValue={values?.note ?? ""}
        />
      </Field>
    </>
  );
}

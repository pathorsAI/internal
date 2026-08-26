"use client";

import { useTranslations } from "next-intl";
import { updateInvoice } from "@/db/mutations";
import { EditForm } from "@/components/edit-form";
import { InvoiceFields, type InvoiceFormValues, type Option } from "./invoice-fields";

export function EditInvoiceForm({
  id,
  values,
  parties,
  contracts,
  billingItems,
  footer,
}: Readonly<{
  id: number;
  values: InvoiceFormValues;
  parties: Option[];
  contracts: Option[];
  billingItems: Option[];
  footer?: React.ReactNode;
}>) {
  const t = useTranslations("invoices");

  return (
    <EditForm
      action={updateInvoice}
      successMessage={t("toast.updated")}
      cancelLabel={t("edit.cancel")}
      submitLabel={t("edit.submit")}
      submittingLabel={t("edit.submitting")}
      footer={footer}
    >
      <input type="hidden" name="id" value={id} />
      <InvoiceFields
        parties={parties}
        contracts={contracts}
        billingItems={billingItems}
        values={values}
      />
    </EditForm>
  );
}

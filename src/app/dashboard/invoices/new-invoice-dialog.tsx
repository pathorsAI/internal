"use client";

import { useTranslations } from "next-intl";
import { createInvoice } from "@/db/mutations";
import { CreateDialog } from "@/components/create-dialog";
import { InvoiceFields, type Option } from "./invoice-fields";

export function NewInvoiceDialog({
  parties,
  contracts,
  billingItems,
}: Readonly<{ parties: Option[]; contracts: Option[]; billingItems: Option[] }>) {
  const t = useTranslations("invoices");

  return (
    <CreateDialog
      action={createInvoice}
      trigger={t("new.trigger")}
      title={t("new.dialogTitle")}
      description={t("new.dialogDescription")}
      successMessage={t("toast.created")}
      submitLabel={t("new.submit")}
      submittingLabel={t("new.submitting")}
      className="max-h-[85vh] overflow-y-auto sm:max-w-2xl"
    >
      <InvoiceFields parties={parties} contracts={contracts} billingItems={billingItems} />
    </CreateDialog>
  );
}

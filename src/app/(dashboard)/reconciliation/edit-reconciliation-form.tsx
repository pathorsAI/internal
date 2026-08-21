"use client";

import { useTranslations } from "next-intl";
import { updateReconciliation } from "@/db/mutations";
import { EditForm } from "@/components/edit-form";
import {
  ReconciliationFields,
  type AccountOption,
  type ReconciliationFormValues,
} from "./reconciliation-fields";

type Recon = ReconciliationFormValues & { id: number };

export function EditReconciliationForm({
  recon,
  accounts,
  footer,
}: Readonly<{
  recon: Recon;
  accounts: AccountOption[];
  footer?: React.ReactNode;
}>) {
  const t = useTranslations("reconciliation");

  return (
    <EditForm
      action={updateReconciliation}
      successMessage={t("toast.updated")}
      cancelLabel={t("form.cancel")}
      submitLabel={t("form.saveChanges")}
      submittingLabel={t("form.saving")}
      footer={footer}
    >
      <input type="hidden" name="id" value={recon.id} />
      <ReconciliationFields accounts={accounts} values={recon} />
    </EditForm>
  );
}

"use client";

import { useTranslations } from "next-intl";
import { createReconciliation } from "@/db/mutations";
import { CreateDialog } from "@/components/create-dialog";
import { ReconciliationFields, type AccountOption } from "./reconciliation-fields";

export function NewReconciliationDialog({
  accounts,
}: Readonly<{
  accounts: AccountOption[];
}>) {
  const t = useTranslations("reconciliation");

  return (
    <CreateDialog
      action={createReconciliation}
      trigger={t("new.trigger")}
      title={t("new.title")}
      description={t("new.description")}
      successMessage={t("toast.created")}
      submitLabel={t("form.save")}
      submittingLabel={t("form.saving")}
      // 這張表單是單欄的，不套預設的兩欄格線。
      gridClassName="grid gap-4 py-4"
    >
      <ReconciliationFields accounts={accounts} />
    </CreateDialog>
  );
}

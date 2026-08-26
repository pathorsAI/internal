"use client";

import { useTranslations } from "next-intl";
import { createBankAccount } from "@/db/mutations";
import { CreateDialog } from "@/components/create-dialog";
import { BankAccountFields } from "./bank-account-fields";

export function NewBankAccountDialog() {
  const t = useTranslations("bankAccounts");

  return (
    <CreateDialog
      action={createBankAccount}
      trigger={t("new.trigger")}
      title={t("new.title")}
      description={t("new.description")}
      successMessage={t("toast.created")}
      submitLabel={t("form.save")}
      submittingLabel={t("form.saving")}
    >
      <BankAccountFields />
    </CreateDialog>
  );
}

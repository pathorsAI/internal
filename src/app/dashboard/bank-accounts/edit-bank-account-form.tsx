"use client";

import { useTranslations } from "next-intl";
import { updateBankAccount } from "@/db/mutations";
import { EditForm } from "@/components/edit-form";
import { BankAccountFields, type BankAccountFormValues } from "./bank-account-fields";

type Account = BankAccountFormValues & { id: number };

export function EditBankAccountForm({
  account,
  footer,
}: Readonly<{
  account: Account;
  footer?: React.ReactNode;
}>) {
  const t = useTranslations("bankAccounts");

  return (
    <EditForm
      action={updateBankAccount}
      successMessage={t("toast.updated")}
      cancelLabel={t("form.cancel")}
      submitLabel={t("form.saveChanges")}
      submittingLabel={t("form.saving")}
      footer={footer}
    >
      <input type="hidden" name="id" value={account.id} />
      <BankAccountFields values={account} />
    </EditForm>
  );
}

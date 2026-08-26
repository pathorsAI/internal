"use client";

import { useTranslations } from "next-intl";
import { createParty } from "@/db/mutations";
import { CreateDialog } from "@/components/create-dialog";
import { PartyFields, type AccountOption } from "./party-fields";

export function NewPartyDialog({
  accounts,
}: Readonly<{
  accounts: AccountOption[];
}>) {
  const t = useTranslations("parties");

  return (
    <CreateDialog
      action={createParty}
      trigger={t("new.trigger")}
      title={t("new.title")}
      description={t("new.description")}
      successMessage={t("toast.created")}
      submitLabel={t("form.save")}
      submittingLabel={t("form.saving")}
      className="sm:max-w-lg max-h-[85vh] overflow-y-auto"
    >
      <PartyFields accounts={accounts} />
    </CreateDialog>
  );
}

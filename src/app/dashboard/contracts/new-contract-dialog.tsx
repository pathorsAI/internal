"use client";

import { useTranslations } from "next-intl";
import { createContract } from "@/db/mutations";
import { CreateDialog } from "@/components/create-dialog";
import { ContractFields, type Option } from "./contract-fields";

export function NewContractDialog({
  parties,
  projects,
}: Readonly<{
  parties: Option[];
  projects: Option[];
}>) {
  const t = useTranslations("contracts");

  return (
    <CreateDialog
      action={createContract}
      trigger={t("newDialog.trigger")}
      title={t("newDialog.title")}
      description={t("newDialog.description")}
      successMessage={t("newDialog.toast.added")}
      submitLabel={t("newDialog.submit")}
      submittingLabel={t("newDialog.submitting")}
      className="max-h-[85vh] overflow-y-auto sm:max-w-lg"
    >
      <ContractFields parties={parties} projects={projects} />
    </CreateDialog>
  );
}

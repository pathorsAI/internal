"use client";

import { useTranslations } from "next-intl";
import { createProject } from "@/db/mutations";
import { CreateDialog } from "@/components/create-dialog";
import { ProjectFields, type PartyOption } from "./project-fields";

export function NewProjectDialog({
  parties,
}: Readonly<{
  parties: PartyOption[];
}>) {
  const t = useTranslations("projects");

  return (
    <CreateDialog
      action={createProject}
      trigger={t("newDialog.trigger")}
      title={t("newDialog.title")}
      description={t("newDialog.description")}
      successMessage={t("newDialog.toast.added")}
      submitLabel={t("newDialog.submit")}
      submittingLabel={t("newDialog.submitting")}
      className="sm:max-w-lg"
    >
      <ProjectFields parties={parties} />
    </CreateDialog>
  );
}

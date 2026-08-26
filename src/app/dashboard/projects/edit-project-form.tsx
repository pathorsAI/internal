"use client";

import { useTranslations } from "next-intl";
import { updateProject } from "@/db/mutations";
import { EditForm } from "@/components/edit-form";
import { ProjectFields, type PartyOption, type ProjectFormValues } from "./project-fields";

type Project = ProjectFormValues & { id: number };

export function EditProjectForm({
  project,
  parties,
  footer,
}: Readonly<{
  project: Project;
  parties: PartyOption[];
  footer?: React.ReactNode;
}>) {
  const t = useTranslations("projects");

  return (
    <EditForm
      action={updateProject}
      successMessage={t("editForm.toast.updated")}
      cancelLabel={t("editForm.cancel")}
      submitLabel={t("editForm.submit")}
      submittingLabel={t("editForm.submitting")}
      footer={footer}
    >
      <input type="hidden" name="id" value={project.id} />
      <ProjectFields parties={parties} values={project} />
    </EditForm>
  );
}

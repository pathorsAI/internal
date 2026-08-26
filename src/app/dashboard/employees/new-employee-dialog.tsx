"use client";

import { useTranslations } from "next-intl";
import { createEmployee } from "@/db/mutations";
import { CreateDialog } from "@/components/create-dialog";
import { EmployeeFields, type MemberOption } from "./employee-fields";

export function NewEmployeeDialog({ members }: Readonly<{ members: MemberOption[] }>) {
  const t = useTranslations("employees");

  return (
    <CreateDialog
      action={createEmployee}
      trigger={t("new.trigger")}
      title={t("new.title")}
      description={t("new.description")}
      successMessage={t("toast.created")}
      submitLabel={t("form.save")}
      submittingLabel={t("form.saving")}
      className="sm:max-w-lg"
    >
      <EmployeeFields members={members} />
    </CreateDialog>
  );
}

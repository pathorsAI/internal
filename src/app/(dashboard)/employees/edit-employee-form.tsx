"use client";

import { useTranslations } from "next-intl";
import { updateEmployee } from "@/db/mutations";
import { EditForm } from "@/components/edit-form";
import {
  EmployeeFields,
  type EmployeeFormValues,
  type MemberOption,
} from "./employee-fields";

export type { MemberOption };

type Employee = EmployeeFormValues & { id: number };

export function EditEmployeeForm({
  employee,
  members,
  footer,
}: Readonly<{
  employee: Employee;
  members: MemberOption[];
  footer?: React.ReactNode;
}>) {
  const t = useTranslations("employees");

  return (
    <EditForm
      action={updateEmployee}
      successMessage={t("toast.updated")}
      cancelLabel={t("form.cancel")}
      submitLabel={t("form.saveChanges")}
      submittingLabel={t("form.saving")}
      footer={footer}
    >
      <input type="hidden" name="id" value={employee.id} />
      <EmployeeFields members={members} values={employee} />
    </EditForm>
  );
}

"use client";

import { useTranslations } from "next-intl";
import { updateEmployee } from "@/db/mutations";
import { EditForm } from "@/components/edit-form";
import {
  EmployeeFields,
  type EmployeeFormValues,
  type MemberOption,
} from "./employee-fields";
import { EmployeeAccountsSection } from "./employee-accounts-section";
import type { MaskedEmployeeAccount } from "@/lib/employee-accounts";

export type { MemberOption } from "./employee-fields";

type Employee = EmployeeFormValues & { id: number };

export function EditEmployeeForm({
  employee,
  members,
  accounts,
  legacySalaryAccount,
  canManage,
  footer,
}: Readonly<{
  employee: Employee;
  members: MemberOption[];
  /** 這位員工的收款帳戶（遮罩後） */
  accounts: MaskedEmployeeAccount[];
  /** 舊 salary_account（遮罩後），沒有就是 null */
  legacySalaryAccount: string | null;
  /** owner / admin 才能改；成員看到的是唯讀表單 */
  canManage: boolean;
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
      readOnly={!canManage}
    >
      <input type="hidden" name="id" value={employee.id} />
      <EmployeeFields
        members={members}
        values={employee}
        accountsSection={
          <EmployeeAccountsSection
            employeeId={employee.id}
            employeeName={employee.name}
            accounts={accounts}
            canManage={canManage}
            legacySalaryAccount={legacySalaryAccount}
          />
        }
      />
    </EditForm>
  );
}

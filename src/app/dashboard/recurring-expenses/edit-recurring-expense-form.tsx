"use client";

import { useTranslations } from "next-intl";
import { updateRecurringExpense } from "@/db/mutations";
import { EditForm } from "@/components/edit-form";
import {
  RecurringExpenseFields,
  type Option,
  type PaymentMethodOption,
  type RecurringExpenseFormValues,
} from "./recurring-expense-fields";

export function EditRecurringExpenseForm({
  expense,
  parties,
  paymentMethods,
  footer,
}: Readonly<{
  expense: RecurringExpenseFormValues & { id: number };
  parties: Option[];
  paymentMethods: PaymentMethodOption[];
  footer?: React.ReactNode;
}>) {
  const t = useTranslations("recurringExpenses");

  return (
    <EditForm
      action={updateRecurringExpense}
      successMessage={t("form.toast.updated")}
      cancelLabel={t("form.cancel")}
      submitLabel={t("form.saveChanges")}
      submittingLabel={t("form.submitting")}
      footer={footer}
    >
      <input type="hidden" name="id" value={expense.id} />
      <RecurringExpenseFields parties={parties} paymentMethods={paymentMethods} values={expense} />
    </EditForm>
  );
}

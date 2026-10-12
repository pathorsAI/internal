"use client";

import { useTranslations } from "next-intl";
import { createRecurringExpense } from "@/db/mutations";
import { CreateDialog } from "@/components/create-dialog";
import { RecurringExpenseFields, type Option, type PaymentMethodOption } from "./recurring-expense-fields";

export function NewRecurringExpenseDialog({
  parties,
  paymentMethods,
}: Readonly<{ parties: Option[]; paymentMethods: PaymentMethodOption[] }>) {
  const t = useTranslations("recurringExpenses");

  return (
    <CreateDialog
      action={createRecurringExpense}
      trigger={t("form.trigger")}
      title={t("form.title")}
      description={t("form.description")}
      successMessage={t("form.toast.added")}
      submitLabel={t("form.submit")}
      submittingLabel={t("form.submitting")}
      className="sm:max-w-lg max-h-[85vh] overflow-y-auto"
    >
      <RecurringExpenseFields parties={parties} paymentMethods={paymentMethods} />
    </CreateDialog>
  );
}

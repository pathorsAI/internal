"use client";

import { useTranslations } from "next-intl";
import { updateBillingItem } from "@/db/mutations";
import { EditForm } from "@/components/edit-form";
import {
  BillingItemFields,
  type BillingItemFormValues,
  type Option,
} from "./billing-item-fields";

export function EditBillingItemForm({
  id,
  values,
  parties,
  contracts,
  projects,
  footer,
}: Readonly<{
  id: number;
  values: BillingItemFormValues;
  parties: Option[];
  contracts: Option[];
  projects: Option[];
  footer?: React.ReactNode;
}>) {
  const t = useTranslations("billing");

  return (
    <EditForm
      action={updateBillingItem}
      successMessage={t("editItem.toast.updated")}
      cancelLabel={t("common.cancel")}
      submitLabel={t("editItem.saveChanges")}
      submittingLabel={t("common.saving")}
      footer={footer}
    >
      <input type="hidden" name="id" value={id} />
      <BillingItemFields
        parties={parties}
        contracts={contracts}
        projects={projects}
        values={values}
      />
    </EditForm>
  );
}

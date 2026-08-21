"use client";

import { useTranslations } from "next-intl";
import { updateSubscription } from "@/db/mutations";
import { EditForm } from "@/components/edit-form";
import {
  SubscriptionFields,
  type Option,
  type SubscriptionFormValues,
} from "./subscription-fields";

type Subscription = SubscriptionFormValues & { id: number };

export function EditSubscriptionForm({
  subscription,
  parties,
  projects,
  footer,
}: Readonly<{
  subscription: Subscription;
  parties: Option[];
  projects: Option[];
  footer?: React.ReactNode;
}>) {
  const t = useTranslations("subscriptions");

  return (
    <EditForm
      action={updateSubscription}
      successMessage={t("editForm.toast.updated")}
      cancelLabel={t("editForm.cancel")}
      submitLabel={t("editForm.submit")}
      submittingLabel={t("editForm.submitting")}
      footer={footer}
    >
      <input type="hidden" name="id" value={subscription.id} />
      <SubscriptionFields parties={parties} projects={projects} values={subscription} />
    </EditForm>
  );
}

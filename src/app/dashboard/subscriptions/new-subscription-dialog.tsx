"use client";

import { useTranslations } from "next-intl";
import { createSubscription } from "@/db/mutations";
import { CreateDialog } from "@/components/create-dialog";
import { SubscriptionFields, type Option } from "./subscription-fields";

export function NewSubscriptionDialog({
  parties,
  projects,
}: Readonly<{
  parties: Option[];
  projects: Option[];
}>) {
  const t = useTranslations("subscriptions");

  return (
    <CreateDialog
      action={createSubscription}
      trigger={t("newDialog.trigger")}
      title={t("newDialog.title")}
      description={t("newDialog.description")}
      successMessage={t("newDialog.toast.added")}
      submitLabel={t("newDialog.submit")}
      submittingLabel={t("newDialog.submitting")}
      className="sm:max-w-lg max-h-[85vh] overflow-y-auto"
    >
      <SubscriptionFields parties={parties} projects={projects} />
    </CreateDialog>
  );
}

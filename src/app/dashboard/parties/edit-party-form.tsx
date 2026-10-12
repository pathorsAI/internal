"use client";

import { useTranslations } from "next-intl";
import { updateParty } from "@/db/mutations";
import { EditForm } from "@/components/edit-form";
import { PartyFields, type AccountOption, type PartyFormValues } from "./party-fields";
import { PartyAvatarField } from "./party-avatar-field";

type Party = PartyFormValues & { id: number; avatarVersion: string | null };

export function EditPartyForm({
  party,
  accounts,
  footer,
}: Readonly<{
  party: Party;
  accounts: AccountOption[];
  footer?: React.ReactNode;
}>) {
  const t = useTranslations("parties");

  return (
    <EditForm
      action={updateParty}
      successMessage={t("toast.updated")}
      cancelLabel={t("form.cancel")}
      submitLabel={t("form.saveChanges")}
      submittingLabel={t("form.saving")}
      footer={footer}
    >
      <input type="hidden" name="id" value={party.id} />
      <PartyAvatarField partyId={party.id} name={party.name} avatarVersion={party.avatarVersion} />
      <PartyFields accounts={accounts} values={party} />
    </EditForm>
  );
}

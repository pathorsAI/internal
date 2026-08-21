"use client";

import { useTranslations } from "next-intl";
import { SelectField, TextField } from "@/components/form-field";
import { PartyField } from "@/components/party-combobox";
import { SelectItem } from "@/components/ui/select";

export type PartyOption = { id: number; name: string };

export type ProjectFormValues = {
  name: string;
  clientPartyId: number | null;
  /** 目前綁定的客戶名稱，給 PartyCombobox 預填 */
  clientName: string | null;
  status: string;
  description: string | null;
};

/**
 * 新增與編輯共用的專案欄位群。沒有 values 就是新增模式。
 *
 * 標籤一律走 newDialog.* —— editForm.* 的同名項目字串完全一樣，
 * 但只有 newDialog.* 那組帶得出 placeholder。
 */
export function ProjectFields({
  parties,
  values,
}: Readonly<{
  parties: PartyOption[];
  values?: ProjectFormValues;
}>) {
  const t = useTranslations("projects");

  return (
    <>
      <TextField
        name="name"
        label={t("newDialog.name.label")}
        required
        wide
        placeholder={t("newDialog.name.placeholder")}
        defaultValue={values?.name}
      />
      <PartyField
        parties={parties}
        name="clientPartyName"
        defaultName={values?.clientName ?? ""}
      />
      <SelectField name="status" label={t("newDialog.status")} defaultValue={values?.status ?? "active"}>
        <SelectItem value="active">{t("status.active")}</SelectItem>
        <SelectItem value="archived">{t("status.archived")}</SelectItem>
      </SelectField>
      <TextField
        name="description"
        label={t("newDialog.descriptionField.label")}
        wide
        placeholder={t("newDialog.descriptionField.placeholder")}
        defaultValue={values?.description ?? ""}
      />
    </>
  );
}

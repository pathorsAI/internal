"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Field, SelectField, TextField } from "@/components/form-field";
import { DatePicker } from "@/components/date-picker";
import { CurrencySelect } from "@/components/currency-select";
import { PartyField } from "@/components/party-combobox";
import { TaxFields, TaxFollowsContract } from "@/components/tax-fields";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { TaxSetting } from "@/lib/tax-treatment";

export type Option = { id: number; name: string };

export type SubscriptionFormValues = {
  customerPartyId: number;
  /** 目前綁定的客戶名稱，給 PartyCombobox 預填 */
  customerName: string | null;
  projectId: number | null;
  contractId: number | null;
  name: string;
  amount: string;
  currency: string;
  intervalMonths: number;
  startDate: string;
  endDate: string | null;
  status: string;
  note: string | null;
  /** 訂閱自己存的稅別（NULL＝沿用）。綁了合約時不顯示、跟著合約。 */
  taxTreatment: string | null;
  amountBasis: string | null;
};

/**
 * 新增與編輯共用的訂閱欄位群。沒有 values 就是新增模式。
 *
 * 標籤一律走 newDialog.* —— editForm.* 的同名項目字串完全一樣，
 * 但只有 newDialog.* 那組帶得出 placeholder。
 */
export function SubscriptionFields({
  parties,
  projects,
  contracts,
  values,
  orgTax,
}: Readonly<{
  parties: Option[];
  projects: Option[];
  contracts: Option[];
  values?: SubscriptionFormValues;
  /** 組織的稅別預設，「沿用」選項顯示用 */
  orgTax: TaxSetting;
}>) {
  const t = useTranslations("subscriptions");
  // 綁不綁合約決定稅別欄位要不要出現，所以合約下拉要受控。
  const [contractId, setContractId] = useState(
    values?.contractId == null ? "none" : String(values.contractId),
  );

  return (
    <>
      <PartyField
        parties={parties}
        name="customerPartyName"
        required
        defaultName={values?.customerName ?? ""}
      />
      <SelectField
        name="projectId"
        label={t("newDialog.project.label")}
        placeholder={t("newDialog.project.placeholder")}
        defaultValue={values?.projectId == null ? undefined : String(values.projectId)}
      >
        {projects.map((p) => (
          <SelectItem key={p.id} value={String(p.id)}>
            {p.name}
          </SelectItem>
        ))}
      </SelectField>
      <Field label={t("newDialog.contract.label")}>
        <Select name="contractId" value={contractId} onValueChange={setContractId}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder={t("newDialog.contract.placeholder")} />
          </SelectTrigger>
          <SelectContent>
            {/* 選填：Radix Select 不接受空字串，「不綁定」用 "none"（mutations 那側轉回 null）。 */}
            <SelectItem value="none">{t("newDialog.contract.placeholder")}</SelectItem>
            {contracts.map((c) => (
              <SelectItem key={c.id} value={String(c.id)}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <TextField
        name="name"
        label={t("newDialog.name.label")}
        required
        wide
        placeholder={t("newDialog.name.placeholder")}
        defaultValue={values?.name}
      />
      <TextField
        name="amount"
        label={t("newDialog.amount")}
        required
        type="number"
        step="0.01"
        defaultValue={values?.amount}
      />
      <Field label={t("newDialog.currency")}>
        <CurrencySelect defaultValue={values?.currency} />
      </Field>
      {/* 綁了合約就跟著合約，不送這兩個欄位（mutations 那側就不會動到訂閱自己的值）。 */}
      {contractId === "none" ? (
        <TaxFields
          treatment={values?.taxTreatment}
          basis={values?.amountBasis}
          orgDefault={orgTax}
        />
      ) : (
        <TaxFollowsContract />
      )}
      <TextField
        name="intervalMonths"
        label={t("newDialog.intervalMonths")}
        type="number"
        min="1"
        defaultValue={values?.intervalMonths ?? 1}
      />
      <SelectField
        name="status"
        label={t("newDialog.status")}
        defaultValue={values?.status ?? "active"}
      >
        <SelectItem value="active">{t("status.active")}</SelectItem>
        <SelectItem value="paused">{t("status.paused")}</SelectItem>
        <SelectItem value="ended">{t("status.ended")}</SelectItem>
      </SelectField>
      <Field label={t("newDialog.startDate")} required>
        <DatePicker name="startDate" defaultValue={values?.startDate} />
      </Field>
      <Field label={t("newDialog.endDate")}>
        <DatePicker
          name="endDate"
          allowEmpty
          placeholder={t("newDialog.datePlaceholderNone")}
          defaultValue={values?.endDate ?? undefined}
        />
      </Field>
      <TextField
        name="note"
        label={t("newDialog.note.label")}
        wide
        placeholder={t("newDialog.note.placeholder")}
        defaultValue={values?.note ?? ""}
      />
    </>
  );
}

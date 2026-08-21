"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { formatCurrency } from "@/lib/format";
import { Field, SelectField, TextField } from "@/components/form-field";
import { DatePicker } from "@/components/date-picker";
import { CurrencySelect } from "@/components/currency-select";
import { PartyField } from "@/components/party-combobox";
import { DEFAULT_CURRENCY } from "@/lib/currency";
import { SelectItem } from "@/components/ui/select";
import {
  ContractBillingPlanFields,
  type BillingPlanDefaults,
} from "./contract-billing-plan";

export type Option = { id: number; name: string };

export type ContractFormValues = {
  customerPartyId: number;
  /** 目前綁定的客戶名稱，給 PartyCombobox 預填 */
  customerName: string | null;
  projectId: number | null;
  title: string;
  amount: string | null;
  currency: string;
  startDate: string | null;
  endDate: string | null;
  signedDate: string | null;
  paymentTermsDays: number | null;
  status: string;
  note: string | null;
  fileUrl: string | null;
} & BillingPlanDefaults;

/**
 * 新增與編輯共用的合約欄位群。沒有 values 就是新增模式。
 *
 * 標籤一律走 newDialog.* —— editForm.* 的同名項目字串完全一樣，
 * 但只有 newDialog.* 那組帶得出 placeholder。唯一真的不同的是
 * fileUrl 的 placeholder（新增那版尾巴多了「（選填）」），所以那格分開取。
 */
export function ContractFields({
  parties,
  projects,
  values,
  summary,
  scheduleCount = 0,
  lockedScheduleCount = 0,
  extra,
}: Readonly<{
  parties: Option[];
  projects: Option[];
  values?: ContractFormValues;
  summary?: { received: number; cost: number; remaining: number | null };
  /** 這張合約已有幾筆請款項目，以及其中已動過（不可重排）的筆數 */
  scheduleCount?: number;
  lockedScheduleCount?: number;
  /** 額外區塊（分期請款清單），由 Server Component 傳進來 */
  extra?: React.ReactNode;
}>) {
  const t = useTranslations("contracts");
  // 受控欄位：請款方式區塊要靠它們即時算出排程預覽。
  const [amount, setAmount] = useState(values?.amount ?? "");
  const [currency, setCurrency] = useState(values?.currency ?? DEFAULT_CURRENCY);
  const [signedDate, setSignedDate] = useState(values?.signedDate ?? "");
  const [startDate, setStartDate] = useState(values?.startDate ?? "");

  return (
    <>
      {summary && values && (
        <div className="grid grid-cols-3 gap-2 rounded-lg border bg-muted/30 p-3 text-center sm:col-span-2">
          <div>
            <div className="text-xs text-muted-foreground">{t("editForm.summary.received")}</div>
            <div className="text-sm font-medium tabular-nums">
              {formatCurrency(summary.received, values.currency)}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">{t("editForm.summary.remaining")}</div>
            <div className="text-sm font-medium tabular-nums">
              {summary.remaining == null ? "—" : formatCurrency(summary.remaining, values.currency)}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">{t("editForm.summary.cost")}</div>
            <div className="text-sm font-medium tabular-nums">
              {formatCurrency(summary.cost, values.currency)}
            </div>
          </div>
          <p className="col-span-3 text-xs text-muted-foreground">
            {t("editForm.summary.note")}
          </p>
        </div>
      )}

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
      <TextField
        name="title"
        label={t("newDialog.titleField.label")}
        required
        wide
        placeholder={t("newDialog.titleField.placeholder")}
        defaultValue={values?.title}
      />
      <TextField
        name="amount"
        label={t("newDialog.amount.label")}
        type="number"
        step="0.01"
        placeholder={t("newDialog.amount.placeholder")}
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
      />
      <Field label={t("newDialog.currency")}>
        <CurrencySelect defaultValue={values?.currency} onValueChange={setCurrency} />
      </Field>
      <SelectField
        name="status"
        label={t("newDialog.status")}
        defaultValue={values?.status ?? "active"}
      >
        <SelectItem value="draft">{t("status.draft")}</SelectItem>
        <SelectItem value="active">{t("status.active")}</SelectItem>
        <SelectItem value="completed">{t("status.completed")}</SelectItem>
        <SelectItem value="cancelled">{t("status.cancelled")}</SelectItem>
      </SelectField>
      <Field label={t("newDialog.signedDate")}>
        <DatePicker
          name="signedDate"
          allowEmpty
          placeholder={t("newDialog.datePlaceholderNone")}
          defaultValue={values?.signedDate ?? undefined}
          onValueChange={setSignedDate}
        />
      </Field>
      <TextField
        name="paymentTermsDays"
        label={t("newDialog.paymentTermsDays.label")}
        type="number"
        min="0"
        placeholder={t("newDialog.paymentTermsDays.placeholder")}
        defaultValue={values?.paymentTermsDays ?? ""}
      />
      <Field label={t("newDialog.startDate")}>
        <DatePicker
          name="startDate"
          allowEmpty
          placeholder={t("newDialog.datePlaceholderNone")}
          defaultValue={values?.startDate ?? undefined}
          onValueChange={setStartDate}
        />
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
        label={t("newDialog.note")}
        wide
        placeholder={t("newDialog.notePlaceholder")}
        defaultValue={values?.note ?? ""}
      />
      <TextField
        name="fileUrl"
        label={t("newDialog.fileUrl.label")}
        wide
        type="url"
        placeholder={values ? t("editForm.fileUrl.placeholder") : t("newDialog.fileUrl.placeholder")}
        defaultValue={values?.fileUrl ?? ""}
      />

      <ContractBillingPlanFields
        amount={amount}
        currency={currency}
        signedDate={signedDate}
        startDate={startDate}
        defaults={values}
        existingCount={scheduleCount}
        lockedCount={lockedScheduleCount}
      />

      {extra}
    </>
  );
}

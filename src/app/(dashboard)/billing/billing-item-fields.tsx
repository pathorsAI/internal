"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Req } from "@/components/req";
import { DatePicker } from "@/components/date-picker";
import { CurrencySelect } from "@/components/currency-select";
import { PartyField } from "@/components/party-combobox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type Option = { id: number; name: string };

export type BillingItemFormValues = {
  customerPartyId: number | null;
  /** 目前綁定的客戶名稱，給 PartyCombobox 預填 */
  customerName: string | null;
  contractId: number | null;
  projectId: number | null;
  title: string;
  amount: string;
  currency: string;
  dueDate: string | null;
  billedOn: string | null;
  paidOn: string | null;
  invoicedOn: string | null;
  needsInvoice: boolean;
  status: string;
  note: string | null;
};

/**
 * 新增與編輯共用的欄位群。兩張表單的差異只有 action 與按鈕，
 * 欄位一份就好，避免兩邊漂移。
 */
export function BillingItemFields({
  parties,
  contracts,
  projects,
  values,
  hideContract = false,
}: Readonly<{
  parties: Option[];
  contracts: Option[];
  projects: Option[];
  values?: BillingItemFormValues;
  /** 從合約頁開啟時合約已固定，改用 hidden input 帶值，這裡就不再渲染下拉。 */
  hideContract?: boolean;
}>) {
  return (
    <>
      <PartyField
        parties={parties}
        name="customerPartyName"
        required
        defaultName={values?.customerName ?? ""}
      />

      <div className="space-y-1.5">
        <Label htmlFor="bi-title">項目名稱<Req /></Label>
        <Input
          id="bi-title"
          name="title"
          required
          placeholder="例：簽約金 / 期中款 / 尾款"
          defaultValue={values?.title}
        />
      </div>

      {!hideContract && (
        <div className="space-y-1.5">
          <Label>合約</Label>
          <Select
            name="contractId"
            defaultValue={values?.contractId == null ? undefined : String(values.contractId)}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="— 未指定 —" />
            </SelectTrigger>
            <SelectContent>
              {contracts.map((c) => (
                <SelectItem key={c.id} value={String(c.id)}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="space-y-1.5">
        <Label>專案</Label>
        <Select
          name="projectId"
          defaultValue={values?.projectId == null ? undefined : String(values.projectId)}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="— 未指定 —" />
          </SelectTrigger>
          <SelectContent>
            {projects.map((p) => (
              <SelectItem key={p.id} value={String(p.id)}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="bi-amount">應收金額<Req /></Label>
        <Input
          id="bi-amount"
          name="amount"
          type="number"
          step="0.01"
          required
          defaultValue={values?.amount}
        />
      </div>
      <div className="space-y-1.5">
        <Label>幣別</Label>
        <CurrencySelect defaultValue={values?.currency} />
      </div>

      <div className="space-y-1.5">
        <Label>應請款日</Label>
        <DatePicker
          name="dueDate"
          allowEmpty
          placeholder="— 無 —"
          defaultValue={values?.dueDate ?? undefined}
        />
      </div>
      <div className="space-y-1.5">
        <Label>狀態</Label>
        <Select name="status" defaultValue={values?.status ?? "scheduled"}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="scheduled">排程中</SelectItem>
            <SelectItem value="billed">已請款</SelectItem>
            <SelectItem value="paid">已收款</SelectItem>
            <SelectItem value="cancelled">已取消</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label>實際請款日</Label>
        <DatePicker
          name="billedOn"
          allowEmpty
          placeholder="— 尚未請款 —"
          defaultValue={values?.billedOn ?? undefined}
        />
      </div>
      <div className="space-y-1.5">
        <Label>收款日</Label>
        <DatePicker
          name="paidOn"
          allowEmpty
          placeholder="— 尚未收款 —"
          defaultValue={values?.paidOn ?? undefined}
        />
      </div>
      <div className="space-y-1.5">
        <Label>開發票日</Label>
        <DatePicker
          name="invoicedOn"
          allowEmpty
          placeholder="— 尚未開立 —"
          defaultValue={values?.invoicedOn ?? undefined}
        />
      </div>
      <div className="flex items-end pb-2">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            name="needsInvoice"
            defaultChecked={values?.needsInvoice ?? true}
            className="size-4 accent-primary"
          />
          這筆需要開發票
        </label>
      </div>

      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor="bi-note">備註</Label>
        <Input id="bi-note" name="note" placeholder="選填" defaultValue={values?.note ?? ""} />
      </div>

      <p className="text-xs text-muted-foreground sm:col-span-2">
        收款金額以「綁定這筆請款項目的收入交易」為準；這裡的收款日只是人工註記。
      </p>
    </>
  );
}

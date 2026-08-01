"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Req } from "@/components/req";
import { DatePicker } from "@/components/date-picker";
import { CurrencySelect } from "@/components/currency-select";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type Option = { id: number; name: string };

export type InvoiceFormValues = {
  direction: string;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  partyId: number | null;
  counterpartyName: string | null;
  counterpartyTaxId: string | null;
  amountNet: string | null;
  tax: string | null;
  amountGross: string | null;
  currency: string;
  status: string;
  note: string | null;
  contractId: number | null;
  billingItemId: number | null;
};

/** 新增與編輯共用的發票欄位群。 */
export function InvoiceFields({
  parties,
  contracts,
  billingItems,
  values,
}: Readonly<{
  parties: Option[];
  contracts: Option[];
  billingItems: Option[];
  values?: InvoiceFormValues;
}>) {
  return (
    <>
      <div className="space-y-1.5">
        <Label>類型</Label>
        <Select name="direction" defaultValue={values?.direction ?? "issued"}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="issued">開給客戶</SelectItem>
            <SelectItem value="received">廠商開給我</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label>發票日期<Req /></Label>
        <DatePicker name="invoiceDate" defaultValue={values?.invoiceDate ?? undefined} />
      </div>

      <div className="space-y-1.5">
        <Label>對象</Label>
        <Select
          name="partyId"
          defaultValue={values?.partyId == null ? undefined : String(values.partyId)}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="— 未指定 —" />
          </SelectTrigger>
          <SelectContent>
            {parties.map((p) => (
              <SelectItem key={p.id} value={String(p.id)}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="inv-number">發票號碼</Label>
        <Input
          id="inv-number"
          name="invoiceNumber"
          placeholder="例：AB-12345678"
          defaultValue={values?.invoiceNumber ?? ""}
        />
      </div>

      <div className="space-y-1.5">
        <Label>對應請款項目</Label>
        <Select
          name="billingItemId"
          defaultValue={values?.billingItemId == null ? undefined : String(values.billingItemId)}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="— 未指定 —" />
          </SelectTrigger>
          <SelectContent>
            {billingItems.map((b) => (
              <SelectItem key={b.id} value={String(b.id)}>
                {b.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label>對應合約</Label>
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

      <div className="space-y-1.5">
        <Label htmlFor="inv-net">未稅金額</Label>
        <Input
          id="inv-net"
          name="amountNet"
          type="number"
          step="0.01"
          defaultValue={values?.amountNet ?? ""}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="inv-tax">稅額</Label>
        <Input
          id="inv-tax"
          name="tax"
          type="number"
          step="0.01"
          defaultValue={values?.tax ?? ""}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="inv-gross">含稅金額</Label>
        <Input
          id="inv-gross"
          name="amountGross"
          type="number"
          step="0.01"
          defaultValue={values?.amountGross ?? ""}
        />
      </div>
      <div className="space-y-1.5">
        <Label>幣別</Label>
        <CurrencySelect defaultValue={values?.currency} />
      </div>

      <div className="space-y-1.5">
        <Label>狀態</Label>
        <Select name="status" defaultValue={values?.status ?? "valid"}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="valid">有效</SelectItem>
            <SelectItem value="void">作廢</SelectItem>
            <SelectItem value="allowance">折讓</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="inv-taxid">對象統編</Label>
        <Input
          id="inv-taxid"
          name="counterpartyTaxId"
          placeholder="選填"
          defaultValue={values?.counterpartyTaxId ?? ""}
        />
      </div>

      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor="inv-name">對象名稱（未從上方選擇時使用）</Label>
        <Input
          id="inv-name"
          name="counterpartyName"
          placeholder="選填；有選「對象」時以該筆為準"
          defaultValue={values?.counterpartyName ?? ""}
        />
      </div>
      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor="inv-note">備註</Label>
        <Input id="inv-note" name="note" placeholder="選填" defaultValue={values?.note ?? ""} />
      </div>
    </>
  );
}

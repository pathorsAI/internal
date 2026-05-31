"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { Paperclip } from "lucide-react";
import { updateTransaction, deleteTransactionDocument, type ActionState } from "@/db/mutations";
import type { TxnDocument } from "@/db/queries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label, Req } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { DialogFooter } from "@/components/ui/dialog";
import { DeleteButton } from "@/components/delete-button";
import { useRowDialogClose } from "@/components/row-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DatePicker } from "@/components/date-picker";
import { CategoryCombobox } from "./category-combobox";
import { PartyCombobox } from "./party-combobox";

const initial: ActionState = { ok: false };
const DOC_KINDS: Record<string, string> = {
  e_invoice: "電子發票",
  paper_invoice: "其他發票（三聯式等）",
  receipt: "收據",
  other: "其他",
};
const typeLabel: Record<string, string> = {
  expense: "一般支出",
  income: "收入",
  advance: "員工代墊",
  reimbursement: "撥款",
  transfer: "轉帳",
};
function docLabel(docType: string, invoiceKind: string | null) {
  if (docType === "invoice") return invoiceKind === "paper" ? "其他發票" : "電子發票";
  if (docType === "receipt") return "收據";
  if (docType === "contract") return "合約";
  return "其他";
}

type Account = { id: number; name: string; currency: string };
type Txn = {
  id: number;
  type: string;
  txnDate: string;
  description: string | null;
  amount: string;
  currency: string;
  categoryId: number | null;
  book: string;
  billedToCompanyTaxId: boolean;
  partyName: string | null;
  settleName: string | null;
  fromAccountId: number | null;
  toAccountId: number | null;
};

export function EditTransactionForm({
  txn,
  categories,
  parties,
  employees,
  accounts,
  docs = [],
  footer,
}: Readonly<{
  txn: Txn;
  categories: { id: number; name: string }[];
  parties: { id: number; name: string }[];
  employees: { id: number; name: string }[];
  accounts: Account[];
  docs?: TxnDocument[];
  footer?: React.ReactNode;
}>) {
  const [state, action, pending] = useActionState(updateTransaction, initial);
  const [billed, setBilled] = useState(txn.billedToCompanyTaxId);
  const close = useRowDialogClose();
  useEffect(() => {
    if (state.ok) {
      toast.success("已更新");
      close();
    }
  }, [state]);
  useEffect(() => {
    if (state.error) toast.error(state.error);
  }, [state]);

  const accountItems = Object.fromEntries(
    accounts.map((a) => [String(a.id), `${a.name}（${a.currency}）`]),
  );
  const isTransfer = txn.type === "transfer";
  const isIncome = txn.type === "income";
  const isAdvance = txn.type === "advance";
  const defaultCategoryName = categories.find((c) => c.id === txn.categoryId)?.name ?? "";

  return (
    <>
      {docs.length > 0 && (
        <div className="mb-4 space-y-2">
          <div className="text-sm font-medium">已附憑證</div>
          <ul className="divide-y rounded-md border">
            {docs.map((d) => (
              <li key={d.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                <Paperclip className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="rounded bg-muted px-1.5 py-0.5 text-xs">
                  {docLabel(d.docType, d.invoiceKind)}
                </span>
                {d.invoiceKind === "paper" ? (
                  <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-700">
                    需通知會計師
                  </span>
                ) : null}
                <a
                  href={`/api/documents/${d.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="truncate text-primary hover:underline"
                >
                  {d.fileName ?? "檢視檔案"}
                </a>
                <span className="ml-auto">
                  <DeleteButton action={deleteTransactionDocument} id={d.id} />
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <form action={action} className="grid gap-4 sm:grid-cols-2">
        <input type="hidden" name="id" value={txn.id} />
        <input type="hidden" name="type" value={txn.type} />

        <div className="flex items-center gap-2 text-sm text-muted-foreground sm:col-span-2">
          類型
          <Badge variant="secondary">{typeLabel[txn.type] ?? txn.type}</Badge>
          <span className="text-xs">（類型不可改）</span>
        </div>

        <div className="space-y-1.5">
          <Label>日期<Req /></Label>
          <DatePicker name="txnDate" defaultValue={txn.txnDate} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="amount">金額<Req /></Label>
          <Input id="amount" name="amount" type="number" step="0.01" required defaultValue={txn.amount} />
        </div>
        <div className="space-y-1.5">
          <Label>幣別</Label>
          <CurrencyToggle current={txn.currency} />
        </div>

        {isTransfer ? (
          <>
            <AccountField
              name="fromAccountId"
              label="轉出帳戶"
              accounts={accounts}
              items={accountItems}
              defaultValue={txn.fromAccountId}
            />
            <AccountField
              name="toAccountId"
              label="轉入帳戶"
              accounts={accounts}
              items={accountItems}
              defaultValue={txn.toAccountId}
            />
          </>
        ) : (
          <>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>
                {isIncome ? "客戶" : "廠商 / 對象"}
                <Req />
              </Label>
              <PartyCombobox
                parties={parties}
                name="partyName"
                defaultName={txn.partyName ?? ""}
                placeholder={isIncome ? "輸入或選擇客戶…" : "輸入或選擇廠商…"}
              />
            </div>
            {isAdvance && (
              <div className="space-y-1.5 sm:col-span-2">
                <Label>代墊人（員工）<Req /></Label>
                <PartyCombobox
                  parties={employees}
                  name="settleEmployeeName"
                  defaultName={txn.settleName ?? ""}
                  placeholder="輸入代墊的員工…"
                />
              </div>
            )}
            <div className="space-y-1.5">
              <Label>分類<Req /></Label>
              <CategoryCombobox categories={categories} defaultName={defaultCategoryName} />
            </div>
            {!isAdvance && (
              <AccountField
                name="accountId"
                label={isIncome ? "收款帳戶" : "付款帳戶"}
                accounts={accounts}
                items={accountItems}
                defaultValue={isIncome ? txn.toAccountId : txn.fromAccountId}
              />
            )}
          </>
        )}

        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="description">摘要</Label>
          <Input id="description" name="description" defaultValue={txn.description ?? ""} />
        </div>

        {!isTransfer && (
          <div className="space-y-3 sm:col-span-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="reported"
                defaultChecked={txn.book !== "internal"}
                className="size-4"
              />
              <span>上外帳（要報稅）</span>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="billedToCompanyTaxId"
                checked={billed}
                onChange={(e) => setBilled(e.target.checked)}
                className="size-4"
              />
              <span>這筆有報公司統編</span>
            </label>
            <VoucherFields billed={billed} />
          </div>
        )}

        <DialogFooter className="mt-2 border-t pt-4 sm:col-span-2">
          {footer ? <div className="mr-auto">{footer}</div> : null}
          <Button type="button" variant="outline" onClick={close}>
            取消
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? "儲存中…" : "儲存變更"}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}

function CurrencyToggle({ current }: Readonly<{ current: string }>) {
  return (
    <div className="inline-flex w-full rounded-md border p-0.5">
      {[
        { v: "TWD", l: "NT$ 台幣" },
        { v: "USD", l: "US$ 美金" },
      ].map((c) => (
        <label key={c.v} className="flex-1">
          <input
            type="radio"
            name="currency"
            value={c.v}
            defaultChecked={current === c.v}
            className="peer sr-only"
          />
          <span className="block cursor-pointer rounded-[5px] px-3 py-1.5 text-center text-sm peer-checked:bg-foreground peer-checked:text-background">
            {c.l}
          </span>
        </label>
      ))}
    </div>
  );
}

function AccountField({
  name,
  label,
  accounts,
  items,
  defaultValue,
}: Readonly<{
  name: string;
  label: string;
  accounts: Account[];
  items: Record<string, string>;
  defaultValue: number | null;
}>) {
  return (
    <div className="space-y-1.5">
      <Label>
        {label}
        <Req />
      </Label>
      <Select
        name={name}
        items={items}
        defaultValue={defaultValue == null ? undefined : String(defaultValue)}
        required
      >
        <SelectTrigger className="w-full">
          <SelectValue placeholder="— 選擇帳戶 —" />
        </SelectTrigger>
        <SelectContent>
          {accounts.map((a) => (
            <SelectItem key={a.id} value={String(a.id)}>
              {a.name}（{a.currency}）
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function VoucherFields({ billed }: Readonly<{ billed: boolean }>) {
  const kindOptions = billed
    ? { e_invoice: DOC_KINDS.e_invoice, paper_invoice: DOC_KINDS.paper_invoice }
    : DOC_KINDS;
  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Paperclip className="size-4 text-muted-foreground" />
        補上憑證 / 相關證明{billed ? "" : "（選填）"}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>類型{billed ? <Req /> : null}</Label>
          <Select key={billed ? "billed" : "free"} name="docKind" items={kindOptions} defaultValue="e_invoice">
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(kindOptions).map(([v, l]) => (
                <SelectItem key={v} value={v}>
                  {l}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="edit-attachment">附檔</Label>
          <Input
            id="edit-attachment"
            name="attachment"
            type="file"
            accept="image/*,application/pdf"
            className="cursor-pointer file:mr-2 file:cursor-pointer file:rounded file:border-0 file:bg-muted file:px-2 file:py-0.5 file:text-xs"
          />
        </div>
      </div>
    </div>
  );
}

"use client";

import { useActionState, useState } from "react";
import { toast } from "sonner";
import { Paperclip } from "lucide-react";
import { updateTransaction, deleteTransactionDocument, type ActionState } from "@/db/mutations";
import type { TxnDocument, AuditMeta as AuditMetaData } from "@/db/queries";
import { AuditMeta } from "@/components/audit-meta";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Req } from "@/components/req";
import { Badge } from "@/components/ui/badge";
import { DeleteButton } from "@/components/delete-button";
import { useRowDialogClose } from "@/components/row-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CurrencySelect } from "@/components/currency-select";
import { submitAction } from "@/lib/form-action";
import { DatePicker } from "@/components/date-picker";
import { CategoryCombobox } from "./category-combobox";
import { PartyCombobox } from "@/components/party-combobox";
import { ContractCombobox, type ContractOption } from "./contract-combobox";

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
  createdAt: string;
  updatedAt: string;
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
  projectId: number | null;
  contractId: number | null;
};

export function EditTransactionForm({
  txn,
  categories,
  parties,
  employees,
  accounts,
  projects,
  contracts,
  docs = [],
  audit,
  footer,
}: Readonly<{
  txn: Txn;
  categories: { id: number; name: string }[];
  parties: { id: number; name: string }[];
  employees: { id: number; name: string }[];
  accounts: Account[];
  projects: { id: number; name: string }[];
  contracts: ContractOption[];
  docs?: TxnDocument[];
  audit?: AuditMetaData;
  footer?: React.ReactNode;
}>) {
  const [billed, setBilled] = useState(txn.billedToCompanyTaxId);
  const close = useRowDialogClose();

  // 成功/失敗處理放在 action 內（跑在 transition 裡），不用 useEffect ——
  // 既避免 effect 內 setState 的串聯 render，也讓每次送出都必定各吐一次 toast
  // （舊寫法依賴 [state] 變化，連續兩次同樣的錯誤不會再跳）。
  const [, action, pending] = useActionState(
    async (prev: ActionState, formData: FormData) => {
      const res = await updateTransaction(prev, formData);
      if (res.ok) {
        toast.success("已更新");
        close();
      } else if (res.error) {
        toast.error(res.error);
      }
      return res;
    },
    initial,
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

      <form onSubmit={submitAction(action)} className="grid gap-4 sm:grid-cols-2">
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
          <CurrencySelect defaultValue={txn.currency} />
        </div>

        {isTransfer ? (
          <>
            <AccountField
              name="fromAccountId"
              label="轉出帳戶"
              accounts={accounts}
              defaultValue={txn.fromAccountId}
            />
            <AccountField
              name="toAccountId"
              label="轉入帳戶"
              accounts={accounts}
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
                defaultValue={isIncome ? txn.toAccountId : txn.fromAccountId}
              />
            )}
            <div className="space-y-1.5 sm:col-span-2">
              <Label>專案</Label>
              <Select
                name="projectId"
                defaultValue={txn.projectId == null ? undefined : String(txn.projectId)}
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
            <div className="space-y-1.5 sm:col-span-2">
              <Label>合約</Label>
              <ContractCombobox contracts={contracts} defaultId={txn.contractId} />
            </div>
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
                className="size-4 accent-primary"
              />
              <span>這筆有報公司統編</span>
            </label>
            <VoucherFields billed={billed} />
          </div>
        )}

        <div className="sm:col-span-2">
          <AuditMeta
            meta={audit}
            fallbackCreatedAt={txn.createdAt}
            fallbackUpdatedAt={txn.updatedAt}
          />
        </div>

        <div className="sticky bottom-0 z-10 -mx-4 mt-2 flex flex-col-reverse gap-2 border-t bg-background px-4 py-3 sm:col-span-2 sm:flex-row sm:items-center sm:justify-end">
          {footer ? <div className="sm:mr-auto">{footer}</div> : null}
          <Button type="button" variant="outline" onClick={close}>
            取消
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? "儲存中…" : "儲存變更"}
          </Button>
        </div>
      </form>
    </>
  );
}

function AccountField({
  name,
  label,
  accounts,
  defaultValue,
}: Readonly<{
  name: string;
  label: string;
  accounts: Account[];
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
          <Select key={billed ? "billed" : "free"} name="docKind" defaultValue="e_invoice">
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

"use client";

import { useActionState, useState } from "react";
import { toast } from "sonner";
import { Paperclip } from "lucide-react";
import { useTranslations } from "next-intl";
import { updateTransaction, deleteTransactionDocument, type ActionState } from "@/db/mutations";
import type { TxnDocument, AuditMeta as AuditMetaData } from "@/db/queries";
import { AuditMeta } from "@/components/audit-meta";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, SelectField, TextField } from "@/components/form-field";
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
import {
  AccountSelectField,
  LockedCurrencyField,
  TransferCurrencyWarning,
  accountCurrency,
} from "./account-currency-fields";
import { submitAction } from "@/lib/form-action";
import { DatePicker } from "@/components/date-picker";
import { CategoryCombobox } from "./category-combobox";
import { PartyCombobox } from "@/components/party-combobox";
import { ContractCombobox, type ContractOption } from "./contract-combobox";

const initial: ActionState = { ok: false };

/** Select 的 value 是字串；沒綁帳戶時用空字串代表「未選」。 */
function idStr(id: number | null): string {
  return id == null ? "" : String(id);
}
const DOC_KIND_KEYS = ["e_invoice", "paper_invoice", "receipt", "other"] as const;
const TYPE_KEYS = ["expense", "income", "advance", "reimbursement", "transfer"] as const;

function docLabelKey(docType: string, invoiceKind: string | null) {
  if (docType === "invoice") return invoiceKind === "paper" ? "invoicePaper" : "invoiceElectronic";
  if (docType === "receipt") return "receipt";
  if (docType === "contract") return "contract";
  return "other";
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
  const t = useTranslations("transactions");
  const [billed, setBilled] = useState(txn.billedToCompanyTaxId);
  const close = useRowDialogClose();
  // 幣別跟著帳戶走，所以帳戶選單必須受控（見 ./account-currency-fields）。
  const [accountId, setAccountId] = useState(
    idStr(txn.type === "income" ? txn.toAccountId : txn.fromAccountId),
  );
  const [fromAccountId, setFromAccountId] = useState(idStr(txn.fromAccountId));
  const [toAccountId, setToAccountId] = useState(idStr(txn.toAccountId));

  // 成功/失敗處理放在 action 內（跑在 transition 裡），不用 useEffect ——
  // 既避免 effect 內 setState 的串聯 render，也讓每次送出都必定各吐一次 toast
  // （舊寫法依賴 [state] 變化，連續兩次同樣的錯誤不會再跳）。
  const [, action, pending] = useActionState(
    async (prev: ActionState, formData: FormData) => {
      const res = await updateTransaction(prev, formData);
      if (res.ok) {
        toast.success(t("toast.updated"));
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
  const fromCurrency = accountCurrency(accounts, fromAccountId);
  const toCurrency = accountCurrency(accounts, toAccountId);
  // 代墊沒有帳戶（是員工先墊的），所以只有它還能自由選幣別。
  const lockedCurrency = isTransfer ? fromCurrency : accountCurrency(accounts, accountId);
  const defaultCategoryName = categories.find((c) => c.id === txn.categoryId)?.name ?? "";
  const typeLabel: Record<string, string> = Object.fromEntries(
    TYPE_KEYS.map((k) => [k, t(`type.${k}`)]),
  );

  return (
    <>
      {docs.length > 0 && (
        <div className="mb-4 space-y-2">
          <div className="text-sm font-medium">{t("form.attachedDocs")}</div>
          <ul className="divide-y rounded-md border">
            {docs.map((d) => (
              <li key={d.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                <Paperclip className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="rounded bg-muted px-1.5 py-0.5 text-xs">
                  {t(`form.docLabel.${docLabelKey(d.docType, d.invoiceKind)}`)}
                </span>
                {d.invoiceKind === "paper" ? (
                  <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-700">
                    {t("form.needsNotifyAccountant")}
                  </span>
                ) : null}
                <a
                  href={`/api/documents/${d.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="truncate text-primary hover:underline"
                >
                  {d.fileName ?? t("form.viewFile")}
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
          {t("form.typeLabel")}
          <Badge variant="secondary">{typeLabel[txn.type] ?? txn.type}</Badge>
          <span className="text-xs">{t("form.typeLocked")}</span>
        </div>

        <Field label={t("form.date")} required>
          <DatePicker name="txnDate" defaultValue={txn.txnDate} />
        </Field>
        <TextField
          name="amount"
          label={t("form.amount")}
          required
          type="number"
          step="0.01"
          defaultValue={txn.amount}
        />
        {isAdvance ? (
          <Field label={t("form.currency")}>
            <CurrencySelect defaultValue={txn.currency} />
          </Field>
        ) : (
          <LockedCurrencyField currency={lockedCurrency} original={txn.currency} />
        )}

        {isTransfer ? (
          <>
            <AccountSelectField
              name="fromAccountId"
              label={t("form.fromAccount")}
              accounts={accounts}
              value={fromAccountId}
              onChange={setFromAccountId}
            />
            <AccountSelectField
              name="toAccountId"
              label={t("form.toAccount")}
              accounts={accounts}
              value={toAccountId}
              onChange={setToAccountId}
            />
            <TransferCurrencyWarning from={fromCurrency} to={toCurrency} />
          </>
        ) : (
          <>
            <Field
              label={isIncome ? t("form.client") : t("form.vendor")}
              required
              wide
            >
              <PartyCombobox
                parties={parties}
                name="partyName"
                defaultName={txn.partyName ?? ""}
                placeholder={isIncome ? t("form.clientPlaceholder") : t("form.vendorPlaceholder")}
              />
            </Field>
            {isAdvance && (
              <Field label={t("form.payer")} required wide>
                <PartyCombobox
                  parties={employees}
                  name="settleEmployeeName"
                  defaultName={txn.settleName ?? ""}
                  placeholder={t("form.payerPlaceholder")}
                />
              </Field>
            )}
            <Field label={t("form.category")} required>
              <CategoryCombobox categories={categories} defaultName={defaultCategoryName} />
            </Field>
            {!isAdvance && (
              <AccountSelectField
                name="accountId"
                label={isIncome ? t("form.receivingAccount") : t("form.payingAccount")}
                accounts={accounts}
                value={accountId}
                onChange={setAccountId}
              />
            )}
            <SelectField
              name="projectId"
              label={t("form.project")}
              wide
              placeholder={t("form.projectPlaceholder")}
              defaultValue={txn.projectId == null ? undefined : String(txn.projectId)}
            >
              {projects.map((p) => (
                <SelectItem key={p.id} value={String(p.id)}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectField>
            <Field label={t("form.contract")} wide>
              <ContractCombobox contracts={contracts} defaultId={txn.contractId} />
            </Field>
          </>
        )}

        <TextField
          name="description"
          label={t("form.description")}
          wide
          defaultValue={txn.description ?? ""}
        />

        {!isTransfer && (
          <div className="space-y-3 sm:col-span-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="reported"
                defaultChecked={txn.book !== "internal"}
                className="size-4"
              />
              <span>{t("form.reported")}</span>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="billedToCompanyTaxId"
                checked={billed}
                onChange={(e) => setBilled(e.target.checked)}
                className="size-4 accent-primary"
              />
              <span>{t("form.billedToCompanyTaxId")}</span>
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
            {t("form.cancel")}
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? t("form.saving") : t("form.saveChanges")}
          </Button>
        </div>
      </form>
    </>
  );
}

function VoucherFields({ billed }: Readonly<{ billed: boolean }>) {
  const t = useTranslations("transactions");
  const kindKeys = billed ? (["e_invoice", "paper_invoice"] as const) : DOC_KIND_KEYS;
  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Paperclip className="size-4 text-muted-foreground" />
        {t("form.editVoucher.title")}
        {billed ? "" : t("form.voucher.optional")}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {/* 標籤的必填星號跟著 billed 走，但 Select 本身一直沒有 required，維持原樣。 */}
        <Field label={t("form.voucher.kind")} required={billed}>
          <Select key={billed ? "billed" : "free"} name="docKind" defaultValue="e_invoice">
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {kindKeys.map((v) => (
                <SelectItem key={v} value={v}>
                  {t(`form.docKind.${v}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label={t("form.voucher.attachment")} htmlFor="edit-attachment">
          <Input
            id="edit-attachment"
            name="attachment"
            type="file"
            accept="image/*,application/pdf"
            className="cursor-pointer file:mr-2 file:cursor-pointer file:rounded file:border-0 file:bg-muted file:px-2 file:py-0.5 file:text-xs"
          />
        </Field>
      </div>
    </div>
  );
}

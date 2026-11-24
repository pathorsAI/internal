"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Receipt } from "lucide-react";
import { createInvoice, type ActionState } from "@/db/mutations";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/form-field";
import { DatePicker } from "@/components/date-picker";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatCurrency } from "@/lib/format";
import { submitAction } from "@/lib/form-action";
import { grossFromNet, splitGross } from "@/lib/vat";
import type { AmountBasis, TaxTreatment } from "@/lib/tax-treatment";

/** gross / net = 應稅（金額含稅／未稅）；notax = 零稅率或免稅，稅額 0。 */
type InvoiceBasis = "gross" | "net" | "notax";

/**
 * 預設基準跟著這一筆的有效稅別走：應稅照它的金額基準，零稅率／免稅不算稅額，
 * 「不加收營業稅」維持原本的預設（含稅）。使用者還是可以改。
 */
function defaultBasis(treatment: TaxTreatment, basis: AmountBasis): InvoiceBasis {
  if (treatment === "taxable") return basis;
  if (treatment === "zero_rated" || treatment === "exempt") return "notax";
  return "gross";
}

/**
 * 寫進發票紀錄的稅別（invoices.tax_treatment 只收 taxable / zero_rated / exempt）。
 * 選了「零稅率／免稅」時，有效稅別是免稅就記免稅，其餘一律記零稅率。
 */
function invoiceTaxTreatment(basis: InvoiceBasis, treatment: TaxTreatment): "taxable" | "zero_rated" | "exempt" {
  if (basis !== "notax") return "taxable";
  return treatment === "exempt" ? "exempt" : "zero_rated";
}

function splitBy(basis: InvoiceBasis, value: number): { net: number; tax: number; gross: number } {
  if (basis === "gross") return { ...splitGross(value), gross: value };
  if (basis === "net") return { net: value, ...grossFromNet(value) };
  return { net: value, tax: 0, gross: value };
}

const initial: ActionState = { ok: false };

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * 看板上的「開發票」：把這一期的資料預填成一張發票草稿，存檔後回填開發票日。
 *
 * Simpany 整合沒開（或不是 owner / admin）時的手動流程：只做本系統這一半 ——
 * Simpany 那邊還是要人去開。所以外部狀態預設 pending，
 * 開好之後把 Simpany 的號碼填進來（或在發票頁補），對帳表才對得起來。
 *
 * 請款金額是未稅還是含稅，預設跟著合約／請款項目的營業稅別（defaultBasis），使用者可改，
 * 選了就即時換算。
 */
export function IssueInvoiceDialog({
  billingItemId,
  contractId,
  customerName,
  customerTaxId,
  title,
  amount: rawAmount,
  taxTreatment,
  amountBasis,
  currency,
}: Readonly<{
  billingItemId: number;
  contractId: number | null;
  customerName: string | null;
  customerTaxId: string | null;
  title: string;
  /** 請款項目的原樣金額（基準看 amountBasis） */
  amount: number;
  /** 有效稅別（綁合約跟合約，否則自己，NULL 沿用組織） */
  taxTreatment: TaxTreatment;
  amountBasis: AmountBasis;
  currency: string;
}>) {
  const t = useTranslations("billing.issueInvoice");
  const tInv = useTranslations("invoices.simpany");
  const tCommon = useTranslations("billing.common");
  const [open, setOpen] = React.useState(false);
  const [basis, setBasis] = React.useState<InvoiceBasis>(() =>
    defaultBasis(taxTreatment, amountBasis),
  );
  const [amount, setAmount] = React.useState(String(rawAmount));
  const router = useRouter();

  const value = Number(amount) || 0;
  const { net, tax, gross } = splitBy(basis, value);

  // 走 submitAction 而不是 <form action>：失敗時 React 不會把剛填的欄位清空
  // （見 @/lib/form-action 的說明）。
  const [, action, pending] = React.useActionState(
    async (prev: ActionState, formData: FormData) => {
      const res = await createInvoice(prev, formData);
      if (res.ok) {
        setOpen(false);
        toast.success(t("toast.created"));
        router.refresh();
      } else if (res.error) {
        toast.error(res.error);
      }
      return res;
    },
    initial,
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant="outline">
          <Receipt className="size-4" /> {t("trigger")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <form onSubmit={submitAction(action)}>
          <DialogHeader>
            <DialogTitle>{t("dialog.title")}</DialogTitle>
            <DialogDescription>{t("dialog.description")}</DialogDescription>
            <p className="text-xs text-muted-foreground">
              <Link href="/dashboard/settings/integrations" className="text-primary hover:underline">
                {tInv("manualHint")}
              </Link>
            </p>
          </DialogHeader>

          {/* 綁定關係與品名沿用這一期的資料，不讓人重打。 */}
          <input type="hidden" name="direction" value="issued" />
          <input type="hidden" name="status" value="valid" />
          <input type="hidden" name="currency" value={currency} />
          <input type="hidden" name="billingItemId" value={billingItemId} />
          {contractId != null && <input type="hidden" name="contractId" value={contractId} />}
          {/* 對象一律以名稱送出（與其他表單一致）；這一期已經有客戶了，所以查得到既有那筆，
              不會多建一個。 */}
          <input type="hidden" name="partyName" value={customerName ?? ""} />
          <input type="hidden" name="counterpartyName" value={customerName ?? ""} />
          <input type="hidden" name="amountNet" value={net} />
          <input type="hidden" name="tax" value={tax} />
          <input type="hidden" name="amountGross" value={gross} />
          <input type="hidden" name="taxTreatment" value={invoiceTaxTreatment(basis, taxTreatment)} />

          <div className="grid gap-4 py-4 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2 rounded-lg border bg-muted/30 p-3 text-sm">
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground">{t("fields.customer")}</span>
                <span className="font-medium">{customerName ?? "—"}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground">{t("fields.title")}</span>
                <span className="truncate font-medium">{title}</span>
              </div>
            </div>

            <Field label={t("fields.invoiceDate")}>
              <DatePicker name="invoiceDate" defaultValue={todayISO()} />
            </Field>
            <Field label={t("fields.counterpartyTaxId")} htmlFor="inv-taxid">
              <Input
                id="inv-taxid"
                name="counterpartyTaxId"
                defaultValue={customerTaxId ?? ""}
                placeholder={tCommon("optional")}
              />
            </Field>

            <Field label={t("fields.basisLabel")}>
              <Select value={basis} onValueChange={(v) => setBasis(v as InvoiceBasis)}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="gross">{t("basis.gross")}</SelectItem>
                  <SelectItem value="net">{t("basis.net")}</SelectItem>
                  <SelectItem value="notax">{t("basis.notax")}</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field
              label={basis === "net" ? t("fields.netAmount") : t("fields.grossAmount")}
              htmlFor="inv-basis-amount"
            >
              <Input
                id="inv-basis-amount"
                type="number"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </Field>

            <div className="grid grid-cols-3 gap-2 rounded-lg border p-3 text-center sm:col-span-2">
              <div>
                <div className="text-xs text-muted-foreground">{t("summary.net")}</div>
                <div className="text-sm font-medium tabular-nums">
                  {formatCurrency(net, currency)}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">{t("summary.taxRate")}</div>
                <div className="text-sm font-medium tabular-nums">
                  {formatCurrency(tax, currency)}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">{t("summary.gross")}</div>
                <div className="text-sm font-medium tabular-nums">
                  {formatCurrency(gross, currency)}
                </div>
              </div>
            </div>

            <Field label={t("fields.externalRef")} htmlFor="inv-external-ref" wide>
              <Input
                id="inv-external-ref"
                name="externalRef"
                placeholder={t("fields.externalRefPlaceholder")}
              />
              <p className="text-xs text-muted-foreground">{t("fields.externalRefHint")}</p>
            </Field>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? t("dialog.creating") : t("dialog.create")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Receipt } from "lucide-react";
import { createInvoice, type ActionState } from "@/db/mutations";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

const initial: ActionState = { ok: false };

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * 看板上的「開發票」：把這一期的資料預填成一張發票草稿，存檔後回填開發票日。
 *
 * 只做本系統這一半 —— Simpany 那邊還是要人去開。所以外部狀態預設 pending，
 * 開好之後把 Simpany 的號碼填進來（或在發票頁補），對帳表才對得起來。
 *
 * 請款金額是未稅還是含稅，各家合約寫法不同，這裡讓人選，選了就即時換算。
 */
export function IssueInvoiceDialog({
  billingItemId,
  contractId,
  customerName,
  customerTaxId,
  title,
  expected,
  currency,
}: Readonly<{
  billingItemId: number;
  contractId: number | null;
  customerName: string | null;
  customerTaxId: string | null;
  title: string;
  expected: number;
  currency: string;
}>) {
  const [open, setOpen] = React.useState(false);
  const [basis, setBasis] = React.useState<"gross" | "net">("gross");
  const [amount, setAmount] = React.useState(String(expected));
  const router = useRouter();

  const value = Number(amount) || 0;
  const { net, tax, gross } =
    basis === "gross"
      ? { ...splitGross(value), gross: value }
      : { net: value, ...grossFromNet(value) };

  // 走 submitAction 而不是 <form action>：失敗時 React 不會把剛填的欄位清空
  // （見 @/lib/form-action 的說明）。
  const [, action, pending] = React.useActionState(
    async (prev: ActionState, formData: FormData) => {
      const res = await createInvoice(prev, formData);
      if (res.ok) {
        setOpen(false);
        toast.success("已建立發票，記得到 Simpany 實際開立");
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
          <Receipt className="size-4" /> 開發票
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <form onSubmit={submitAction(action)}>
          <DialogHeader>
            <DialogTitle>開發票</DialogTitle>
            <DialogDescription>
              已用這一期的資料預填。存檔後這一期的「待開立」會消掉，並列進 Simpany 對帳。
            </DialogDescription>
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

          <div className="grid gap-4 py-4 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2 rounded-lg border bg-muted/30 p-3 text-sm">
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground">客戶</span>
                <span className="font-medium">{customerName ?? "—"}</span>
              </div>
              <div className="flex justify-between gap-2">
                <span className="text-muted-foreground">品名</span>
                <span className="truncate font-medium">{title}</span>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>發票日期</Label>
              <DatePicker name="invoiceDate" defaultValue={todayISO()} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="inv-taxid">對象統編</Label>
              <Input
                id="inv-taxid"
                name="counterpartyTaxId"
                defaultValue={customerTaxId ?? ""}
                placeholder="選填"
              />
            </div>

            <div className="space-y-1.5">
              <Label>金額基準</Label>
              <Select value={basis} onValueChange={(v) => setBasis(v as "gross" | "net")}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="gross">請款金額為含稅</SelectItem>
                  <SelectItem value="net">請款金額為未稅</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="inv-basis-amount">
                {basis === "gross" ? "含稅金額" : "未稅金額"}
              </Label>
              <Input
                id="inv-basis-amount"
                type="number"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>

            <div className="grid grid-cols-3 gap-2 rounded-lg border p-3 text-center sm:col-span-2">
              <div>
                <div className="text-xs text-muted-foreground">未稅</div>
                <div className="text-sm font-medium tabular-nums">
                  {formatCurrency(net, currency)}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">稅額 5%</div>
                <div className="text-sm font-medium tabular-nums">
                  {formatCurrency(tax, currency)}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">含稅</div>
                <div className="text-sm font-medium tabular-nums">
                  {formatCurrency(gross, currency)}
                </div>
              </div>
            </div>

            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="inv-external-ref">Simpany 發票號碼</Label>
              <Input
                id="inv-external-ref"
                name="externalRef"
                placeholder="還沒開就留空，之後在發票頁或對帳時補"
              />
              <p className="text-xs text-muted-foreground">
                填了就視為 Simpany 已開立；留空則列進「該開未開」，開完再回來補號碼。
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "建立中…" : "建立發票"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import { useActionState, useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { createReimbursement, type ActionState } from "@/db/mutations";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/format";
import { Field, SelectField } from "@/components/form-field";
import { SelectItem } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { DatePicker } from "@/components/date-picker";
import { submitAction } from "@/lib/form-action";

const initial: ActionState = { ok: false };

export function RecordReimbursementDialog({
  advance,
  accounts,
}: Readonly<{
  advance: { id: number; settleName: string; amount: string; currency: string; vendorName: string };
  accounts: { id: number; name: string; currency: string }[];
}>) {
  const t = useTranslations("advances");
  const [open, setOpen] = useState(false);
  const today = new Date().toISOString().slice(0, 10);
  // 撥款交易的幣別直接沿用原代墊，而交易幣別必須等於付款帳戶的幣別
  // （見 @/lib/account-currency），所以這裡只列得出同幣別的帳戶。
  const payable = accounts.filter((a) => a.currency === advance.currency);

  // 成功/失敗處理放在 action 內（跑在 transition 裡），不用 useEffect ——
  // 既避免 effect 內 setState 的串聯 render，也讓每次送出都必定各吐一次 toast
  // （舊寫法依賴 [state] 變化，連續兩次同樣的錯誤不會再跳）。
  const [, action, pending] = useActionState(
    async (prev: ActionState, formData: FormData) => {
      const res = await createReimbursement(prev, formData);
      if (res.ok) {
        setOpen(false);
        toast.success(t("toast.recorded"));
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
        <Button size="sm" variant="outline">
          {t("recordButton")}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submitAction(action)}>
          <input type="hidden" name="advanceId" value={advance.id} />
          <DialogHeader>
            <DialogTitle>{t("dialog.title")}</DialogTitle>
            <DialogDescription>
              {t("dialog.description", {
                settleName: advance.settleName || t("defaultPayer"),
                vendorName: advance.vendorName || "—",
              })}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <Field label={t("dialog.payDate")} required>
              <DatePicker name="payDate" defaultValue={today} />
            </Field>
            <div className="space-y-1.5">
              <SelectField
                name="fromAccountId"
                label={t("dialog.fromAccount")}
                required
                placeholder={t("dialog.fromAccountPlaceholder")}
              >
                {payable.map((a) => (
                  <SelectItem key={a.id} value={String(a.id)}>
                    {t("accountOption", { name: a.name, currency: a.currency })}
                  </SelectItem>
                ))}
              </SelectField>
              <p
                className={
                  payable.length === 0 ? "text-xs text-destructive" : "text-xs text-muted-foreground"
                }
              >
                {payable.length === 0
                  ? t("dialog.noMatchingAccount", { currency: advance.currency })
                  : t("dialog.fromAccountHint", { currency: advance.currency })}
              </p>
            </div>
            <Field label={t("dialog.amountLabel")}>
              <div className="flex h-9 items-center rounded-md border bg-muted px-3 text-sm text-muted-foreground">
                {formatCurrency(advance.amount, advance.currency)}
              </div>
              <input type="hidden" name="amount" value={advance.amount} />
            </Field>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? t("dialog.saving") : t("dialog.confirm")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

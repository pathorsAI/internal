"use client";

import { useActionState, useState } from "react";
import { toast } from "sonner";
import { createReimbursement, type ActionState } from "@/db/mutations";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/format";
import { Label } from "@/components/ui/label";
import { Req } from "@/components/req";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  const [open, setOpen] = useState(false);
  const today = new Date().toISOString().slice(0, 10);

  // 成功/失敗處理放在 action 內（跑在 transition 裡），不用 useEffect ——
  // 既避免 effect 內 setState 的串聯 render，也讓每次送出都必定各吐一次 toast
  // （舊寫法依賴 [state] 變化，連續兩次同樣的錯誤不會再跳）。
  const [, action, pending] = useActionState(
    async (prev: ActionState, formData: FormData) => {
      const res = await createReimbursement(prev, formData);
      if (res.ok) {
        setOpen(false);
        toast.success("已記錄撥款");
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
          記錄撥款
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submitAction(action)}>
          <input type="hidden" name="advanceId" value={advance.id} />
          <DialogHeader>
            <DialogTitle>記錄撥款</DialogTitle>
            <DialogDescription>
              還給 {advance.settleName || "代墊人"}（原費用：{advance.vendorName || "—"}）
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="space-y-1.5">
              <Label>撥款日期<Req /></Label>
              <DatePicker name="payDate" defaultValue={today} />
            </div>
            <div className="space-y-1.5">
              <Label>付款帳戶<Req /></Label>
              <Select name="fromAccountId" required>
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
            <div className="space-y-1.5">
              <Label>金額（依代墊，不可改）</Label>
              <div className="flex h-9 items-center rounded-md border bg-muted px-3 text-sm text-muted-foreground">
                {formatCurrency(advance.amount, advance.currency)}
              </div>
              <input type="hidden" name="amount" value={advance.amount} />
            </div>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "儲存中…" : "確認撥款"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

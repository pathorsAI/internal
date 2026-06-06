"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { createReimbursement, type ActionState } from "@/db/mutations";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/format";
import { Label, Req } from "@/components/ui/label";
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

const initial: ActionState = { ok: false };

export function RecordReimbursementDialog({
  advance,
  accounts,
}: Readonly<{
  advance: { id: number; settleName: string; amount: string; currency: string; vendorName: string };
  accounts: { id: number; name: string; currency: string }[];
}>) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(createReimbursement, initial);
  const today = new Date().toISOString().slice(0, 10);
  const accountItems = Object.fromEntries(
    accounts.map((a) => [String(a.id), `${a.name}（${a.currency}）`]),
  );

  useEffect(() => {
    if (state.ok) {
      setOpen(false);
      toast.success("已記錄撥款");
    }
  }, [state]);
  useEffect(() => {
    if (state.error) toast.error(state.error);
  }, [state]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" variant="outline" />}>記錄撥款</DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form action={action}>
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
              <Select name="fromAccountId" items={accountItems} required>
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

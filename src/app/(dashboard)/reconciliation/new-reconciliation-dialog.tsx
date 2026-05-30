"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { createReconciliation, type ActionState } from "@/db/mutations";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

const initial: ActionState = { ok: false };
const selectCls =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

export function NewReconciliationDialog({
  accounts,
}: {
  accounts: { id: number; name: string; currency: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(createReconciliation, initial);
  const today = new Date().toISOString().slice(0, 10);

  useEffect(() => {
    if (state.ok) {
      setOpen(false);
      toast.success("已新增對帳紀錄");
    }
  }, [state]);
  useEffect(() => {
    if (state.error) toast.error(state.error);
  }, [state]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" />}>
        <Plus className="size-4" /> 新增對帳
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form action={action}>
          <DialogHeader>
            <DialogTitle>新增對帳紀錄</DialogTitle>
            <DialogDescription>
              填入該帳戶在截止日的實際餘額，系統會自動與帳面餘額比對差額
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="space-y-1.5">
              <Label htmlFor="accountId">帳戶 *</Label>
              <select id="accountId" name="accountId" className={selectCls} required defaultValue="">
                <option value="" disabled>
                  — 請選擇 —
                </option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}（{a.currency}）
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="asOfDate">截止日期 *</Label>
              <Input id="asOfDate" name="asOfDate" type="date" required defaultValue={today} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="statementBalance">對帳單實際餘額 *</Label>
              <Input
                id="statementBalance"
                name="statementBalance"
                type="number"
                step="0.01"
                required
                placeholder="銀行 / 帳戶顯示的餘額"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="note">備註</Label>
              <Input id="note" name="note" placeholder="選填" />
            </div>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "儲存中…" : "儲存"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

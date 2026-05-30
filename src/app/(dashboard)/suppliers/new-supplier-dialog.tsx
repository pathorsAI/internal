"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { createSupplier, type ActionState } from "@/db/mutations";
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

export function NewSupplierDialog({
  accounts,
}: {
  accounts: { id: number; name: string; currency: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(createSupplier, initial);

  useEffect(() => {
    if (state.ok) {
      setOpen(false);
      toast.success("已新增供應商");
    }
  }, [state]);
  useEffect(() => {
    if (state.error) toast.error(state.error);
  }, [state]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" />}>
        <Plus className="size-4" /> 新增供應商
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <form action={action}>
          <DialogHeader>
            <DialogTitle>新增供應商</DialogTitle>
            <DialogDescription>每月固定收款的廠商資料</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="name">名稱 *</Label>
              <Input id="name" name="name" required placeholder="例：AWS、房東、會計師事務所" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="taxId">統一編號</Label>
              <Input id="taxId" name="taxId" placeholder="選填" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="defaultCurrency">預設幣別</Label>
              <select id="defaultCurrency" name="defaultCurrency" className={selectCls} defaultValue="TWD">
                {["TWD", "USD", "EUR", "JPY", "CNY"].map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="defaultAccountId">預設收款帳戶</Label>
              <select id="defaultAccountId" name="defaultAccountId" className={selectCls} defaultValue="">
                <option value="">— 未指定 —</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}（{a.currency}）
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="typicalAmount">慣常金額</Label>
              <Input id="typicalAmount" name="typicalAmount" type="number" step="0.01" placeholder="選填" />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="contact">聯絡資訊</Label>
              <Input id="contact" name="contact" placeholder="選填" />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
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

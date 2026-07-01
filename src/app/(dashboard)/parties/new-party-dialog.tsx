"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { createParty, type ActionState } from "@/db/mutations";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Req } from "@/components/req";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CurrencySelect } from "@/components/currency-select";
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

export function NewPartyDialog({
  accounts,
}: Readonly<{
  accounts: { id: number; name: string; currency: string }[];
}>) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(createParty, initial);

  useEffect(() => {
    if (state.ok) {
      setOpen(false);
      toast.success("已新增交易對象");
    }
  }, [state]);
  useEffect(() => {
    if (state.error) toast.error(state.error);
  }, [state]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="size-4" /> 新增交易對象
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <form action={action}>
          <DialogHeader>
            <DialogTitle>新增交易對象</DialogTitle>
            <DialogDescription>往來的廠商、客戶或機關</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="name">名稱<Req /></Label>
              <Input id="name" name="name" required placeholder="例：AWS、美國客戶、健保署" />
            </div>
            <div className="space-y-1.5">
              <Label>類型</Label>
              <Select name="label" defaultValue="vendor">
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="vendor">廠商</SelectItem>
                  <SelectItem value="customer">客戶</SelectItem>
                  <SelectItem value="gov">政府機關</SelectItem>
                  <SelectItem value="other">其他</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="taxId">統一編號</Label>
              <Input id="taxId" name="taxId" placeholder="選填" />
            </div>
            <div className="space-y-1.5">
              <Label>預設幣別</Label>
              <CurrencySelect name="defaultCurrency" />
            </div>
            <div className="space-y-1.5">
              <Label>預設帳戶</Label>
              <Select name="defaultAccountId">
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="— 未指定 —" />
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

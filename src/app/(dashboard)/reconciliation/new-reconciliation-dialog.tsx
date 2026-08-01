"use client";

import { useActionState, useState } from "react";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { createReconciliation, type ActionState } from "@/db/mutations";
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

export function NewReconciliationDialog({
  accounts,
}: {
  accounts: { id: number; name: string; currency: string }[];
}) {
  const [open, setOpen] = useState(false);
  const today = new Date().toISOString().slice(0, 10);

  // 成功/失敗處理放在 action 內（跑在 transition 裡），不用 useEffect ——
  // 既避免 effect 內 setState 的串聯 render，也讓每次送出都必定各吐一次 toast
  // （舊寫法依賴 [state] 變化，連續兩次同樣的錯誤不會再跳）。
  const [, action, pending] = useActionState(
    async (prev: ActionState, formData: FormData) => {
      const res = await createReconciliation(prev, formData);
      if (res.ok) {
        setOpen(false);
        toast.success("已新增對帳紀錄");
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
        <Button size="sm">
          <Plus className="size-4" /> 新增對帳
        </Button>
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
              <Label>帳戶<Req /></Label>
              <Select name="accountId" required>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="— 請選擇 —" />
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
              <Label>截止日期<Req /></Label>
              <DatePicker name="asOfDate" defaultValue={today} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="statementBalance">對帳單實際餘額<Req /></Label>
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

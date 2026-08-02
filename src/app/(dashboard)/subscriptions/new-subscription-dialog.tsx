"use client";

import { useActionState, useState } from "react";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { createSubscription, type ActionState } from "@/db/mutations";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Req } from "@/components/req";
import { DatePicker } from "@/components/date-picker";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CurrencySelect } from "@/components/currency-select";
import { PartyField } from "@/components/party-combobox";
import { submitAction } from "@/lib/form-action";
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

export function NewSubscriptionDialog({
  parties,
  projects,
}: Readonly<{
  parties: { id: number; name: string }[];
  projects: { id: number; name: string }[];
}>) {
  const [open, setOpen] = useState(false);
  // 成功/失敗處理放在 action 內（跑在 transition 裡），不用 useEffect ——
  // 既避免 effect 內 setState 的串聯 render，也讓每次送出都必定各吐一次 toast
  // （舊寫法依賴 [state] 變化，連續兩次同樣的錯誤不會再跳）。
  const [, action, pending] = useActionState(
    async (prev: ActionState, formData: FormData) => {
      const res = await createSubscription(prev, formData);
      if (res.ok) {
        setOpen(false);
        toast.success("已新增訂閱");
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
          <Plus className="size-4" /> 新增訂閱
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <form onSubmit={submitAction(action)}>
          <DialogHeader>
            <DialogTitle>新增訂閱 / 月費</DialogTitle>
            <DialogDescription>客戶定期收費的方案，「每隔幾個月收一次」</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4 sm:grid-cols-2">
            <PartyField parties={parties} name="customerPartyName" required />
            <div className="space-y-1.5">
              <Label>專案</Label>
              <Select name="projectId">
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="— 未指定 —" />
                </SelectTrigger>
                <SelectContent>
                  {projects.map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="name">方案名稱<Req /></Label>
              <Input id="name" name="name" required placeholder="例：基礎月費、維運合約" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="amount">金額<Req /></Label>
              <Input id="amount" name="amount" type="number" step="0.01" required />
            </div>
            <div className="space-y-1.5">
              <Label>幣別</Label>
              <CurrencySelect />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="intervalMonths">每隔幾個月收一次</Label>
              <Input id="intervalMonths" name="intervalMonths" type="number" min="1" defaultValue="1" />
            </div>
            <div className="space-y-1.5">
              <Label>狀態</Label>
              <Select
                name="status"
                defaultValue="active"
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">進行中</SelectItem>
                  <SelectItem value="paused">暫停</SelectItem>
                  <SelectItem value="ended">結束</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>開始日期<Req /></Label>
              <DatePicker name="startDate" />
            </div>
            <div className="space-y-1.5">
              <Label>結束日期</Label>
              <DatePicker name="endDate" allowEmpty placeholder="— 無 —" />
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

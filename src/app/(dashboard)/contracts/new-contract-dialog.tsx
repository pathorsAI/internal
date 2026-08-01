"use client";

import { useActionState, useState } from "react";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { createContract, type ActionState } from "@/db/mutations";
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

export function NewContractDialog({
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
      const res = await createContract(prev, formData);
      if (res.ok) {
        setOpen(false);
        toast.success("已新增合約");
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
          <Plus className="size-4" /> 新增合約
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <form action={action}>
          <DialogHeader>
            <DialogTitle>新增合約</DialogTitle>
            <DialogDescription>客戶合約，可連結到專案</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>客戶<Req /></Label>
              <Select name="customerPartyId">
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="選擇客戶" />
                </SelectTrigger>
                <SelectContent>
                  {parties.map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
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
              <Label htmlFor="title">合約名稱<Req /></Label>
              <Input id="title" name="title" required placeholder="例：2026 年度維運合約" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="amount">合約金額</Label>
              <Input id="amount" name="amount" type="number" step="0.01" placeholder="選填" />
            </div>
            <div className="space-y-1.5">
              <Label>幣別</Label>
              <CurrencySelect />
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
                  <SelectItem value="draft">草稿</SelectItem>
                  <SelectItem value="active">進行中</SelectItem>
                  <SelectItem value="completed">已完成</SelectItem>
                  <SelectItem value="cancelled">已取消</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>簽約日</Label>
              <DatePicker name="signedDate" allowEmpty placeholder="— 無 —" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="paymentTermsDays">付款條件（天）</Label>
              <Input
                id="paymentTermsDays"
                name="paymentTermsDays"
                type="number"
                min="0"
                placeholder="月結 30 天 → 30"
              />
            </div>
            <div className="space-y-1.5">
              <Label>開始日期</Label>
              <DatePicker name="startDate" allowEmpty placeholder="— 無 —" />
            </div>
            <div className="space-y-1.5">
              <Label>結束日期</Label>
              <DatePicker name="endDate" allowEmpty placeholder="— 無 —" />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="note">備註</Label>
              <Input id="note" name="note" placeholder="選填" />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="fileUrl">合約檔案連結</Label>
              <Input
                id="fileUrl"
                name="fileUrl"
                type="url"
                placeholder="https://drive.google.com/… （選填）"
              />
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

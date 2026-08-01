"use client";

import { useActionState, useState } from "react";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { createProject, type ActionState } from "@/db/mutations";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { submitAction } from "@/lib/form-action";
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

const initial: ActionState = { ok: false };

export function NewProjectDialog({
  parties,
}: Readonly<{
  parties: { id: number; name: string }[];
}>) {
  const [open, setOpen] = useState(false);
  // 成功/失敗處理放在 action 內（跑在 transition 裡），不用 useEffect ——
  // 既避免 effect 內 setState 的串聯 render，也讓每次送出都必定各吐一次 toast
  // （舊寫法依賴 [state] 變化，連續兩次同樣的錯誤不會再跳）。
  const [, action, pending] = useActionState(
    async (prev: ActionState, formData: FormData) => {
      const res = await createProject(prev, formData);
      if (res.ok) {
        setOpen(false);
        toast.success("已新增專案");
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
          <Plus className="size-4" /> 新增專案
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submitAction(action)}>
          <DialogHeader>
            <DialogTitle>新增專案</DialogTitle>
            <DialogDescription>專案的收支由交易上的「專案」欄位彙總</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="name">專案名稱<Req /></Label>
              <Input id="name" name="name" required placeholder="例：官網改版、A 客戶系統" />
            </div>
            <div className="space-y-1.5">
              <Label>客戶</Label>
              <Select name="clientPartyId">
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="— 未指定 —" />
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
              <Label>狀態</Label>
              <Select name="status" defaultValue="active">
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">進行中</SelectItem>
                  <SelectItem value="archived">封存</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="description">說明</Label>
              <Input id="description" name="description" placeholder="選填" />
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

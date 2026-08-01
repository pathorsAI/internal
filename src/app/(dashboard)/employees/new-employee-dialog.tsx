"use client";

import { useActionState, useState } from "react";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { createEmployee, type ActionState } from "@/db/mutations";
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
import type { MemberOption } from "./edit-employee-form";

const initial: ActionState = { ok: false };
const typeItems: Record<string, string> = {
  full_time: "正職",
  part_time: "兼職",
  freelancer: "自由",
  contractor: "承攬",
};

export function NewEmployeeDialog({ members }: Readonly<{ members: MemberOption[] }>) {
  const [open, setOpen] = useState(false);
  // 成功/失敗處理放在 action 內（跑在 transition 裡），不用 useEffect ——
  // 既避免 effect 內 setState 的串聯 render，也讓每次送出都必定各吐一次 toast
  // （舊寫法依賴 [state] 變化，連續兩次同樣的錯誤不會再跳）。
  const [, action, pending] = useActionState(
    async (prev: ActionState, formData: FormData) => {
      const res = await createEmployee(prev, formData);
      if (res.ok) {
        setOpen(false);
        toast.success("已新增員工");
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
          <Plus className="size-4" /> 新增員工
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <form action={action} className="grid gap-4 sm:grid-cols-2">
          <DialogHeader className="sm:col-span-2">
            <DialogTitle>新增員工</DialogTitle>
            <DialogDescription>正職、兼職、自由工作者或承攬皆可</DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5">
            <Label htmlFor="name">姓名<Req /></Label>
            <Input id="name" name="name" required placeholder="員工姓名" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="nationalId">身分證 / 統編</Label>
            <Input id="nationalId" name="nationalId" placeholder="選填" />
          </div>
          <div className="space-y-1.5">
            <Label>雇用類型</Label>
            <Select name="employmentType" defaultValue="full_time">
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(typeItems).map(([v, l]) => (
                  <SelectItem key={v} value={v}>
                    {l}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="baseSalary">底薪</Label>
            <Input id="baseSalary" name="baseSalary" type="number" step="0.01" placeholder="選填" />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="salaryAccount">薪資戶</Label>
            <Input
              id="salaryAccount"
              name="salaryAccount"
              placeholder="例：永豐銀行 帳號末四碼 1234"
            />
          </div>
          <div className="space-y-3 rounded-lg border p-3 sm:col-span-2">
            <div className="text-sm font-medium">聯絡資訊</div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="workEmail" className="text-xs text-muted-foreground">
                  工作 Email
                </Label>
                <Input id="workEmail" name="workEmail" type="email" placeholder="選填" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="personalEmail" className="text-xs text-muted-foreground">
                  聯絡 Email
                </Label>
                <Input id="personalEmail" name="personalEmail" type="email" placeholder="選填" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="phone" className="text-xs text-muted-foreground">
                  電話
                </Label>
                <Input id="phone" name="phone" placeholder="選填" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">綁定登入使用者（選填）</Label>
                <Select name="userId" defaultValue="none">
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">不綁定（僅名冊紀錄）</SelectItem>
                    {members.map((m) => (
                      <SelectItem key={m.userId} value={m.userId}>
                        {m.name}（{m.email}）
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="note" className="text-xs text-muted-foreground">
                備註
              </Label>
              <Input id="note" name="note" placeholder="選填" />
            </div>
          </div>
          <div className="space-y-3 rounded-lg border p-3 sm:col-span-2">
            <div className="text-sm font-medium">勞健保投保（記錄保多少；之後再依此試算保費）</div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="laborInsuredSalary" className="text-xs text-muted-foreground">
                  勞保投保薪資
                </Label>
                <Input id="laborInsuredSalary" name="laborInsuredSalary" type="number" step="0.01" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="healthInsuredSalary" className="text-xs text-muted-foreground">
                  健保投保薪資
                </Label>
                <Input id="healthInsuredSalary" name="healthInsuredSalary" type="number" step="0.01" />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="hasPension" className="size-4 accent-primary" />
              <span>有提撥勞退（股東可不勾）</span>
            </label>
          </div>
          <div className="space-y-1.5">
            <Label>到職日</Label>
            <DatePicker name="startDate" allowEmpty />
          </div>
          <div className="space-y-1.5">
            <Label>離職日</Label>
            <DatePicker name="endDate" allowEmpty />
          </div>

          <DialogFooter className="sm:col-span-2">
            <Button type="submit" disabled={pending}>
              {pending ? "儲存中…" : "儲存"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

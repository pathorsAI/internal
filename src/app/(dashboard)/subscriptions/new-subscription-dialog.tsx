"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { createSubscription, type ActionState } from "@/db/mutations";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label, Req } from "@/components/ui/label";
import { DatePicker } from "@/components/date-picker";
import { PartyCombobox } from "@/components/party-combobox";
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
const currencyList = ["TWD", "USD", "EUR", "JPY", "CNY"];
const currencyItems = Object.fromEntries(currencyList.map((c) => [c, c]));

export function NewSubscriptionDialog({
  parties,
  projects,
}: Readonly<{
  parties: { id: number; name: string }[];
  projects: { id: number; name: string }[];
}>) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(createSubscription, initial);
  const projectItems = Object.fromEntries(projects.map((p) => [String(p.id), p.name]));

  useEffect(() => {
    if (state.ok) {
      setOpen(false);
      toast.success("已新增訂閱");
    }
  }, [state]);
  useEffect(() => {
    if (state.error) toast.error(state.error);
  }, [state]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" />}>
        <Plus className="size-4" /> 新增訂閱
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <form action={action}>
          <DialogHeader>
            <DialogTitle>新增訂閱 / 月費</DialogTitle>
            <DialogDescription>客戶定期收費的方案，「每隔幾個月收一次」</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>客戶<Req /></Label>
              <PartyCombobox parties={parties} name="customerPartyName" placeholder="輸入或選擇客戶…" />
            </div>
            <div className="space-y-1.5">
              <Label>專案</Label>
              <Select name="projectId" items={projectItems}>
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
              <Select name="currency" items={currencyItems} defaultValue="TWD">
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {currencyList.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="intervalMonths">每隔幾個月收一次</Label>
              <Input id="intervalMonths" name="intervalMonths" type="number" min="1" defaultValue="1" />
            </div>
            <div className="space-y-1.5">
              <Label>狀態</Label>
              <Select
                name="status"
                items={{ active: "進行中", paused: "暫停", ended: "結束" }}
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

"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { createReceivable, type ActionState } from "@/db/mutations";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label, Req } from "@/components/ui/label";
import { DatePicker } from "@/components/date-picker";
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

type Opt = { id: number; name: string };

export function NewReceivableDialog({
  parties,
  projects,
  contracts,
  subscriptions,
}: Readonly<{
  parties: Opt[];
  projects: Opt[];
  contracts: Opt[];
  subscriptions: Opt[];
}>) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(createReceivable, initial);
  const partyItems = Object.fromEntries(parties.map((p) => [String(p.id), p.name]));
  const projectItems = Object.fromEntries(projects.map((p) => [String(p.id), p.name]));
  const contractItems = Object.fromEntries(contracts.map((p) => [String(p.id), p.name]));
  const subscriptionItems = Object.fromEntries(subscriptions.map((p) => [String(p.id), p.name]));

  useEffect(() => {
    if (state.ok) {
      setOpen(false);
      toast.success("已新增應收帳款");
    }
  }, [state]);
  useEffect(() => {
    if (state.error) toast.error(state.error);
  }, [state]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size="sm" />}>
        <Plus className="size-4" /> 新增應收帳款
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <form action={action}>
          <DialogHeader>
            <DialogTitle>新增應收帳款</DialogTitle>
            <DialogDescription>待客戶支付的款項，可連結合約 / 訂閱 / 專案</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>客戶<Req /></Label>
              <Select name="customerPartyId" items={partyItems}>
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
            <div className="space-y-1.5">
              <Label>合約</Label>
              <Select name="contractId" items={contractItems}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="— 未指定 —" />
                </SelectTrigger>
                <SelectContent>
                  {contracts.map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>訂閱</Label>
              <Select name="subscriptionId" items={subscriptionItems}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="— 未指定 —" />
                </SelectTrigger>
                <SelectContent>
                  {subscriptions.map((p) => (
                    <SelectItem key={p.id} value={String(p.id)}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
              <Label>到期日</Label>
              <DatePicker name="dueDate" allowEmpty placeholder="— 無 —" />
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

"use client";

import { useActionState, useEffect } from "react";
import { toast } from "sonner";
import { updateReceivable, type ActionState } from "@/db/mutations";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label, Req } from "@/components/ui/label";
import { DatePicker } from "@/components/date-picker";
import { DialogFooter } from "@/components/ui/dialog";
import { useRowDialogClose } from "@/components/row-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const initial: ActionState = { ok: false };
const currencyList = ["TWD", "USD", "EUR", "JPY", "CNY"];
const currencyItems = Object.fromEntries(currencyList.map((c) => [c, c]));

type Opt = { id: number; name: string };
type Receivable = {
  id: number;
  customerPartyId: number;
  projectId: number | null;
  contractId: number | null;
  subscriptionId: number | null;
  description: string | null;
  amount: string;
  currency: string;
  dueDate: string | null;
};

export function EditReceivableForm({
  receivable,
  parties,
  projects,
  contracts,
  subscriptions,
  footer,
  readOnly,
}: Readonly<{
  receivable: Receivable;
  parties: Opt[];
  projects: Opt[];
  contracts: Opt[];
  subscriptions: Opt[];
  footer?: React.ReactNode;
  readOnly?: boolean;
}>) {
  const [state, action, pending] = useActionState(updateReceivable, initial);
  const partyItems = Object.fromEntries(parties.map((p) => [String(p.id), p.name]));
  const projectItems = Object.fromEntries(projects.map((p) => [String(p.id), p.name]));
  const contractItems = Object.fromEntries(contracts.map((p) => [String(p.id), p.name]));
  const subscriptionItems = Object.fromEntries(subscriptions.map((p) => [String(p.id), p.name]));

  const close = useRowDialogClose();
  useEffect(() => {
    if (state.ok) {
      toast.success("已更新");
      close();
    }
  }, [state]);
  useEffect(() => {
    if (state.error) toast.error(state.error);
  }, [state]);

  return (
    <form action={action} className="grid gap-4 sm:grid-cols-2">
      <input type="hidden" name="id" value={receivable.id} />

      {readOnly ? (
        <p className="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground sm:col-span-2">
          這筆已收款，無法再編輯。
        </p>
      ) : null}

      <div className="space-y-1.5">
        <Label>客戶<Req /></Label>
        <Select name="customerPartyId" items={partyItems} defaultValue={String(receivable.customerPartyId)}>
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
        <Select
          name="projectId"
          items={projectItems}
          defaultValue={receivable.projectId == null ? undefined : String(receivable.projectId)}
        >
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
        <Select
          name="contractId"
          items={contractItems}
          defaultValue={receivable.contractId == null ? undefined : String(receivable.contractId)}
        >
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
        <Select
          name="subscriptionId"
          items={subscriptionItems}
          defaultValue={receivable.subscriptionId == null ? undefined : String(receivable.subscriptionId)}
        >
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
        <Input id="amount" name="amount" type="number" step="0.01" required defaultValue={receivable.amount} />
      </div>
      <div className="space-y-1.5">
        <Label>幣別</Label>
        <Select name="currency" items={currencyItems} defaultValue={receivable.currency}>
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
        <DatePicker name="dueDate" allowEmpty placeholder="— 無 —" defaultValue={receivable.dueDate ?? undefined} />
      </div>
      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor="description">說明</Label>
        <Input id="description" name="description" defaultValue={receivable.description ?? ""} />
      </div>

      <DialogFooter className="mt-2 border-t pt-4 sm:col-span-2">
        {footer ? <div className="mr-auto">{footer}</div> : null}
        <Button type="button" variant="outline" onClick={close}>
          取消
        </Button>
        <Button type="submit" disabled={pending || readOnly}>
          {pending ? "儲存中…" : "儲存變更"}
        </Button>
      </DialogFooter>
    </form>
  );
}

"use client";

import { useActionState } from "react";
import { toast } from "sonner";
import { updateSubscription, type ActionState } from "@/db/mutations";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Req } from "@/components/req";
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
import { CurrencySelect } from "@/components/currency-select";
import { PartyField } from "@/components/party-combobox";
import { submitAction } from "@/lib/form-action";

const initial: ActionState = { ok: false };

type Subscription = {
  id: number;
  customerPartyId: number;
  /** 目前綁定的客戶名稱，給 PartyCombobox 預填 */
  customerName: string | null;
  projectId: number | null;
  name: string;
  amount: string;
  currency: string;
  intervalMonths: number;
  startDate: string;
  endDate: string | null;
  status: string;
  note: string | null;
};

export function EditSubscriptionForm({
  subscription,
  parties,
  projects,
  footer,
}: Readonly<{
  subscription: Subscription;
  parties: { id: number; name: string }[];
  projects: { id: number; name: string }[];
  footer?: React.ReactNode;
}>) {
  const close = useRowDialogClose();

  // 成功/失敗處理放在 action 內（跑在 transition 裡），不用 useEffect ——
  // 既避免 effect 內 setState 的串聯 render，也讓每次送出都必定各吐一次 toast
  // （舊寫法依賴 [state] 變化，連續兩次同樣的錯誤不會再跳）。
  const [, action, pending] = useActionState(
    async (prev: ActionState, formData: FormData) => {
      const res = await updateSubscription(prev, formData);
      if (res.ok) {
        toast.success("已更新");
        close();
      } else if (res.error) {
        toast.error(res.error);
      }
      return res;
    },
    initial,
  );

  return (
    <form onSubmit={submitAction(action)} className="grid gap-4 sm:grid-cols-2">
      <input type="hidden" name="id" value={subscription.id} />

      <PartyField
        parties={parties}
        name="customerPartyName"
        required
        defaultName={subscription.customerName ?? ""}
      />
      <div className="space-y-1.5">
        <Label>專案</Label>
        <Select
          name="projectId"
          defaultValue={subscription.projectId == null ? undefined : String(subscription.projectId)}
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
      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor="name">方案名稱<Req /></Label>
        <Input id="name" name="name" required defaultValue={subscription.name} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="amount">金額<Req /></Label>
        <Input id="amount" name="amount" type="number" step="0.01" required defaultValue={subscription.amount} />
      </div>
      <div className="space-y-1.5">
        <Label>幣別</Label>
        <CurrencySelect defaultValue={subscription.currency} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="intervalMonths">每隔幾個月收一次</Label>
        <Input
          id="intervalMonths"
          name="intervalMonths"
          type="number"
          min="1"
          defaultValue={subscription.intervalMonths}
        />
      </div>
      <div className="space-y-1.5">
        <Label>狀態</Label>
        <Select
          name="status"
          defaultValue={subscription.status}
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
        <DatePicker name="startDate" defaultValue={subscription.startDate} />
      </div>
      <div className="space-y-1.5">
        <Label>結束日期</Label>
        <DatePicker
          name="endDate"
          allowEmpty
          placeholder="— 無 —"
          defaultValue={subscription.endDate ?? undefined}
        />
      </div>
      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor="note">備註</Label>
        <Input id="note" name="note" defaultValue={subscription.note ?? ""} />
      </div>

      <DialogFooter className="mt-2 border-t pt-4 sm:col-span-2">
        {footer ? <div className="mr-auto">{footer}</div> : null}
        <Button type="button" variant="outline" onClick={close}>
          取消
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "儲存中…" : "儲存變更"}
        </Button>
      </DialogFooter>
    </form>
  );
}

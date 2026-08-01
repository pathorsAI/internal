"use client";

import { useActionState, useEffect } from "react";
import { toast } from "sonner";
import { updateContract, type ActionState } from "@/db/mutations";
import { formatCurrency } from "@/lib/format";
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

const initial: ActionState = { ok: false };

type Contract = {
  id: number;
  customerPartyId: number;
  projectId: number | null;
  title: string;
  amount: string | null;
  currency: string;
  startDate: string | null;
  endDate: string | null;
  signedDate: string | null;
  paymentTermsDays: number | null;
  status: string;
  note: string | null;
  fileUrl: string | null;
};

export function EditContractForm({
  contract,
  parties,
  projects,
  summary,
  extra,
  footer,
}: Readonly<{
  contract: Contract;
  parties: { id: number; name: string }[];
  projects: { id: number; name: string }[];
  summary?: { received: number; cost: number; remaining: number | null };
  /** 額外區塊（分期請款清單），由 Server Component 傳進來 */
  extra?: React.ReactNode;
  footer?: React.ReactNode;
}>) {
  const [state, action, pending] = useActionState(updateContract, initial);

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
      <input type="hidden" name="id" value={contract.id} />

      {summary && (
        <div className="grid grid-cols-3 gap-2 rounded-lg border bg-muted/30 p-3 text-center sm:col-span-2">
          <div>
            <div className="text-xs text-muted-foreground">已收</div>
            <div className="text-sm font-medium tabular-nums">
              {formatCurrency(summary.received, contract.currency)}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">未收</div>
            <div className="text-sm font-medium tabular-nums">
              {summary.remaining == null ? "—" : formatCurrency(summary.remaining, contract.currency)}
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">累計成本</div>
            <div className="text-sm font-medium tabular-nums">
              {formatCurrency(summary.cost, contract.currency)}
            </div>
          </div>
          <p className="col-span-3 text-xs text-muted-foreground">
            已收來自綁定此合約的收入交易；成本僅供參考，不從合約金額扣除。
          </p>
        </div>
      )}

      <div className="space-y-1.5">
        <Label>客戶<Req /></Label>
        <Select name="customerPartyId" defaultValue={String(contract.customerPartyId)}>
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
          defaultValue={contract.projectId == null ? undefined : String(contract.projectId)}
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
        <Label htmlFor="title">合約名稱<Req /></Label>
        <Input id="title" name="title" required defaultValue={contract.title} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="amount">合約金額</Label>
        <Input id="amount" name="amount" type="number" step="0.01" defaultValue={contract.amount ?? ""} />
      </div>
      <div className="space-y-1.5">
        <Label>幣別</Label>
        <CurrencySelect defaultValue={contract.currency} />
      </div>
      <div className="space-y-1.5">
        <Label>狀態</Label>
        <Select
          name="status"
          defaultValue={contract.status}
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
        <DatePicker name="signedDate" allowEmpty placeholder="— 無 —" defaultValue={contract.signedDate ?? undefined} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="paymentTermsDays">付款條件（天）</Label>
        <Input
          id="paymentTermsDays"
          name="paymentTermsDays"
          type="number"
          min="0"
          placeholder="月結 30 天 → 30"
          defaultValue={contract.paymentTermsDays ?? ""}
        />
      </div>
      <div className="space-y-1.5">
        <Label>開始日期</Label>
        <DatePicker name="startDate" allowEmpty placeholder="— 無 —" defaultValue={contract.startDate ?? undefined} />
      </div>
      <div className="space-y-1.5">
        <Label>結束日期</Label>
        <DatePicker name="endDate" allowEmpty placeholder="— 無 —" defaultValue={contract.endDate ?? undefined} />
      </div>
      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor="note">備註</Label>
        <Input id="note" name="note" defaultValue={contract.note ?? ""} />
      </div>
      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor="fileUrl">合約檔案連結</Label>
        <Input
          id="fileUrl"
          name="fileUrl"
          type="url"
          defaultValue={contract.fileUrl ?? ""}
          placeholder="https://drive.google.com/…"
        />
      </div>

      {extra}

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

"use client";

import { useActionState, useEffect } from "react";
import { toast } from "sonner";
import { updateReconciliation, type ActionState } from "@/db/mutations";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Req } from "@/components/req";
import { DialogFooter } from "@/components/ui/dialog";
import { useRowDialogClose } from "@/components/row-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { DatePicker } from "@/components/date-picker";

const initial: ActionState = { ok: false };

type Recon = {
  id: number;
  accountId: number;
  asOfDate: string;
  statementBalance: string;
  note: string | null;
};

export function EditReconciliationForm({
  recon,
  accounts,
  footer,
}: Readonly<{
  recon: Recon;
  accounts: { id: number; name: string; currency: string }[];
  footer?: React.ReactNode;
}>) {
  const [state, action, pending] = useActionState(updateReconciliation, initial);
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
      <input type="hidden" name="id" value={recon.id} />
      <div className="space-y-1.5 sm:col-span-2">
        <Label>帳戶<Req /></Label>
        <Select name="accountId" defaultValue={String(recon.accountId)} required>
          <SelectTrigger className="w-full">
            <SelectValue />
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
        <DatePicker name="asOfDate" defaultValue={recon.asOfDate} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="statementBalance">對帳單實際餘額<Req /></Label>
        <Input
          id="statementBalance"
          name="statementBalance"
          type="number"
          step="0.01"
          required
          defaultValue={recon.statementBalance}
        />
      </div>
      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor="note">備註</Label>
        <Input id="note" name="note" defaultValue={recon.note ?? ""} />
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

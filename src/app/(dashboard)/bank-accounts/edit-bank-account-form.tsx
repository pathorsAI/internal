"use client";

import { useActionState } from "react";
import { toast } from "sonner";
import { updateBankAccount, type ActionState } from "@/db/mutations";
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
import { CurrencySelect } from "@/components/currency-select";
import { submitAction } from "@/lib/form-action";

const initial: ActionState = { ok: false };
const kindItems: Record<string, string> = { bank: "銀行", wise: "Wise / 虛擬", cash: "現金" };

type Account = {
  id: number;
  name: string;
  kind: string;
  currency: string;
  openingBalance: string;
  isActive: boolean;
};

export function EditBankAccountForm({
  account,
  footer,
}: Readonly<{
  account: Account;
  footer?: React.ReactNode;
}>) {
  const close = useRowDialogClose();

  // 成功/失敗處理放在 action 內（跑在 transition 裡），不用 useEffect ——
  // 既避免 effect 內 setState 的串聯 render，也讓每次送出都必定各吐一次 toast
  // （舊寫法依賴 [state] 變化，連續兩次同樣的錯誤不會再跳）。
  const [, action, pending] = useActionState(
    async (prev: ActionState, formData: FormData) => {
      const res = await updateBankAccount(prev, formData);
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
      <input type="hidden" name="id" value={account.id} />
      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor="name">名稱<Req /></Label>
        <Input id="name" name="name" required defaultValue={account.name} />
      </div>
      <div className="space-y-1.5">
        <Label>類型</Label>
        <Select name="kind" defaultValue={account.kind}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(kindItems).map(([v, l]) => (
              <SelectItem key={v} value={v}>
                {l}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label>幣別</Label>
        <CurrencySelect defaultValue={account.currency} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="openingBalance">期初餘額</Label>
        <Input
          id="openingBalance"
          name="openingBalance"
          type="number"
          step="0.01"
          defaultValue={account.openingBalance}
        />
      </div>
      <label className="flex items-center gap-2 text-sm sm:col-span-2">
        <input type="checkbox" name="isActive" defaultChecked={account.isActive} className="size-4 accent-primary" />
        <span>啟用</span>
      </label>
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

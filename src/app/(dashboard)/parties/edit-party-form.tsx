"use client";

import { useActionState } from "react";
import { toast } from "sonner";
import { updateParty, type ActionState } from "@/db/mutations";
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

const initial: ActionState = { ok: false };

type Party = {
  id: number;
  name: string;
  label: string;
  taxId: string | null;
  defaultCurrency: string | null;
  defaultAccountId: number | null;
  typicalAmount: string | null;
  contact: string | null;
  note: string | null;
  isActive: boolean;
};

export function EditPartyForm({
  party,
  accounts,
  footer,
}: Readonly<{
  party: Party;
  accounts: { id: number; name: string; currency: string }[];
  footer?: React.ReactNode;
}>) {
  const close = useRowDialogClose();

  // 成功/失敗處理放在 action 內（跑在 transition 裡），不用 useEffect ——
  // 既避免 effect 內 setState 的串聯 render，也讓每次送出都必定各吐一次 toast
  // （舊寫法依賴 [state] 變化，連續兩次同樣的錯誤不會再跳）。
  const [, action, pending] = useActionState(
    async (prev: ActionState, formData: FormData) => {
      const res = await updateParty(prev, formData);
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
    <form action={action} className="grid gap-4 sm:grid-cols-2">
      <input type="hidden" name="id" value={party.id} />

      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor="name">名稱<Req /></Label>
        <Input id="name" name="name" required defaultValue={party.name} />
      </div>
      <div className="space-y-1.5">
        <Label>類型</Label>
        <Select name="label" defaultValue={party.label}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="vendor">廠商</SelectItem>
            <SelectItem value="customer">客戶</SelectItem>
            <SelectItem value="gov">政府機關</SelectItem>
            <SelectItem value="other">其他</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="taxId">統一編號</Label>
        <Input id="taxId" name="taxId" defaultValue={party.taxId ?? ""} />
      </div>
      <div className="space-y-1.5">
        <Label>預設幣別</Label>
        <CurrencySelect name="defaultCurrency" defaultValue={party.defaultCurrency ?? undefined} />
      </div>
      <div className="space-y-1.5">
        <Label>預設帳戶</Label>
        <Select
          name="defaultAccountId"
          defaultValue={party.defaultAccountId == null ? undefined : String(party.defaultAccountId)}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="— 未指定 —" />
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
        <Label htmlFor="typicalAmount">慣常金額</Label>
        <Input
          id="typicalAmount"
          name="typicalAmount"
          type="number"
          step="0.01"
          defaultValue={party.typicalAmount ?? ""}
        />
      </div>
      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor="contact">聯絡資訊</Label>
        <Input id="contact" name="contact" defaultValue={party.contact ?? ""} />
      </div>
      <div className="space-y-1.5 sm:col-span-2">
        <Label htmlFor="note">備註</Label>
        <Input id="note" name="note" defaultValue={party.note ?? ""} />
      </div>
      <label className="flex items-center gap-2 text-sm sm:col-span-2">
        <input type="checkbox" name="isActive" defaultChecked={party.isActive} className="size-4 accent-primary" />
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

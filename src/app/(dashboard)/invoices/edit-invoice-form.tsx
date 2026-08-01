"use client";

import { useActionState } from "react";
import { toast } from "sonner";
import { updateInvoice, type ActionState } from "@/db/mutations";
import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";
import { useRowDialogClose } from "@/components/row-dialog";
import { InvoiceFields, type InvoiceFormValues, type Option } from "./invoice-fields";

const initial: ActionState = { ok: false };

export function EditInvoiceForm({
  id,
  values,
  parties,
  contracts,
  billingItems,
  footer,
}: Readonly<{
  id: number;
  values: InvoiceFormValues;
  parties: Option[];
  contracts: Option[];
  billingItems: Option[];
  footer?: React.ReactNode;
}>) {
  const close = useRowDialogClose();

  // 成功/失敗處理放在 action 內（跑在 transition 裡），不用 useEffect ——
  // 既避免 effect 內 setState 的串聯 render，也讓每次送出都必定各吐一次 toast
  // （舊寫法依賴 [state] 變化，連續兩次同樣的錯誤不會再跳）。
  const [, action, pending] = useActionState(
    async (prev: ActionState, formData: FormData) => {
      const res = await updateInvoice(prev, formData);
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
      <input type="hidden" name="id" value={id} />
      <InvoiceFields
        parties={parties}
        contracts={contracts}
        billingItems={billingItems}
        values={values}
      />

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

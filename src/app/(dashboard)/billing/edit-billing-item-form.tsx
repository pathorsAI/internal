"use client";

import { useActionState } from "react";
import { toast } from "sonner";
import { updateBillingItem, type ActionState } from "@/db/mutations";
import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";
import { submitAction } from "@/lib/form-action";
import { useRowDialogClose } from "@/components/row-dialog";
import {
  BillingItemFields,
  type BillingItemFormValues,
  type Option,
} from "./billing-item-fields";

const initial: ActionState = { ok: false };

export function EditBillingItemForm({
  id,
  values,
  parties,
  contracts,
  projects,
  footer,
}: Readonly<{
  id: number;
  values: BillingItemFormValues;
  parties: Option[];
  contracts: Option[];
  projects: Option[];
  footer?: React.ReactNode;
}>) {
  const close = useRowDialogClose();

  // 成功/失敗處理放在 action 內（跑在 transition 裡），不用 useEffect ——
  // 既避免 effect 內 setState 的串聯 render，也讓每次送出都必定各吐一次 toast
  // （舊寫法依賴 [state] 變化，連續兩次同樣的錯誤不會再跳）。
  const [, action, pending] = useActionState(
    async (prev: ActionState, formData: FormData) => {
      const res = await updateBillingItem(prev, formData);
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
      <input type="hidden" name="id" value={id} />
      <BillingItemFields
        parties={parties}
        contracts={contracts}
        projects={projects}
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

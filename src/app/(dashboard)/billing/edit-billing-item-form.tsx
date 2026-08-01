"use client";

import { useActionState, useEffect } from "react";
import { toast } from "sonner";
import { updateBillingItem, type ActionState } from "@/db/mutations";
import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";
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
  const [state, action, pending] = useActionState(updateBillingItem, initial);
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

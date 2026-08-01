"use client";

import { useActionState, useEffect } from "react";
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
  const [state, action, pending] = useActionState(updateInvoice, initial);
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

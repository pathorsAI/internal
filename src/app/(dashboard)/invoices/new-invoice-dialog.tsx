"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { createInvoice, type ActionState } from "@/db/mutations";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { InvoiceFields, type Option } from "./invoice-fields";

const initial: ActionState = { ok: false };

export function NewInvoiceDialog({
  parties,
  contracts,
  billingItems,
}: Readonly<{ parties: Option[]; contracts: Option[]; billingItems: Option[] }>) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(createInvoice, initial);

  useEffect(() => {
    if (state.ok) {
      setOpen(false);
      toast.success("已新增發票");
    }
  }, [state]);
  useEffect(() => {
    if (state.error) toast.error(state.error);
  }, [state]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="size-4" /> 新增發票
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <form action={action}>
          <DialogHeader>
            <DialogTitle>新增發票</DialogTitle>
            <DialogDescription>
              綁定「對應請款項目」時，會自動把該筆的開發票日填上，看板的「待開發票」就會消掉。
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4 sm:grid-cols-2">
            <InvoiceFields parties={parties} contracts={contracts} billingItems={billingItems} />
          </div>

          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? "儲存中…" : "儲存"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

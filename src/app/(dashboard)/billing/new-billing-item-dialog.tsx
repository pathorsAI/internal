"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { createBillingItem, type ActionState } from "@/db/mutations";
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
import { BillingItemFields, type Option } from "./billing-item-fields";

const initial: ActionState = { ok: false };

export function NewBillingItemDialog({
  parties,
  contracts,
  projects,
  contractId,
  triggerLabel = "新增請款項目",
  triggerVariant = "default",
}: Readonly<{
  parties: Option[];
  contracts: Option[];
  projects: Option[];
  /** 從合約頁開啟時預設綁定的合約 */
  contractId?: number;
  triggerLabel?: string;
  triggerVariant?: "default" | "outline";
}>) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(createBillingItem, initial);

  useEffect(() => {
    if (state.ok) {
      setOpen(false);
      toast.success("已新增請款項目");
    }
  }, [state]);
  useEffect(() => {
    if (state.error) toast.error(state.error);
  }, [state]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant={triggerVariant}>
          <Plus className="size-4" /> {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <form action={action}>
          <DialogHeader>
            <DialogTitle>新增請款項目</DialogTitle>
            <DialogDescription>
              一次性合約分期、專案里程碑或臨時請款。週期性月費請用「訂閱 / 月費」。
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4 sm:grid-cols-2">
            {contractId != null && <input type="hidden" name="contractId" value={contractId} />}
            <BillingItemFields
              parties={parties}
              contracts={contracts}
              projects={projects}
              hideContract={contractId != null}
            />
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

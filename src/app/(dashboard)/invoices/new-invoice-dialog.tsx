"use client";

import { useActionState, useState } from "react";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { createInvoice, type ActionState } from "@/db/mutations";
import { submitAction } from "@/lib/form-action";
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
  // 成功/失敗處理放在 action 內（跑在 transition 裡），不用 useEffect ——
  // 既避免 effect 內 setState 的串聯 render，也讓每次送出都必定各吐一次 toast
  // （舊寫法依賴 [state] 變化，連續兩次同樣的錯誤不會再跳）。
  const [, action, pending] = useActionState(
    async (prev: ActionState, formData: FormData) => {
      const res = await createInvoice(prev, formData);
      if (res.ok) {
        setOpen(false);
        toast.success("已新增發票");
      } else if (res.error) {
        toast.error(res.error);
      }
      return res;
    },
    initial,
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="size-4" /> 新增發票
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <form onSubmit={submitAction(action)}>
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

"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { createBillingItem, type ActionState } from "@/db/mutations";
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
import { BillingItemFields, type Option } from "./billing-item-fields";

const initial: ActionState = { ok: false };

export function NewBillingItemDialog({
  parties,
  contracts,
  projects,
  contractId,
  triggerLabel,
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
  const t = useTranslations("billing");
  const [open, setOpen] = useState(false);
  // 成功/失敗處理放在 action 內（跑在 transition 裡），不用 useEffect ——
  // 既避免 effect 內 setState 的串聯 render，也讓每次送出都必定各吐一次 toast
  // （舊寫法依賴 [state] 變化，連續兩次同樣的錯誤不會再跳）。
  const [, action, pending] = useActionState(
    async (prev: ActionState, formData: FormData) => {
      const res = await createBillingItem(prev, formData);
      if (res.ok) {
        setOpen(false);
        toast.success(t("newItem.toast.created"));
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
        <Button size="sm" variant={triggerVariant}>
          <Plus className="size-4" /> {triggerLabel ?? t("newItem.trigger")}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <form onSubmit={submitAction(action)}>
          <DialogHeader>
            <DialogTitle>{t("newItem.dialog.title")}</DialogTitle>
            <DialogDescription>{t("newItem.dialog.description")}</DialogDescription>
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
              {pending ? t("common.saving") : t("newItem.dialog.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

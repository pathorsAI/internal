"use client";

import { useActionState, useState, type ReactNode } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";

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
import type { ActionState } from "@/db/mutations";
import { submitAction } from "@/lib/form-action";
import { cn } from "@/lib/utils";

/**
 * 「新增某某」對話框的外殼 —— `RowDialog` 負責編輯，這支負責新增。
 *
 * 八個資源頁的新增流程本來各自抄一份同樣的骨架：開關狀態、把 server action 包成
 * 成功就關窗 + 跳 toast、Dialog / trigger / form / header / footer 的排版。欄位才是
 * 每頁真正不同的地方，所以外殼收在這裡，欄位當 children 傳進來。
 *
 * 成功/失敗處理放在 action 內（跑在 transition 裡），不用 useEffect —— 既避免
 * effect 內 setState 的串聯 render，也讓每次送出都必定各吐一次 toast（舊寫法依賴
 * [state] 變化，連續兩次同樣的錯誤不會再跳）。
 */
export function CreateDialog({
  action,
  trigger,
  title,
  description,
  successMessage,
  submitLabel,
  submittingLabel,
  className,
  gridClassName = "grid gap-4 py-4 sm:grid-cols-2",
  children,
}: Readonly<{
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  trigger: string;
  title: string;
  description?: string;
  successMessage: string;
  submitLabel: string;
  submittingLabel: string;
  /** 覆寫 DialogContent 的寬度等樣式；預設 sm:max-w-md。 */
  className?: string;
  /** 覆寫欄位區的格線；預設兩欄，單欄表單傳 "grid gap-4 py-4"。 */
  gridClassName?: string;
  children: ReactNode;
}>) {
  const [open, setOpen] = useState(false);
  const [, dispatch, pending] = useActionState(
    async (prev: ActionState, formData: FormData) => {
      const res = await action(prev, formData);
      if (res.ok) {
        setOpen(false);
        toast.success(successMessage);
      } else if (res.error) {
        toast.error(res.error);
      }
      return res;
    },
    { ok: false } satisfies ActionState,
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="size-4" /> {trigger}
        </Button>
      </DialogTrigger>
      <DialogContent className={cn("sm:max-w-md", className)}>
        <form onSubmit={submitAction(dispatch)}>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description ? <DialogDescription>{description}</DialogDescription> : null}
          </DialogHeader>

          <div className={gridClassName}>{children}</div>

          <DialogFooter>
            <Button type="submit" disabled={pending}>
              {pending ? submittingLabel : submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

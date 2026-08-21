"use client";

import { useActionState, type ReactNode } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";
import { useRowDialogClose } from "@/components/row-dialog";
import type { ActionState } from "@/db/mutations";
import { submitAction } from "@/lib/form-action";
import { cn } from "@/lib/utils";

/**
 * `RowDialog` 內那張「編輯」表單的外殼 —— 與 `CreateDialog` 對稱。
 *
 * 每個資源頁的編輯表單本來都各自抄一份：把 server action 包成成功就跳 toast、
 * 關掉 row dialog，以及底部那排「取消 / 儲存」。欄位才是真正不同的地方，所以
 * 外殼收在這裡，欄位當 children 傳進來（含各自的 hidden id 欄位）。
 *
 * 成功/失敗處理放在 action 內（跑在 transition 裡），不用 useEffect —— 既避免
 * effect 內 setState 的串聯 render，也讓每次送出都必定各吐一次 toast（舊寫法依賴
 * [state] 變化，連續兩次同樣的錯誤不會再跳）。
 */
export function EditForm({
  action,
  successMessage,
  cancelLabel,
  submitLabel,
  submittingLabel,
  footer,
  className,
  children,
}: Readonly<{
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  successMessage: string;
  cancelLabel: string;
  submitLabel: string;
  submittingLabel: string;
  /** 左下角的額外操作（通常是刪除鈕）。 */
  footer?: ReactNode;
  /** 覆寫表單格線；預設兩欄。 */
  className?: string;
  children: ReactNode;
}>) {
  const close = useRowDialogClose();
  const [, dispatch, pending] = useActionState(
    async (prev: ActionState, formData: FormData) => {
      const res = await action(prev, formData);
      if (res.ok) {
        toast.success(successMessage);
        close();
      } else if (res.error) {
        toast.error(res.error);
      }
      return res;
    },
    { ok: false } satisfies ActionState,
  );

  return (
    <form
      onSubmit={submitAction(dispatch)}
      className={cn("grid gap-4 sm:grid-cols-2", className)}
    >
      {children}
      <DialogFooter className="mt-2 border-t pt-4 sm:col-span-2">
        {footer ? <div className="mr-auto">{footer}</div> : null}
        <Button type="button" variant="outline" onClick={close}>
          {cancelLabel}
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? submittingLabel : submitLabel}
        </Button>
      </DialogFooter>
    </form>
  );
}

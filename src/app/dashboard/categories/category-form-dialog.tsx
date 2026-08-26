"use client";

import { useActionState, useState } from "react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { Plus, Pencil } from "lucide-react";
import { createCategory, updateCategory, deleteCategory, type ActionState } from "@/db/mutations";
import { Button } from "@/components/ui/button";
import { DeleteButton } from "@/components/delete-button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/form-field";
import { submitAction } from "@/lib/form-action";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

const initial: ActionState = { ok: false };

export function CategoryFormDialog({
  kind,
  category,
  addLabel,
}: Readonly<{
  kind: string;
  category?: { id: number; name: string };
  addLabel?: string;
}>) {
  const t = useTranslations("categories");
  const editing = !!category;
  const [open, setOpen] = useState(false);
  // 成功/失敗處理放在 action 內（跑在 transition 裡），不用 useEffect ——
  // 既避免 effect 內 setState 的串聯 render，也讓每次送出都必定各吐一次 toast
  // （舊寫法依賴 [state] 變化，連續兩次同樣的錯誤不會再跳）。
  const [, action, pending] = useActionState(
    async (prev: ActionState, formData: FormData) => {
      const res = await (editing ? updateCategory : createCategory)(prev, formData);
      if (res.ok) {
        setOpen(false);
        toast.success(editing ? t("toast.updated") : t("toast.added"));
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
        {editing ? (
          <Button variant="ghost" size="icon" aria-label={t("editAria")}>
            <Pencil className="size-4 text-muted-foreground" />
          </Button>
        ) : (
          <Button variant="ghost" size="sm" className="text-primary">
            <Plus className="size-4" /> {addLabel ?? t("add")}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <form onSubmit={submitAction(action)}>
          {editing ? <input type="hidden" name="id" value={category.id} /> : null}
          <input type="hidden" name="kind" value={kind} />
          <DialogHeader>
            <DialogTitle>{editing ? t("dialog.editTitle") : t("dialog.addTitle")}</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <Field label={t("dialog.name")} htmlFor="cat-name" required>
              <Input
                id="cat-name"
                name="name"
                required
                defaultValue={category?.name ?? ""}
                placeholder={t("dialog.namePlaceholder")}
              />
            </Field>
          </div>
          <DialogFooter>
            {editing ? (
              <div className="mr-auto">
                <DeleteButton action={deleteCategory} id={category.id} />
              </div>
            ) : null}
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {t("dialog.cancel")}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? t("dialog.saving") : t("dialog.save")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

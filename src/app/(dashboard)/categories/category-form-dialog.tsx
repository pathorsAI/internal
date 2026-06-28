"use client";

import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, Pencil } from "lucide-react";
import { createCategory, updateCategory, deleteCategory, type ActionState } from "@/db/mutations";
import { Button } from "@/components/ui/button";
import { DeleteButton } from "@/components/delete-button";
import { Input } from "@/components/ui/input";
import { Label, Req } from "@/components/ui/label";
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
  const editing = !!category;
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(
    editing ? updateCategory : createCategory,
    initial,
  );

  useEffect(() => {
    if (state.ok) {
      setOpen(false);
      toast.success(editing ? "已更新分類" : "已新增分類");
    }
  }, [state, editing]);
  useEffect(() => {
    if (state.error) toast.error(state.error);
  }, [state]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          editing ? (
            <Button variant="ghost" size="icon" aria-label="編輯" />
          ) : (
            <Button variant="ghost" size="sm" className="text-primary" />
          )
        }
      >
        {editing ? (
          <Pencil className="size-4 text-muted-foreground" />
        ) : (
          <>
            <Plus className="size-4" /> {addLabel ?? "新增"}
          </>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <form action={action}>
          {editing ? <input type="hidden" name="id" value={category.id} /> : null}
          <input type="hidden" name="kind" value={kind} />
          <DialogHeader>
            <DialogTitle>{editing ? "編輯分類" : "新增分類"}</DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <div className="space-y-1.5">
              <Label htmlFor="cat-name">名稱<Req /></Label>
              <Input
                id="cat-name"
                name="name"
                required
                defaultValue={category?.name ?? ""}
                placeholder="例：租金費用"
              />
            </div>
          </div>
          <DialogFooter>
            {editing ? (
              <div className="mr-auto">
                <DeleteButton action={deleteCategory} id={category.id} />
              </div>
            ) : null}
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "儲存中…" : "儲存"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

"use client";

import { useActionState, useState } from "react";
import { toast } from "sonner";
import { Plus, Pencil } from "lucide-react";
import { createCategory, updateCategory, deleteCategory, type ActionState } from "@/db/mutations";
import { Button } from "@/components/ui/button";
import { DeleteButton } from "@/components/delete-button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { submitAction } from "@/lib/form-action";
import { Req } from "@/components/req";
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
  // 成功/失敗處理放在 action 內（跑在 transition 裡），不用 useEffect ——
  // 既避免 effect 內 setState 的串聯 render，也讓每次送出都必定各吐一次 toast
  // （舊寫法依賴 [state] 變化，連續兩次同樣的錯誤不會再跳）。
  const [, action, pending] = useActionState(
    async (prev: ActionState, formData: FormData) => {
      const res = await (editing ? updateCategory : createCategory)(prev, formData);
      if (res.ok) {
        setOpen(false);
        toast.success(editing ? "已更新分類" : "已新增分類");
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
          <Button variant="ghost" size="icon" aria-label="編輯">
            <Pencil className="size-4 text-muted-foreground" />
          </Button>
        ) : (
          <Button variant="ghost" size="sm" className="text-primary">
            <Plus className="size-4" /> {addLabel ?? "新增"}
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <form onSubmit={submitAction(action)}>
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

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

type Result = { ok: boolean; error?: string };

export function DeleteButton({
  action,
  id,
  redirectTo,
  label = "刪除",
  title = "確定要刪除嗎？",
  description = "此動作無法復原。",
}: Readonly<{
  action: (id: number) => Promise<Result>;
  id: number;
  redirectTo?: string;
  label?: string;
  title?: string;
  description?: string;
}>) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();

  function onConfirm() {
    start(async () => {
      const res = await action(id);
      if (res.ok) {
        setOpen(false);
        toast.success("已刪除");
        if (redirectTo) router.push(redirectTo);
        else router.refresh();
      } else {
        toast.error(res.error ?? "刪除失敗");
      }
    });
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger
        render={
          <Button
            type="button"
            variant="destructive"
            size="sm"
            onClick={(e) => e.stopPropagation()}
          />
        }
      >
        <Trash2 className="size-4" /> {label}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction variant="destructive" disabled={pending} onClick={onConfirm}>
            {pending ? "刪除中…" : "刪除"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

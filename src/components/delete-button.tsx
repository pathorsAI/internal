"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { useRowDialogClose } from "@/components/row-dialog";
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
  label,
  title,
  description,
}: Readonly<{
  action: (id: number) => Promise<Result>;
  id: number;
  redirectTo?: string;
  label?: string;
  title?: string;
  description?: string;
}>) {
  const t = useTranslations("common");
  const resolvedLabel = label ?? t("deleteButton.label");
  const resolvedTitle = title ?? t("deleteButton.title");
  const resolvedDescription = description ?? t("deleteButton.description");
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const router = useRouter();
  // When rendered inside a RowDialog (e.g. in the edit sheet/dialog footer),
  // close that dialog after a successful delete. No-op when used standalone.
  const closeRowDialog = useRowDialogClose();

  function onConfirm() {
    start(async () => {
      const res = await action(id);
      if (res.ok) {
        setOpen(false);
        toast.success(t("deleteButton.toast.success"));
        closeRowDialog();
        if (redirectTo) router.push(redirectTo);
        else router.refresh();
      } else {
        toast.error(res.error ?? t("deleteButton.toast.failure"));
      }
    });
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          variant="destructive"
          size="sm"
          onClick={(e) => e.stopPropagation()}
        >
          <Trash2 className="size-4" /> {resolvedLabel}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{resolvedTitle}</AlertDialogTitle>
          <AlertDialogDescription>{resolvedDescription}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("deleteButton.cancel")}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" disabled={pending} onClick={onConfirm}>
            {pending ? t("deleteButton.deleting") : t("deleteButton.label")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

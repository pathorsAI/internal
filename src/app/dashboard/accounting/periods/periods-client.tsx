"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { Lock, LockOpen } from "lucide-react";
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
import { closePeriod, reopenPeriod } from "@/db/ledger-mutations";

/** 結帳／重新開帳按鈕，都要先確認。前面還有沒結的月份時在確認框裡提醒（不擋）。 */
export function PeriodActions({
  year,
  month,
  label,
  closed,
  earlierOpen,
}: Readonly<{ year: number; month: number; label: string; closed: boolean; earlierOpen: number }>) {
  const t = useTranslations("accounting");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const actionLabel = closed ? t("periods.reopen") : t("periods.close");

  function confirm() {
    start(async () => {
      if (closed) {
        const res = await reopenPeriod(year, month);
        if (!res.ok) {
          toast.error(res.error ?? t("errors.reopenFailed"));
          return;
        }
        toast.success(t("periods.reopenedToast"));
      } else {
        const res = await closePeriod(year, month);
        if (!res.ok) {
          toast.error(res.error ?? t("errors.closeFailed"));
          return;
        }
        toast.success(t("periods.closedToast", { count: res.entries ?? 0 }));
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <AlertDialog open={open} onOpenChange={(next) => !pending && setOpen(next)}>
      <AlertDialogTrigger asChild>
        <Button type="button" variant={closed ? "ghost" : "outline"} size="sm">
          {closed ? <LockOpen className="size-4" /> : <Lock className="size-4" />}
          {actionLabel}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {closed ? t("periods.reopenTitle", { period: label }) : t("periods.closeTitle", { period: label })}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {closed ? t("periods.reopenDescription") : t("periods.closeDescription")}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {!closed && earlierOpen > 0 ? (
          <p className="text-sm text-warning">{t("periods.earlierOpen", { count: earlierOpen })}</p>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{t("common.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            disabled={pending}
            onClick={(e) => {
              e.preventDefault();
              confirm();
            }}
          >
            {pending ? t("common.saving") : actionLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

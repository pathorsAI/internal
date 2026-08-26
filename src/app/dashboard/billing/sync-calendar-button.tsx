"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { CalendarPlus, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { syncCalendar } from "../settings/calendar-actions";

/**
 * 尚未連結時直接指向設定頁，而不是按了才報錯 —— 讓「還沒設定」這件事在按下去之前
 * 就看得出來。
 */
export function SyncCalendarButton({ connected }: Readonly<{ connected: boolean }>) {
  const t = useTranslations("billing.syncCalendar");
  const [pending, start] = useTransition();
  const router = useRouter();

  if (!connected) {
    return (
      <Button asChild size="sm" variant="outline">
        <Link href="/dashboard/settings">
          <CalendarPlus className="size-4" /> {t("connect")}
        </Link>
      </Button>
    );
  }

  function sync() {
    start(async () => {
      const res = await syncCalendar();
      if (!res.ok) {
        toast.error(res.error ?? t("toast.syncFailed"));
        return;
      }
      const r = res.result;
      toast.success(
        r
          ? t("toast.syncedDetail", { created: r.created, updated: r.updated, deleted: r.deleted })
          : t("toast.synced"),
      );
      router.refresh();
    });
  }

  return (
    <Button type="button" size="sm" variant="outline" onClick={sync} disabled={pending}>
      <RefreshCw className="size-4" /> {pending ? t("syncing") : t("sync")}
    </Button>
  );
}

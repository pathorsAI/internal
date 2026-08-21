"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { Check, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { markAccountantNotified, unmarkAccountantNotified } from "@/db/mutations";

export function NotifyButton({ id, notified }: Readonly<{ id: number; notified: boolean }>) {
  const t = useTranslations("accountantNotices");
  const [pending, start] = useTransition();
  const router = useRouter();

  function run(action: (id: number) => Promise<{ ok: boolean; error?: string }>, msg: string) {
    start(async () => {
      const res = await action(id);
      if (res.ok) {
        toast.success(msg);
        router.refresh();
      } else {
        toast.error(res.error ?? t("toast.failed"));
      }
    });
  }

  if (notified) {
    return (
      <Button
        type="button"
        size="sm"
        variant="ghost"
        disabled={pending}
        onClick={() => run(unmarkAccountantNotified, t("toast.markedUndone"))}
      >
        <Undo2 className="size-4" /> {t("button.undo")}
      </Button>
    );
  }

  return (
    <Button
      type="button"
      size="sm"
      disabled={pending}
      onClick={() => run(markAccountantNotified, t("toast.markedDone"))}
    >
      <Check className="size-4" /> {t("button.markDone")}
    </Button>
  );
}

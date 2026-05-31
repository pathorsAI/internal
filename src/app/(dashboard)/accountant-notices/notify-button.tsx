"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { markAccountantNotified, unmarkAccountantNotified } from "@/db/mutations";

export function NotifyButton({ id, notified }: Readonly<{ id: number; notified: boolean }>) {
  const [pending, start] = useTransition();
  const router = useRouter();

  function run(action: (id: number) => Promise<{ ok: boolean; error?: string }>, msg: string) {
    start(async () => {
      const res = await action(id);
      if (res.ok) {
        toast.success(msg);
        router.refresh();
      } else {
        toast.error(res.error ?? "操作失敗");
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
        onClick={() => run(unmarkAccountantNotified, "已改回待通知")}
      >
        <Undo2 className="size-4" /> 取消
      </Button>
    );
  }

  return (
    <Button
      type="button"
      size="sm"
      disabled={pending}
      onClick={() => run(markAccountantNotified, "已標記為已通知")}
    >
      <Check className="size-4" /> 標記已通知
    </Button>
  );
}

"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { StatusTag } from "@/components/ds/status-dot";
import { markContractCompleted } from "./actions";

/** 合約已收齊、狀態還是草稿 / 進行中：提示 + 一鍵「標記完成」。 */
export function ReadyToClose({ contractId }: Readonly<{ contractId: number }>) {
  const t = useTranslations("links");
  const router = useRouter();
  const [pending, start] = useTransition();

  return (
    <div className="mt-1 flex flex-wrap items-center gap-1.5">
      <span title={t("contractClose.hint")}>
        <StatusTag tone="income">{t("contractClose.badge")}</StatusTag>
      </span>
      <Button
        type="button"
        size="xs"
        variant="outline"
        disabled={pending}
        onClick={(e) => {
          e.stopPropagation();
          start(async () => {
            const res = await markContractCompleted(contractId);
            if (!res.ok) {
              toast.error(res.error ?? t("contractClose.failed"));
              return;
            }
            toast.success(t("contractClose.done"));
            router.refresh();
          });
        }}
      >
        {t("contractClose.markCompleted")}
      </Button>
    </div>
  );
}

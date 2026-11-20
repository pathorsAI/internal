"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";

/** Dashboard 區段的錯誤邊界：DB 查詢失敗等狀況時，給可重試的友善畫面而非整頁崩潰。 */
export default function DashboardError({
  error,
  reset,
}: Readonly<{
  error: Error & { digest?: string };
  reset: () => void;
}>) {
  const t = useTranslations("dashboard");

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <EmptyState
      icon={AlertTriangle}
      message={t("error.message")}
      className="flex-1 rounded-xl py-24"
    >
      <Button variant="outline" size="sm" onClick={reset}>
        {t("error.retry")}
      </Button>
    </EmptyState>
  );
}

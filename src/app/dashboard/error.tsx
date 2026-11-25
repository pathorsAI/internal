"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { isChunkLoadError, showNewVersionPrompt } from "@/components/version-watcher";

/** Dashboard 區段的錯誤邊界：DB 查詢失敗等狀況時，給可重試的友善畫面而非整頁崩潰。 */
export default function DashboardError({
  error,
  reset,
}: Readonly<{
  error: Error & { digest?: string };
  reset: () => void;
}>) {
  const t = useTranslations("dashboard");
  const tCommon = useTranslations("common.newVersion");

  // 部署後還開著舊頁面：舊版的 chunk 已經不在了。不給「重試」（重試還是同一個舊 chunk），
  // 跳右下角的「有新版本」提示，畫面上的按鈕也直接重新整理。
  const stale = isChunkLoadError(error);

  useEffect(() => {
    if (stale) showNewVersionPrompt();
    else console.error(error);
  }, [error, stale]);

  return (
    <EmptyState
      icon={AlertTriangle}
      message={stale ? tCommon("message") : t("error.message")}
      className="flex-1 rounded-xl py-24"
    >
      {stale ? (
        <Button variant="outline" size="sm" onClick={() => globalThis.location.reload()}>
          {tCommon("reload")}
        </Button>
      ) : (
        <Button variant="outline" size="sm" onClick={reset}>
          {t("error.retry")}
        </Button>
      )}
    </EmptyState>
  );
}

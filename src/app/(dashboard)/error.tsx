"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Dashboard 區段的錯誤邊界：DB 查詢失敗等狀況時，給可重試的友善畫面而非整頁崩潰。 */
export default function DashboardError({
  error,
  reset,
}: Readonly<{
  error: Error & { digest?: string };
  reset: () => void;
}>) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 py-24 text-center">
      <AlertTriangle className="size-8 text-muted-foreground/60" />
      <p className="text-sm text-muted-foreground">載入失敗，請重試。</p>
      <Button variant="outline" size="sm" onClick={reset}>
        重新載入
      </Button>
    </div>
  );
}

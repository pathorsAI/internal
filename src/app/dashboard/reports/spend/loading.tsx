import { Skeleton } from "@/components/ui/skeleton";
import { SpendTrendSkeleton } from "./spend-trend-view";

/** 路由載入中：標題、頁籤與同版型的圖表骨架（不用 dashboard 預設的表格骨架）。 */
export default function Loading() {
  return (
    <>
      <div className="space-y-2">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <Skeleton className="h-9 w-52" />
      <SpendTrendSkeleton />
    </>
  );
}

import { Skeleton } from "@/components/ui/skeleton";
import { SpendTrendSkeleton } from "./spend-trend-view";

/**
 * 路由載入中：標題、頁籤與同版型的圖表骨架（不用 dashboard 預設的表格骨架）。
 * 頁首用跟 <PageHeader> 一樣的頁首帶，載入完不會跳動。
 */
export default function Loading() {
  return (
    <>
      <div className="grid-paper -mx-6 -mt-6 border-b bg-card/60 px-6 pt-6 pb-5">
        <Skeleton className="h-7 w-40" />
      </div>
      <Skeleton className="h-9 w-52" />
      <SpendTrendSkeleton />
    </>
  );
}

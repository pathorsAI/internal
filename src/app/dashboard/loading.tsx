import { Skeleton } from "@/components/ui/skeleton";
import { TableSkeleton } from "@/components/table-skeleton";

/**
 * 路由載入中的骨架（dashboard 各頁皆為 force-dynamic，導航時先顯示這個）。
 * 頁首用跟 <PageHeader> 一樣的頁首帶（負 margin 貼邊、方格紙），載入完不會跳動。
 */
export default function Loading() {
  return (
    <>
      <div className="grid-paper -mx-6 -mt-6 space-y-2 border-b bg-card/60 px-6 pt-6 pb-5">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-5 w-64" />
      </div>
      <TableSkeleton rows={8} cols={5} />
    </>
  );
}

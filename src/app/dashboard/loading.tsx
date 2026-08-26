import { Skeleton } from "@/components/ui/skeleton";
import { TableSkeleton } from "@/components/table-skeleton";

/** 路由載入中的骨架（dashboard 各頁皆為 force-dynamic，導航時先顯示這個）。 */
export default function Loading() {
  return (
    <>
      <div className="space-y-2">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-4 w-64" />
      </div>
      <TableSkeleton rows={8} cols={5} />
    </>
  );
}

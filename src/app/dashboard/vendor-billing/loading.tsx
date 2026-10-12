import { Skeleton } from "@/components/ui/skeleton";
import { TableSkeleton } from "@/components/table-skeleton";

/** 骨架照實際版面排：標題 + 右側按鈕、需要處理的框、分段按鈕、表格。 */
export default function Loading() {
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-8 w-32" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-9 w-24" />
          <Skeleton className="h-9 w-32" />
        </div>
      </div>
      <div className="space-y-2 rounded-lg border px-4 py-3">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-4 w-64 max-w-full" />
        <Skeleton className="h-4 w-52 max-w-full" />
      </div>
      <Skeleton className="h-8 w-64" />
      <TableSkeleton rows={6} cols={8} />
    </>
  );
}

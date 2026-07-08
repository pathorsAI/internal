import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/** 載入中的表格骨架，配合 route 的 loading.tsx 使用。 */
export function TableSkeleton({
  rows = 8,
  cols = 5,
}: Readonly<{ rows?: number; cols?: number }>) {
  const rowKeys = Array.from({ length: rows }, (_, i) => `row-${i}`);
  const colKeys = Array.from({ length: cols }, (_, i) => `col-${i}`);
  return (
    <div className="overflow-hidden rounded-xl border">
      <div className="border-b px-4 py-2.5">
        <Skeleton className="h-4 w-24" />
      </div>
      <div className="divide-y">
        {rowKeys.map((rowKey) => (
          <div key={rowKey} className="flex items-center gap-4 px-4 py-3.5">
            {colKeys.map((colKey, c) => (
              <Skeleton
                key={colKey}
                className={cn(
                  "h-4",
                  c === 0 && "w-24",
                  c === cols - 1 && "ml-auto w-16",
                  c > 0 && c < cols - 1 && "w-full max-w-[10ch] flex-1",
                )}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

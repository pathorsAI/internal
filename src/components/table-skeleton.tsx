import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/** 載入中的表格骨架，配合 route 的 loading.tsx 使用。 */
export function TableSkeleton({
  rows = 8,
  cols = 5,
}: Readonly<{ rows?: number; cols?: number }>) {
  return (
    <div className="overflow-hidden rounded-xl border">
      <div className="border-b px-4 py-2.5">
        <Skeleton className="h-4 w-24" />
      </div>
      <div className="divide-y">
        {Array.from({ length: rows }).map((_, r) => (
          <div key={r} className="flex items-center gap-4 px-4 py-3.5">
            {Array.from({ length: cols }).map((_, c) => (
              <Skeleton
                key={c}
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

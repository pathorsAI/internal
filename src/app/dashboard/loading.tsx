"use client";

import { usePathname } from "next/navigation";
import { Skeleton } from "@/components/ui/skeleton";
import { TableSkeleton } from "@/components/table-skeleton";
import AiLoading from "./ai/loading";

/**
 * 路由載入中的骨架（dashboard 各頁皆為 force-dynamic，導航時先顯示這個）。
 * 頁首用跟 <PageHeader> 一樣的頁首帶（負 margin 貼邊、方格紙），載入完不會跳動。
 *
 * 例外：首頁與 AI 助理頁沒有 PageHeader。整頁重新載入時最外層先顯示的是這個骨架，
 * 所以依路徑換成它們自己的形狀，才不會先閃一條頁首帶、內容到了又收掉。
 */
export default function Loading() {
  const pathname = usePathname();
  if (pathname === "/dashboard/ai" || pathname.startsWith("/dashboard/ai/")) return <AiLoading />;
  if (pathname === "/dashboard") return <OverviewSkeleton />;
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

/** 首頁：置中的 AI 輸入區（跟 page.tsx 同樣的留白）＋資產卡。 */
function OverviewSkeleton() {
  return (
    <div className="flex flex-col gap-8 sm:gap-10">
      <div className="mx-auto flex w-full max-w-3xl flex-col items-center gap-5 py-10 sm:gap-6 sm:py-16 lg:py-20">
        <Skeleton className="h-8 w-64 rounded-full" />
        <Skeleton className="h-8 w-72 sm:h-9" />
        <Skeleton className="h-16 w-full rounded-xl" />
        <div className="flex gap-2">
          <Skeleton className="h-7 w-32" />
          <Skeleton className="h-7 w-24" />
          <Skeleton className="h-7 w-20" />
        </div>
      </div>
      <div className="space-y-2">
        <Skeleton className="h-5 w-24" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Skeleton className="h-44 rounded-xl" />
          <Skeleton className="h-44 rounded-xl" />
        </div>
      </div>
    </div>
  );
}

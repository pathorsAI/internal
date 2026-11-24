import { Skeleton } from "@/components/ui/skeleton";
import { CHAT_FRAME } from "./frame";

/** 跟 AI 助理頁同尺寸的骨架：頁首帶、左側對話列表、右側訊息與輸入框。 */
export default function Loading() {
  return (
    <>
      <div className="grid-paper -mx-6 -mt-6 space-y-1 border-b bg-card/60 px-6 pt-6 pb-5">
        <Skeleton className="h-7 w-32" />
        <Skeleton className="h-5 w-48" />
      </div>
      <div className={CHAT_FRAME}>
        <div className="hidden w-64 shrink-0 flex-col gap-2 border-r p-3 md:flex">
          <Skeleton className="h-8 w-full" />
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="mx-auto w-full max-w-3xl flex-1 space-y-6 px-4 py-6">
            <Skeleton className="ml-auto h-9 w-2/5" />
            <div className="space-y-2">
              <Skeleton className="h-4 w-1/3" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-4/5" />
            </div>
          </div>
          <div className="border-t px-4 py-3">
            <Skeleton className="mx-auto h-12 w-full max-w-3xl" />
          </div>
        </div>
      </div>
    </>
  );
}

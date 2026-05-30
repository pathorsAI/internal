import { Info } from "lucide-react";

export function WireframeNotice() {
  return (
    <div className="flex items-center gap-2 rounded-md border border-dashed bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
      <Info className="size-3.5 shrink-0" />
      Wireframe 預覽資料 — 待 DBA 在 Neon 建好資料表後，透過 db:pull 被動同步接上即時資料。
    </div>
  );
}

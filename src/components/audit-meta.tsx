import { Badge } from "@/components/ui/badge";
import { formatDateTime } from "@/lib/format";
import type { AuditMeta as AuditMetaData } from "@/db/queries";

// 顯示某一筆資料「誰、何時建立 / 最後修改」的灰字 meta 行。
// 全站通用：任何 list 頁的 RowDialog footer 都能重用（資料來源都是 activity_log）。
export function AuditMeta({
  meta,
  fallbackCreatedAt,
  fallbackUpdatedAt,
}: Readonly<{
  meta?: AuditMetaData;
  /** 舊資料（操作紀錄之前）在 log 裡沒有操作人時，退回用該列自己的時間欄位 */
  fallbackCreatedAt?: string | null;
  fallbackUpdatedAt?: string | null;
}>) {
  const createdAt = meta?.createdAt ?? fallbackCreatedAt ?? null;
  const updatedAt = meta?.updatedAt ?? fallbackUpdatedAt ?? null;
  // 修改時間與建立時間相同視為「未曾修改」，不重複顯示
  const showUpdate = !!updatedAt && updatedAt !== createdAt;
  if (!createdAt && !showUpdate) return null;

  return (
    <div className="flex flex-col gap-1 text-xs text-muted-foreground">
      {createdAt ? (
        <span className="inline-flex items-center gap-1.5">
          建立{meta?.createdBy ? ` · ${meta.createdBy}` : ""} · {formatDateTime(createdAt)}
          {meta?.createdChannel === "mcp" ? <McpTag /> : null}
        </span>
      ) : null}
      {showUpdate ? (
        <span className="inline-flex items-center gap-1.5">
          最後修改{meta?.updatedBy ? ` · ${meta.updatedBy}` : ""} · {formatDateTime(updatedAt!)}
          {meta?.updatedChannel === "mcp" ? <McpTag /> : null}
        </span>
      ) : null}
    </div>
  );
}

function McpTag() {
  return (
    <Badge variant="secondary" className="px-1 py-0 text-[10px] font-normal">
      MCP
    </Badge>
  );
}

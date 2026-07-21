import * as React from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * 資料表格的統一外框：清掉 Card 預設的 py-6 / gap-6（避免表格上下出現 24px 空白、
 * 邊緣貼齊圓角），並可選擇性帶一條標題列（左標題、右側放筆數或動作）。
 * 直接把 <Table> 當 children 放進來即可，全頁列表一律用這個包裝以維持一致。
 * 首末欄的水平 padding 加大到 16px（與標題列的 px-4 對齊），避免文字貼到圓角。
 */

/** 首/末欄 16px 邊距 — 沒包 TableCard 的表格（如 Card + p-0）也套這組。 */
export const tableEdgePadding =
  "[&_th:first-child]:pl-4 [&_td:first-child]:pl-4 [&_th:last-child]:pr-4 [&_td:last-child]:pr-4";
export function TableCard({
  title,
  action,
  children,
  className,
}: Readonly<{
  title?: React.ReactNode;
  /** 標題列右側：通常是筆數或次要動作 */
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}>) {
  return (
    <Card className={cn("gap-0 overflow-hidden p-0", tableEdgePadding, className)}>
      {title || action ? (
        <div className="flex items-center justify-between gap-2 border-b px-4 py-2.5">
          <div className="text-sm font-medium">{title}</div>
          {action ? (
            <div className="text-xs text-muted-foreground">{action}</div>
          ) : null}
        </div>
      ) : null}
      {children}
    </Card>
  );
}

import * as React from "react";
import { TableCell, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

/** 空狀態的圖示：圓角方塊裡一個線稿 icon，底下是點陣（.dot-paper）。 */
function EmptyIcon({
  icon: Icon,
}: Readonly<{ icon: React.ComponentType<{ className?: string }> }>) {
  return (
    <span className="flex size-11 items-center justify-center rounded-xl border bg-card shadow-xs">
      <Icon className="size-5 text-primary" />
    </span>
  );
}

/** 區塊型空狀態（卡片內、非表格）：點陣底＋圖示＋一句話，可帶一個 CTA。 */
export function EmptyState({
  icon: Icon,
  message,
  children,
  className,
}: Readonly<{
  icon?: React.ComponentType<{ className?: string }>;
  message: React.ReactNode;
  /** 次要提示或 CTA */
  children?: React.ReactNode;
  className?: string;
}>) {
  return (
    <div
      className={cn(
        "dot-paper flex flex-col items-center justify-center gap-3 px-6 py-12 text-center",
        className,
      )}
    >
      {Icon ? <EmptyIcon icon={Icon} /> : null}
      <p className="text-sm text-muted-foreground">{message}</p>
      {children}
    </div>
  );
}

/** 表格內的「無資料」列：跨欄置中、點陣底。 */
export function EmptyRow({
  colSpan,
  message,
  children,
}: Readonly<{
  colSpan: number;
  message: React.ReactNode;
  /** 次要提示，例如「點右上角新增」 */
  children?: React.ReactNode;
}>) {
  return (
    <TableRow className="hover:bg-transparent">
      <TableCell colSpan={colSpan} className="p-0">
        <div className="dot-paper flex h-32 flex-col items-center justify-center gap-1 text-center text-sm text-muted-foreground">
          <span>{message}</span>
          {children}
        </div>
      </TableCell>
    </TableRow>
  );
}

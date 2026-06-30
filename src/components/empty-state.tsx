import * as React from "react";
import { TableCell, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

/** 區塊型空狀態（卡片內、非表格）：統一置中與留白。 */
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
        "flex flex-col items-center justify-center gap-2 px-6 py-12 text-center",
        className,
      )}
    >
      {Icon ? <Icon className="size-8 text-muted-foreground/50" /> : null}
      <p className="text-sm text-muted-foreground">{message}</p>
      {children}
    </div>
  );
}

/** 表格內的「無資料」列：跨欄置中、固定高度，密度與其他列一致。 */
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
      <TableCell
        colSpan={colSpan}
        className="h-24 text-center text-sm text-muted-foreground"
      >
        <div className="flex flex-col items-center justify-center gap-1">
          <span>{message}</span>
          {children}
        </div>
      </TableCell>
    </TableRow>
  );
}

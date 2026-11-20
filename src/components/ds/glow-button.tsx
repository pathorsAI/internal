import * as React from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * 每頁唯一的主要動作（新增交易、發薪、在 Claude 中連接）。藍色光暈＋hover 掃光，
 * 樣式在 globals.css 的 .btn-glow。表格列內的按鈕、次要按鈕、刪除都不要用這顆 ——
 * 一頁出現兩顆就等於沒有重點。
 */
export function GlowButton({
  className,
  ...props
}: React.ComponentProps<typeof Button>) {
  return <Button {...props} variant="default" className={cn("btn-glow", className)} />;
}

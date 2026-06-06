"use client";

import * as React from "react";
import { TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

const CloseCtx = React.createContext<() => void>(() => {});
/** 在 RowDialog 內的表單可呼叫此 hook，存檔成功後關閉對話框 */
export function useRowDialogClose() {
  return React.useContext(CloseCtx);
}

export function RowDialog({
  cells,
  title,
  description,
  children,
  variant = "dialog",
}: Readonly<{
  /** <TableCell> 們 */
  cells: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** 對話框內容（編輯表單 + 刪除鈕） */
  children: React.ReactNode;
  /** "dialog" 置中彈窗（預設）；"sheet" 從右側滑出 */
  variant?: "dialog" | "sheet";
}>) {
  const [open, setOpen] = React.useState(false);
  const close = React.useCallback(() => setOpen(false), []);

  function onRowClick(e: React.MouseEvent<HTMLTableRowElement>) {
    // 有對話框正開著 / 正在關閉時（例如點灰色背景關閉發放薪資 dialog，
    // 那個點擊會「穿透」到下面的列）→ 不要開啟這一列的編輯
    if (
      document.querySelector(
        '[data-slot="dialog-overlay"], [data-slot="alert-dialog-overlay"], [data-slot="sheet-overlay"]',
      )
    ) {
      return;
    }
    // 點到列裡的按鈕 / 連結等互動元素也不開啟（發放薪資、刪除等）
    if ((e.target as HTMLElement).closest("button, a, input, label")) return;
    setOpen(true);
  }

  const row = (
    <TableRow className="cursor-pointer hover:bg-muted/50" onClick={onRowClick}>
      {cells}
    </TableRow>
  );

  if (variant === "sheet") {
    return (
      <>
        {row}
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent className="data-[side=right]:sm:max-w-xl">
            <SheetHeader>
              <SheetTitle>{title}</SheetTitle>
              {description ? <SheetDescription>{description}</SheetDescription> : null}
            </SheetHeader>
            <div className="flex-1 overflow-y-auto px-4 pb-4">
              <CloseCtx.Provider value={close}>{children}</CloseCtx.Provider>
            </div>
          </SheetContent>
        </Sheet>
      </>
    );
  }

  return (
    <>
      {row}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description ? <DialogDescription>{description}</DialogDescription> : null}
          </DialogHeader>
          <CloseCtx.Provider value={close}>{children}</CloseCtx.Provider>
        </DialogContent>
      </Dialog>
    </>
  );
}

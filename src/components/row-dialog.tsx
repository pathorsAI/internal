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

// 點到列裡的按鈕 / 連結 / 輸入等互動元素 → 交給它們自己處理，不開啟編輯
function hitInteractive(target: EventTarget | null) {
  return Boolean((target as HTMLElement | null)?.closest("button, a, input, label"));
}

// 有對話框正開著 / 正在關閉時（例如點灰色背景關閉發放薪資 dialog，
// 那個點擊會「穿透」到下面的列）→ 不要開啟這一列的編輯
function shouldOpen(target: EventTarget | null) {
  if (
    document.querySelector(
      '[data-slot="dialog-overlay"], [data-slot="alert-dialog-overlay"], [data-slot="sheet-overlay"]',
    )
  ) {
    return false;
  }
  return !hitInteractive(target);
}

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
    if (shouldOpen(e.target)) setOpen(true);
  }

  function onRowKeyDown(e: React.KeyboardEvent<HTMLTableRowElement>) {
    if (e.key !== "Enter" && e.key !== " ") return;
    // 鍵盤焦點在列內的按鈕/連結上時，讓該元素自己處理 Enter/Space
    if (hitInteractive(e.target)) return;
    e.preventDefault();
    if (shouldOpen(e.target)) setOpen(true);
  }

  const row = (
    <TableRow
      role="button"
      tabIndex={0}
      aria-haspopup="dialog"
      className="cursor-pointer hover:bg-muted/50 focus-visible:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      onClick={onRowClick}
      onKeyDown={onRowKeyDown}
    >
      {cells}
    </TableRow>
  );

  if (variant === "sheet") {
    return (
      <>
        {row}
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent className="data-[side=right]:sm:max-w-xl">
            <SheetHeader className="shrink-0">
              <SheetTitle>{title}</SheetTitle>
              {description ? <SheetDescription>{description}</SheetDescription> : null}
            </SheetHeader>
            {/* 只有這個 body 會捲動；header 固定、表單底部的 footer 用 sticky 釘住 */}
            <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
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
        <DialogContent className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
          <DialogHeader className="shrink-0 px-4 pt-4 pb-3">
            <DialogTitle>{title}</DialogTitle>
            {description ? <DialogDescription>{description}</DialogDescription> : null}
          </DialogHeader>
          {/* 只有這個 body 會捲動；header 固定、表單底部的 footer 用 sticky 釘住 */}
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
            <CloseCtx.Provider value={close}>{children}</CloseCtx.Provider>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

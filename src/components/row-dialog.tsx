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
}: Readonly<{
  /** <TableCell> 們 */
  cells: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** 對話框內容（編輯表單 + 刪除鈕） */
  children: React.ReactNode;
}>) {
  const [open, setOpen] = React.useState(false);
  const close = React.useCallback(() => setOpen(false), []);

  return (
    <>
      <TableRow className="cursor-pointer hover:bg-muted/50" onClick={() => setOpen(true)}>
        {cells}
      </TableRow>
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

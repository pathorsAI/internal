"use client";

import { FileText } from "lucide-react";

// A clickable contract-file link inside a RowDialog row — stopPropagation so
// clicking the link opens the file instead of the row's edit dialog.
export function ContractFileLink({ url }: Readonly<{ url: string }>) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      onClick={(e) => e.stopPropagation()}
      className="inline-flex items-center gap-1 text-primary underline underline-offset-2 hover:opacity-80"
      aria-label="開啟合約檔案"
    >
      <FileText className="size-4" /> 檔案
    </a>
  );
}

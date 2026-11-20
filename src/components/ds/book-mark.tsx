import { cn } from "@/lib/utils";

export type BookKey = "internal" | "external" | "both";

/**
 * 雙本記號：兩張疊著的頁。「一筆交易、兩本帳」是 internal 跟別的記帳工具最不一樣的地方，
 * 所以做成看得見的符號 —— both 是兩張，internal（管理帳）只剩實心那張，
 * external（稅務帳）只剩空心那張。logo 用的也是這個形狀（components/logo.tsx）。
 */
export function BookMark({
  book,
  className,
}: Readonly<{ book: BookKey; className?: string }>) {
  return <span aria-hidden data-book={book} className={cn("book-mark", className)} />;
}

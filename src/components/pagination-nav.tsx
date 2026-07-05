import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";

// 通用分頁列：上一頁 / 下一頁 + 「第 X / Y 頁，共 N 筆」。
// params 帶入目前的篩選條件，翻頁時保留（page 由本元件覆寫）。
export function PaginationNav({
  page,
  totalPages,
  total,
  basePath,
  params = {},
}: Readonly<{
  page: number;
  totalPages: number;
  total: number;
  basePath: string;
  params?: Record<string, string | undefined>;
}>) {
  if (totalPages <= 1) return null;

  function hrefFor(targetPage: number) {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v) sp.set(k, v);
    }
    if (targetPage > 1) sp.set("page", String(targetPage));
    const qs = sp.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  }

  const hasPrev = page > 1;
  const hasNext = page < totalPages;

  return (
    <nav
      className="flex items-center justify-between gap-2 px-1 py-3 text-sm"
      aria-label="分頁"
    >
      <span className="text-muted-foreground">
        第 {page} / {totalPages} 頁 · 共 {total} 筆
      </span>
      <div className="flex items-center gap-2">
        <PageLink href={hrefFor(page - 1)} disabled={!hasPrev} rel="prev">
          <ChevronLeft className="size-4" />
          上一頁
        </PageLink>
        <PageLink href={hrefFor(page + 1)} disabled={!hasNext} rel="next">
          下一頁
          <ChevronRight className="size-4" />
        </PageLink>
      </div>
    </nav>
  );
}

function PageLink({
  href,
  disabled,
  rel,
  children,
}: Readonly<{
  href: string;
  disabled: boolean;
  rel: "prev" | "next";
  children: React.ReactNode;
}>) {
  const className = cn(
    buttonVariants({ variant: "outline", size: "sm" }),
    "gap-1",
    disabled && "pointer-events-none opacity-50",
  );
  if (disabled) {
    return (
      <span className={className} aria-disabled="true">
        {children}
      </span>
    );
  }
  return (
    <Link href={href} rel={rel} className={className}>
      {children}
    </Link>
  );
}

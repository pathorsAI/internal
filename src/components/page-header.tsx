import { cn } from "@/lib/utils";

/**
 * 每頁最上面的頁首帶：方格紙背景往右上角淡出（.grid-paper），標題在左、主要動作在右。
 * 用負 margin 貼齊內容區的邊（dashboard layout 給了 p-6），所以它一定要是頁面的第一個元素。
 * 主要動作請用 <GlowButton>，一頁一顆。
 */
export function PageHeader({
  title,
  children,
  className,
}: Readonly<{
  title: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}>) {
  return (
    <div
      className={cn(
        "grid-paper -mx-6 -mt-6 flex flex-wrap items-end justify-between gap-4 overflow-hidden border-b bg-card/60 px-6 pt-6 pb-5",
        className,
      )}
    >
      <div className="min-w-0">
        <h1 className="text-xl leading-7 font-semibold tracking-tight">{title}</h1>
      </div>
      {children ? <div className="flex flex-wrap items-center gap-2">{children}</div> : null}
    </div>
  );
}

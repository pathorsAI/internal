"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

/**
 * 頁面進場動效。以 pathname 當 key，所以只有「換頁」會重播；篩選、翻頁只改 searchParams，
 * 不會讓整頁再飄一次。剛進頁面的 900ms 掛著 .ds-entering，表格的前幾列趁這段時間依序出現
 * （globals.css）；過了就拿掉，之後新增或篩選出來的列不再有動畫。
 * class 直接加在 DOM 上而不走 state：它只影響 CSS，不值得為它多 render 一輪。
 */
export function PageEnter({
  className,
  children,
}: Readonly<{ className?: string; children: React.ReactNode }>) {
  const pathname = usePathname();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.classList.add("ds-entering");
    const timer = setTimeout(() => el.classList.remove("ds-entering"), 900);
    return () => {
      clearTimeout(timer);
      el.classList.remove("ds-entering");
    };
  }, [pathname]);

  return (
    <div key={pathname} ref={ref} className={cn("ds-page ds-entering", className)}>
      {children}
    </div>
  );
}

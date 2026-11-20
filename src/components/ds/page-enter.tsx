"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * 頁面進場動效。以 pathname 當 key，所以只有「換頁」會重播；篩選、翻頁只改 searchParams，
 * 不會讓整頁再飄一次。剛進頁面的 900ms 掛著 .ds-entering，表格的前幾列趁這段時間依序出現
 * （globals.css）；過了就拿掉，之後新增或篩選出來的列不再有動畫。
 */
export function PageEnter({
  className,
  children,
}: Readonly<{ className?: string; children: React.ReactNode }>) {
  const pathname = usePathname();
  const [entering, setEntering] = useState(true);

  useEffect(() => {
    setEntering(true);
    const timer = setTimeout(() => setEntering(false), 900);
    return () => clearTimeout(timer);
  }, [pathname]);

  return (
    <div key={pathname} className={cn("ds-page", entering && "ds-entering", className)}>
      {children}
    </div>
  );
}

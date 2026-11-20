"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

/**
 * internal 的標誌：兩張疊著的頁 ——「一筆交易、兩本帳」。實心那張是管理帳，
 * 空心那張是稅務帳；跟帳別標籤的雙本記號（ds/book-mark.tsx）是同一個形狀。
 */
export function LogoMark({ className }: Readonly<{ className?: string }>) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={cn("size-8 shrink-0 text-primary", className)}
    >
      <rect x="4" y="4" width="18" height="18" rx="5" fill="currentColor" />
      <rect
        x="11.25"
        y="11.25"
        width="16.5"
        height="16.5"
        rx="4.25"
        className="fill-card"
        stroke="currentColor"
        strokeWidth="2.5"
      />
    </svg>
  );
}

/** Brand mark + app name, used in the sidebar header. */
export function Logo({ className }: Readonly<{ className?: string }>) {
  const t = useTranslations("common");
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <LogoMark className="size-6" />
      <span className="text-sm font-semibold tracking-tight">{t("brand.name")}</span>
    </div>
  );
}

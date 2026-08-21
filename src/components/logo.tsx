"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

/** Pathors brand mark — a minimal blue waypoint route. */
export function LogoMark({ className }: Readonly<{ className?: string }>) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={cn("size-8 shrink-0", className)}
    >
      <path
        d="M7 23 L15 13 L21 18 L26 9"
        stroke="#1D9BF0"
        strokeWidth="2.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="26" cy="9" r="2.7" fill="#1D9BF0" />
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

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Building2, Plug, Puzzle } from "lucide-react";
import { cn } from "@/lib/utils";

const sections = [
  { key: "general", href: "/dashboard/settings", icon: Building2 },
  { key: "integrations", href: "/dashboard/settings/integrations", icon: Puzzle },
  { key: "mcp", href: "/dashboard/settings/mcp", icon: Plug },
] as const;

export function SettingsNav() {
  const t = useTranslations("settings.nav");
  const pathname = usePathname();

  return (
    <nav
      aria-label={t("label")}
      className="-mx-1 flex shrink-0 gap-1 overflow-x-auto px-1 md:sticky md:top-22 md:mx-0 md:w-48 md:flex-col md:overflow-visible md:px-0"
    >
      {sections.map(({ key, href, icon: Icon }) => {
        const active =
          href === "/dashboard/settings" ? pathname === href : pathname.startsWith(href);
        return (
          <Link
            key={key}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm whitespace-nowrap transition-colors",
              active
                ? "bg-muted font-medium text-foreground"
                : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
            )}
          >
            <Icon className="size-4" />
            {t(key)}
          </Link>
        );
      })}
    </nav>
  );
}

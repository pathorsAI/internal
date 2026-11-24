import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ArrowLeftRight, BookText, CalendarCheck, Package } from "lucide-react";
import { cn } from "@/lib/utils";

const ITEMS = [
  { key: "journal", href: "/dashboard/accounting", icon: BookText },
  { key: "assets", href: "/dashboard/accounting/assets", icon: Package },
  { key: "periods", href: "/dashboard/accounting/periods", icon: CalendarCheck },
  { key: "fx", href: "/dashboard/accounting/fx", icon: ArrowLeftRight },
] as const;

export type AccountingTab = (typeof ITEMS)[number]["key"];

/**
 * 總帳區的頁籤（傳票 / 財產目錄 / 結帳 / 匯率）。跟 ReportsNav 一樣是導覽連結（每頁獨立路由），
 * 外觀照 TabsList 的預設樣式。
 */
export async function AccountingNav({ active }: Readonly<{ active: AccountingTab }>) {
  const t = await getTranslations("accounting.nav");
  return (
    <nav
      aria-label={t("label")}
      className="inline-flex h-9 w-fit max-w-full items-center overflow-x-auto rounded-lg bg-muted p-[3px] text-muted-foreground"
    >
      {ITEMS.map(({ key, href, icon: Icon }) => (
        <Link
          key={key}
          href={href}
          aria-current={active === key ? "page" : undefined}
          className={cn(
            "inline-flex h-[calc(100%-1px)] items-center gap-1.5 rounded-md border border-transparent px-3 text-sm font-medium whitespace-nowrap transition-all focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring [&_svg]:size-4",
            active === key
              ? "bg-background text-foreground shadow-xs dark:border-input dark:bg-input/30"
              : "text-foreground/60 hover:text-foreground dark:text-muted-foreground dark:hover:text-foreground",
          )}
        >
          <Icon /> {t(key)}
        </Link>
      ))}
    </nav>
  );
}

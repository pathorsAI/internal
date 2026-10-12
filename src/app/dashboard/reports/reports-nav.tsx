import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { BarChart3, ChartColumnStacked } from "lucide-react";
import { cn } from "@/lib/utils";

const ITEMS = [
  { key: "overview", href: "/dashboard/reports", icon: BarChart3 },
  { key: "spend", href: "/dashboard/reports/spend", icon: ChartColumnStacked },
] as const;

/**
 * 報表區的頁籤（總覽 / 支出分析）。是導覽連結不是 Tabs 元件（每一頁是獨立路由），
 * 外觀照 TabsList 的預設樣式，跟頁內的切換長得一樣。
 */
export async function ReportsNav({ active }: Readonly<{ active: (typeof ITEMS)[number]["key"] }>) {
  const t = await getTranslations("reports.nav");
  return (
    <nav className="inline-flex h-9 w-fit items-center rounded-lg bg-muted p-[3px] text-muted-foreground">
      {ITEMS.map(({ key, href, icon: Icon }) => (
        <Link
          key={key}
          href={href}
          aria-current={active === key ? "page" : undefined}
          className={cn(
            "inline-flex h-[calc(100%-1px)] items-center gap-1.5 rounded-md border border-transparent px-3 text-sm font-medium whitespace-nowrap transition-all focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring [&_svg]:size-4",
            active === key
              ? "bg-background text-foreground shadow-sm dark:border-input dark:bg-input/30"
              : "text-foreground/60 hover:text-foreground dark:text-muted-foreground dark:hover:text-foreground",
          )}
        >
          <Icon /> {t(key)}
        </Link>
      ))}
    </nav>
  );
}

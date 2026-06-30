"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Filter } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const BOOK_ITEMS: Record<string, string> = {
  all: "全部帳別",
  internal: "內帳",
  external: "外帳",
  both: "內外帳",
};

function monthLabel(ym: string) {
  const [y, m] = ym.split("-");
  return `${y} 年 ${Number(m)} 月`;
}

export function TransactionFilters({
  categories,
  accounts,
  months,
  book,
  category,
  account,
  period,
}: Readonly<{
  categories: { id: number; name: string }[];
  accounts: { id: number; name: string }[];
  months: string[];
  book?: string;
  category?: string;
  account?: string;
  period?: string;
}>) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value && value !== "all") next.set(key, value);
    else next.delete(key);
    const qs = next.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  const categoryItems: Record<string, string> = {
    all: "全部分類",
    ...Object.fromEntries(categories.map((c) => [String(c.id), c.name])),
  };
  const accountItems: Record<string, string> = {
    all: "全部帳戶",
    ...Object.fromEntries(accounts.map((a) => [String(a.id), a.name])),
  };
  const monthItems: Record<string, string> = {
    all: "全部月份",
    ...Object.fromEntries(months.map((m) => [m, monthLabel(m)])),
  };

  const filters: { key: string; value: string; items: Record<string, string>; w: string }[] = [
    { key: "period", value: period ?? "all", items: monthItems, w: "w-36" },
    { key: "book", value: book ?? "all", items: BOOK_ITEMS, w: "w-32" },
    { key: "category", value: category ?? "all", items: categoryItems, w: "w-44" },
    { key: "account", value: account ?? "all", items: accountItems, w: "w-44" },
  ];

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Filter className="size-4 shrink-0 text-muted-foreground" />
      {filters.map((f) => (
        <Select
          key={f.key}
          value={f.value}
          onValueChange={(v) => setParam(f.key, v as string)}
        >
          <SelectTrigger className={f.w}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Object.entries(f.items).map(([v, l]) => (
              <SelectItem key={v} value={v}>
                {l}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ))}
    </div>
  );
}

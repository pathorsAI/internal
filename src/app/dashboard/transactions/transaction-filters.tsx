"use client";

import { useRef } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Filter, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useTranslations } from "next-intl";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function TransactionFilters({
  categories,
  accounts,
  parties,
  months,
  book,
  category,
  account,
  party,
  period,
  q,
}: Readonly<{
  categories: { id: number; name: string }[];
  accounts: { id: number; name: string }[];
  parties: { id: number; name: string }[];
  months: string[];
  book?: string;
  category?: string;
  account?: string;
  party?: string;
  period?: string;
  /** 文字搜尋（說明、銀行備註、參考號、對象）。 */
  q?: string;
}>) {
  const t = useTranslations("transactions");
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    if (value && value !== "all") next.set(key, value);
    else next.delete(key);
    // 換條件就回第一頁，不然可能停在超出範圍的頁數。
    next.delete("page");
    const qs = next.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  // 搜尋框：停止打字 400ms 後才換網址，不是每個字都重新查一次。
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function onSearch(value: string) {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setParam("q", value.trim()), 400);
  }

  const bookItems: Record<string, string> = {
    all: t("filters.book.all"),
    internal: t("filters.book.internal"),
    external: t("filters.book.external"),
    both: t("filters.book.both"),
  };
  const categoryItems: Record<string, string> = {
    all: t("filters.category.all"),
    none: t("filters.category.none"),
    ...Object.fromEntries(categories.map((c) => [String(c.id), c.name])),
  };
  const accountItems: Record<string, string> = {
    all: t("filters.account.all"),
    ...Object.fromEntries(accounts.map((a) => [String(a.id), a.name])),
  };
  const partyItems: Record<string, string> = {
    all: t("filters.party.all"),
    none: t("filters.party.none"),
    ...Object.fromEntries(parties.map((p) => [String(p.id), p.name])),
  };
  const monthItems: Record<string, string> = {
    all: t("filters.month.all"),
    ...Object.fromEntries(
      months.map((m) => {
        const [y, mo] = m.split("-");
        return [m, t("filters.month.label", { year: y, month: Number(mo) })];
      }),
    ),
  };

  const filters: { key: string; value: string; items: Record<string, string>; w: string }[] = [
    { key: "period", value: period ?? "all", items: monthItems, w: "w-36" },
    { key: "book", value: book ?? "all", items: bookItems, w: "w-32" },
    { key: "category", value: category ?? "all", items: categoryItems, w: "w-44" },
    { key: "account", value: account ?? "all", items: accountItems, w: "w-44" },
    { key: "party", value: party ?? "all", items: partyItems, w: "w-44" },
  ];

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Filter className="size-4 shrink-0 text-muted-foreground" />
      <div className="relative w-full sm:w-56">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          aria-label={t("filters.search.label")}
          placeholder={t("filters.search.placeholder")}
          defaultValue={q ?? ""}
          onChange={(e) => onSearch(e.target.value)}
          className="pl-8"
        />
      </div>
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

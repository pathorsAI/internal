"use client";

/**
 * 支出分析的明細表：每個類別 / 廠商一列 —— 名稱、走勢、每月金額（壓縮表示）、期間合計、本月 vs 上月。
 * 可依合計或變化排序；點名稱選取（上面的單項圖跟著換），右側箭頭連到交易帳本。
 * 月份欄多，表格在自己的容器裡橫向捲動（Table 元件本身就包了 overflow-x-auto）。
 */

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ArrowDown, ArrowUp, ArrowUpDown, ArrowUpRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { TableCard } from "@/components/table-card";
import { sortTrendItems, transactionsHref, type SpendTrend, type TrendSort } from "@/lib/spend-trend";
import { cn } from "@/lib/utils";
import { ItemMark, OTHER_COLOR, Sparkline, fullLabel, money, useFormatters, useItemLabel } from "./shared";

function SortHeader({
  label,
  column,
  sort,
  onSort,
}: Readonly<{
  label: string;
  column: TrendSort;
  sort: { by: TrendSort; dir: "asc" | "desc" };
  onSort: (by: TrendSort) => void;
}>) {
  const t = useTranslations("reports.spendTrend.table");
  const active = sort.by === column;
  let Icon = ArrowUpDown;
  if (active) Icon = sort.dir === "desc" ? ArrowDown : ArrowUp;
  return (
    <button
      type="button"
      onClick={() => onSort(column)}
      aria-label={t("sortBy", { column: label })}
      className={cn(
        "ml-auto inline-flex items-center gap-1 rounded-sm hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring",
        active && "text-foreground",
      )}
    >
      {label}
      <Icon className="size-3.5" />
    </button>
  );
}

export function SpendTrendTable({
  trend,
  selectedKey,
  colorOf,
  onSelect,
}: Readonly<{
  trend: SpendTrend;
  selectedKey: string | null;
  colorOf: (key: string) => string | undefined;
  onSelect: (key: string) => void;
}>) {
  const t = useTranslations("reports.spendTrend.table");
  const label = useItemLabel();
  const { compact, signedPercent } = useFormatters();
  const [sort, setSort] = useState<{ by: TrendSort; dir: "asc" | "desc" }>({ by: "total", dir: "desc" });
  const onSort = (by: TrendSort) =>
    setSort((s) => (s.by === by ? { by, dir: s.dir === "desc" ? "asc" : "desc" } : { by, dir: "desc" }));
  const items = sortTrendItems(trend.items, sort.by, sort.dir);
  const nameHeader = trend.dimension === "category" ? t("category") : t("party");

  return (
    <TableCard title={t("title")} action={t("count", { count: items.length })}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="sticky left-0 z-10 min-w-48 bg-card">{nameHeader}</TableHead>
            <TableHead>{t("trend")}</TableHead>
            {trend.months.map((m) => (
              <TableHead key={m} className="text-right tabular-nums">
                {fullLabel(m).slice(2)}
              </TableHead>
            ))}
            <TableHead className="text-right">
              <SortHeader label={t("total")} column="total" sort={sort} onSort={onSort} />
            </TableHead>
            <TableHead className="text-right">
              <SortHeader label={t("change")} column="change" sort={sort} onSort={onSort} />
            </TableHead>
            <TableHead className="w-8" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((it) => {
            const name = label(it);
            const color = colorOf(it.key) ?? OTHER_COLOR;
            const isSelected = it.key === selectedKey;
            let changeClass = "text-muted-foreground";
            if (it.change > 0) changeClass = "text-expense";
            else if (it.change < 0) changeClass = "text-income";
            return (
              <TableRow key={it.key} data-state={isSelected ? "selected" : undefined}>
                <TableCell className={cn("sticky left-0 z-10 bg-card", isSelected && "bg-muted")}>
                  <button
                    type="button"
                    onClick={() => onSelect(it.key)}
                    aria-pressed={isSelected}
                    className="flex max-w-56 items-center gap-2 rounded-sm text-left font-medium hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    <ItemMark item={it} label={name} color={color} />
                    <span className={cn("truncate", it.kind === "none" && "text-muted-foreground")}>{name}</span>
                    {it.isNew ? (
                      <Badge variant="outline" className="shrink-0 px-1.5 py-0 text-[10px]">
                        {t("new")}
                      </Badge>
                    ) : null}
                  </button>
                </TableCell>
                <TableCell>
                  <Sparkline values={it.monthly} color={color} />
                </TableCell>
                {it.monthly.map((v, i) => (
                  <TableCell
                    key={trend.months[i]}
                    className={cn("text-right text-xs tabular-nums", v === 0 && "text-muted-foreground/60")}
                  >
                    {v === 0 ? "—" : compact.format(Math.round(v))}
                  </TableCell>
                ))}
                <TableCell className="text-right font-medium tabular-nums">{money(it.total)}</TableCell>
                <TableCell className={cn("text-right tabular-nums", changeClass)}>
                  <div>
                    {it.change > 0 ? "+" : ""}
                    {money(it.change)}
                  </div>
                  <div className="text-xs">{it.changePct == null ? "—" : signedPercent.format(it.changePct)}</div>
                </TableCell>
                <TableCell>
                  <Link
                    href={transactionsHref(it)}
                    aria-label={name}
                    className="inline-flex rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    <ArrowUpRight className="size-4" />
                  </Link>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </TableCard>
  );
}

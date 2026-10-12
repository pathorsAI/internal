"use client";

/**
 * 報表「支出分析」：依類別 / 依廠商看每月支出。
 * 資料由 server 一次抓滿 12 個月（getMonthlySpendBreakdown），維度、6 / 12 個月與選取都在
 * client 端切（src/lib/spend-trend.ts），跟總覽「支出去向」同一個做法、同一個口徑。
 *
 * 由上而下：控制列 → 摘要卡 → 每月堆疊柱（前 8 名 + 其他）→ 選取項目的月柱 + 組成 → 明細表。
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, XAxis, YAxis } from "recharts";
import { ArrowUpRight, ChartColumnStacked, Sparkles, TrendingDown, TrendingUp, Trophy, Wallet } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import {
  compositionOf,
  summarizeSpendTrend,
  transactionsHref,
  TREND_PERIODS,
  type SpendTrend,
  type TrendDimension,
  type TrendInputRow,
  type TrendItem,
  type TrendPeriod,
} from "@/lib/spend-trend";
import { cn } from "@/lib/utils";
import {
  ItemMark,
  OTHER_COLOR,
  fullLabel,
  money,
  seriesColor,
  tickLabel,
  useFormatters,
  useItemLabel,
} from "./shared";
import { SpendTrendTable } from "./spend-trend-table";

// ---- 控制列 ----

function Controls({
  dimension,
  period,
  onDimension,
  onPeriod,
}: Readonly<{
  dimension: TrendDimension;
  period: TrendPeriod;
  onDimension: (v: TrendDimension) => void;
  onPeriod: (v: TrendPeriod) => void;
}>) {
  const t = useTranslations("reports.spendTrend");
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Tabs value={dimension} onValueChange={(v) => onDimension(v as TrendDimension)}>
        <TabsList className="h-8">
          <TabsTrigger value="category" className="px-2.5 text-xs">{t("dimension.category")}</TabsTrigger>
          <TabsTrigger value="party" className="px-2.5 text-xs">{t("dimension.party")}</TabsTrigger>
        </TabsList>
      </Tabs>
      <Tabs value={String(period)} onValueChange={(v) => onPeriod(Number(v) as TrendPeriod)}>
        <TabsList className="h-8">
          {TREND_PERIODS.map((p) => (
            <TabsTrigger key={p} value={String(p)} className="px-2.5 text-xs">
              {t(`period.${p}`)}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <span className="text-xs text-muted-foreground">{t("twdNote")}</span>
    </div>
  );
}

// ---- 摘要卡 ----

function StatCard({
  icon: Icon,
  label,
  children,
  footer,
}: Readonly<{
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}>) {
  return (
    <Card className="gap-2 p-4">
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Icon className="size-3.5" /> {label}
      </div>
      <div className="min-w-0">{children}</div>
      {footer ? <div className="text-xs text-muted-foreground">{footer}</div> : null}
    </Card>
  );
}

function SummaryCards({
  trend,
  colorOf,
}: Readonly<{ trend: SpendTrend; colorOf: (key: string) => string | undefined }>) {
  const t = useTranslations("reports.spendTrend.cards");
  const label = useItemLabel();
  const { signedPercent, percent } = useFormatters();
  const { summary, dimension, months } = trend;
  const up = summary.change > 0;
  const top = summary.top;
  // 支出變多是「壞消息」，用支出色；變少用收入色
  let changeColor = "text-foreground";
  if (summary.change > 0) changeColor = "text-expense";
  else if (summary.change < 0) changeColor = "text-income";

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard
        icon={Wallet}
        label={t("thisMonth")}
        footer={`${fullLabel(months.at(-1) ?? "")} · ${t("partialMonth")}`}
      >
        <p className="text-2xl font-semibold lg:text-xl 2xl:text-2xl tabular-nums">{money(summary.thisMonth)}</p>
      </StatCard>

      <StatCard
        icon={up ? TrendingUp : TrendingDown}
        label={t("vsLastMonth")}
        footer={t("lastMonthWas", { amount: money(summary.prevMonth) })}
      >
        <p className={cn("flex flex-wrap items-baseline gap-x-2 text-2xl font-semibold lg:text-xl 2xl:text-2xl tabular-nums", changeColor)}>
          <span className="whitespace-nowrap">
            {summary.change > 0 ? "+" : ""}
            {money(summary.change)}
          </span>
          <span className="text-sm font-medium whitespace-nowrap">
            {summary.changePct == null ? t("noBase") : signedPercent.format(summary.changePct)}
          </span>
        </p>
      </StatCard>

      <StatCard
        icon={Trophy}
        label={dimension === "category" ? t("topCategory") : t("topParty")}
        footer={
          top && summary.periodTotal > 0
            ? `${money(top.total)} · ${t("shareOfPeriod", { share: percent.format(top.total / summary.periodTotal) })}`
            : undefined
        }
      >
        {top ? (
          <p className="flex min-w-0 items-center gap-2 text-lg font-semibold">
            <ItemMark item={top} label={label(top)} color={colorOf(top.key)} />
            <span className="truncate">{label(top)}</span>
          </p>
        ) : (
          <p className="text-2xl font-semibold lg:text-xl 2xl:text-2xl text-muted-foreground">—</p>
        )}
      </StatCard>

      <StatCard
        icon={Sparkles}
        label={dimension === "category" ? t("newCategory") : t("newParty")}
        footer={t("newHint")}
      >
        <p className="text-2xl font-semibold lg:text-xl 2xl:text-2xl tabular-nums">{summary.newItems}</p>
      </StatCard>
    </div>
  );
}

// ---- 每月堆疊柱 ----

type SeriesView = { key: string; itemKey: string | null; label: string; color: string; item: TrendItem | null; members: number };

function StackTooltip({
  active,
  payload,
  label,
  series,
}: Readonly<{
  active?: boolean;
  payload?: ReadonlyArray<{ dataKey?: unknown; value?: unknown }>;
  label?: unknown;
  series: SeriesView[];
}>) {
  const t = useTranslations("reports.spendTrend");
  if (!active || !payload?.length) return null;
  const byKey = new Map(series.map((s) => [s.key, s]));
  const rows = payload
    .map((p) => ({ s: byKey.get(String(p.dataKey)), v: Number(p.value) }))
    .filter((r): r is { s: SeriesView; v: number } => r.s != null && r.v !== 0)
    .sort((a, b) => b.v - a.v);
  const total = rows.reduce((sum, r) => sum + r.v, 0);
  return (
    <div className="grid min-w-48 gap-1 rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl">
      <div className="font-medium">{fullLabel(typeof label === "string" ? label : "")}</div>
      {rows.map(({ s, v }) => (
        <div key={s.key} className="flex items-center gap-2">
          <span className="size-2.5 shrink-0 rounded-[2px]" style={{ background: s.color }} />
          <span className="flex-1 truncate text-muted-foreground">{s.label}</span>
          <span className="font-medium tabular-nums">{money(v)}</span>
        </div>
      ))}
      <div className="mt-0.5 flex justify-between gap-4 border-t pt-1">
        <span className="text-muted-foreground">{t("stack.total")}</span>
        <span className="font-medium tabular-nums">{money(total)}</span>
      </div>
    </div>
  );
}

function StackChart({
  trend,
  series,
  selectedKey,
  emphasize,
  onSelect,
}: Readonly<{
  trend: SpendTrend;
  series: SeriesView[];
  selectedKey: string | null;
  /** 使用者主動點選過才淡化其他序列（預設選取最大項時整張圖維持原色） */
  emphasize: boolean;
  onSelect: (key: string) => void;
}>) {
  const t = useTranslations("reports.spendTrend");
  const { compact } = useFormatters();
  const config = Object.fromEntries(series.map((s) => [s.key, { label: s.label, color: s.color }])) satisfies ChartConfig;
  const faded = (s: SeriesView) => emphasize && s.itemKey !== selectedKey;
  // 一般序列實心；未分類 / 未指定對象用灰色半透明、「其他」更淡，一眼分得出「沒歸類」
  const baseOpacity = (s: SeriesView) => {
    if (!s.itemKey) return 0.35;
    return s.item?.kind === "none" ? 0.6 : 0.9;
  };

  return (
    <Card className="gap-3">
      <CardHeader>
        <CardTitle className="flex flex-wrap items-baseline justify-between gap-2 text-sm font-medium">
          <span>{t("stack.title")}</span>
          <span className="text-xs font-normal text-muted-foreground">{t("stack.hint")}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <ChartContainer config={config} className="aspect-auto h-72 w-full">
          <BarChart data={trend.stack} margin={{ left: 4, right: 4 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="month" tickLine={false} axisLine={false} tickMargin={8} tickFormatter={tickLabel} />
            <YAxis tickLine={false} axisLine={false} width={48} tickFormatter={(v: number) => compact.format(v)} />
            <ChartTooltip cursor={{ fill: "var(--muted)", opacity: 0.5 }} content={<StackTooltip series={series} />} />
            {series.map((s, i) => (
              <Bar
                key={s.key}
                dataKey={s.key}
                stackId="spend"
                fill={s.color}
                fillOpacity={baseOpacity(s) * (faded(s) ? 0.3 : 1)}
                radius={i === series.length - 1 ? [3, 3, 0, 0] : 0}
                isAnimationActive={false}
                className={s.itemKey ? "cursor-pointer" : undefined}
                onClick={() => (s.itemKey ? onSelect(s.itemKey) : undefined)}
              />
            ))}
          </BarChart>
        </ChartContainer>

        {/* 圖例：頭像 / 色塊 + 名稱，點了就選取（「其他」不能選） */}
        <ul className="flex flex-wrap gap-x-1 gap-y-1">
          {series.map((s) => {
            const content = (
              <>
                {s.item ? (
                  <ItemMark item={s.item} label={s.label} color={s.color} size="sm" />
                ) : (
                  <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: s.color, opacity: 0.45 }} />
                )}
                <span className="max-w-40 truncate">{s.label}</span>
                {s.members > 1 ? (
                  <span className="text-muted-foreground">({t("otherMembers", { count: s.members })})</span>
                ) : null}
              </>
            );
            const cls = cn(
              "flex items-center gap-1.5 rounded-md px-2 py-1 text-xs",
              faded(s) && "opacity-50",
            );
            return (
              <li key={s.key}>
                {s.itemKey ? (
                  <button
                    type="button"
                    onClick={() => onSelect(s.itemKey!)}
                    aria-pressed={s.itemKey === selectedKey}
                    className={cn(cls, "hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring", s.itemKey === selectedKey && "bg-muted")}
                  >
                    {content}
                  </button>
                ) : (
                  <span className={cn(cls, "text-muted-foreground")}>{content}</span>
                )}
              </li>
            );
          })}
        </ul>

        {trend.unconverted > 0 ? (
          <p className="text-xs text-muted-foreground">{t("unconverted", { count: trend.unconverted })}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

// ---- 選取項目：月柱 + 組成 ----

/** 單一項目月柱的說明框：月份 + 金額（recharts 會 clone 並補上 active / payload / label）。 */
function MonthAmountTooltip({
  active,
  payload,
  label,
}: Readonly<{ active?: boolean; payload?: ReadonlyArray<{ value?: unknown }>; label?: unknown }>) {
  if (!active || !payload?.length) return null;
  return (
    <div className="grid gap-1 rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl">
      <div className="font-medium">{fullLabel(typeof label === "string" ? label : "")}</div>
      <div className="font-medium tabular-nums">{money(Number(payload[0].value))}</div>
    </div>
  );
}

function FocusCard({
  trend,
  item,
  color,
  rows,
  allMonths,
  period,
}: Readonly<{
  trend: SpendTrend;
  item: TrendItem;
  color: string;
  rows: readonly TrendInputRow[];
  allMonths: readonly string[];
  period: TrendPeriod;
}>) {
  const t = useTranslations("reports.spendTrend.focus");
  const label = useItemLabel();
  const { compact, percent } = useFormatters();
  const name = label(item);
  const data = trend.months.map((month, i) => ({ month, amount: item.monthly[i] }));
  const composition = useMemo(
    () => compositionOf(rows, allMonths, period, trend.dimension, item.key),
    [rows, allMonths, period, trend.dimension, item.key],
  );
  const config = { amount: { label: name, color } } satisfies ChartConfig;
  // 組成連到交易帳本：同時帶分類與對象兩個篩選
  const compositionHref = (c: (typeof composition)[number]) => {
    if (c.kind === "other") return null;
    const self = transactionsHref(item).split("?")[1];
    const other = transactionsHref(c).split("?")[1];
    return `/dashboard/transactions?${self}&${other}`;
  };

  return (
    <Card className="gap-4">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <ItemMark item={item} label={name} color={color} />
            <span className="truncate text-base font-semibold">{name}</span>
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
            <span>
              <span className="text-muted-foreground">{t("periodTotal")} </span>
              <span className="font-semibold tabular-nums">{money(item.total)}</span>
            </span>
            <span>
              <span className="text-muted-foreground">{t("average")} </span>
              <span className="font-semibold tabular-nums">{money(item.average)}</span>
            </span>
            <Link
              href={transactionsHref(item)}
              className="inline-flex items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground hover:underline"
            >
              {t("viewTransactions")} <ArrowUpRight className="size-3.5" />
            </Link>
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-6 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <ChartContainer config={config} className="aspect-auto h-56 w-full">
          <BarChart data={data} margin={{ left: 4, right: 4, top: 12 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="month" tickLine={false} axisLine={false} tickMargin={8} tickFormatter={tickLabel} />
            <YAxis tickLine={false} axisLine={false} width={48} tickFormatter={(v: number) => compact.format(v)} />
            <ChartTooltip
              cursor={{ fill: "var(--muted)", opacity: 0.5 }}
              content={<MonthAmountTooltip />}
            />
            <ReferenceLine
              y={item.average}
              stroke="var(--muted-foreground)"
              strokeDasharray="4 4"
              label={{
                value: `${t("averageLine")} ${compact.format(item.average)}`,
                position: "insideTopRight",
                className: "fill-muted-foreground text-[10px]",
              }}
            />
            <Bar dataKey="amount" radius={[3, 3, 0, 0]} isAnimationActive={false}>
              {data.map((d) => (
                <Cell key={d.month} fill={color} fillOpacity={item.kind === "none" ? 0.5 : 0.9} />
              ))}
            </Bar>
          </BarChart>
        </ChartContainer>

        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">
            {trend.dimension === "category" ? t("compositionCategory") : t("compositionParty")}
          </p>
          <ul className="space-y-2.5">
            {composition.map((c, i) => {
              const cLabel = label(c);
              const href = compositionHref(c);
              const cColor = c.kind === "other" || c.kind === "none" ? OTHER_COLOR : seriesColor(i);
              const head = (
                <span className="flex min-w-0 items-center gap-2">
                  {c.kind === "other" ? (
                    <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: OTHER_COLOR, opacity: 0.45 }} />
                  ) : (
                    <ItemMark item={c} label={cLabel} color={cColor} size="sm" />
                  )}
                  <span className="truncate">{cLabel}</span>
                </span>
              );
              return (
                <li key={c.key} className="space-y-1 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    {href ? (
                      <Link href={href} className="min-w-0 hover:underline">
                        {head}
                      </Link>
                    ) : (
                      <span className="min-w-0 text-muted-foreground">{head}</span>
                    )}
                    <span className="shrink-0 text-xs tabular-nums">
                      {money(c.total)} <span className="text-muted-foreground">· {percent.format(c.share)}</span>
                    </span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${Math.max(c.share * 100, 1)}%`, background: cColor, opacity: c.kind === "other" ? 0.45 : 0.85 }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}

// ---- 整頁 ----

export function SpendTrendView({
  months,
  rows,
}: Readonly<{ months: string[]; rows: TrendInputRow[] }>) {
  const t = useTranslations("reports.spendTrend");
  const label = useItemLabel();
  const [dimension, setDimension] = useState<TrendDimension>("category");
  const [period, setPeriod] = useState<TrendPeriod>(12);
  // 每個維度各記一個選取；null = 還沒點過 → 預設最大的那一項
  const [picked, setPicked] = useState<Record<TrendDimension, string | null>>({ category: null, party: null });

  const trend = useMemo(() => summarizeSpendTrend(rows, months, period, dimension), [rows, months, period, dimension]);
  const byKey = useMemo(() => new Map(trend.items.map((it) => [it.key, it])), [trend.items]);
  const pickedKey = picked[dimension];
  const selected = (pickedKey ? byKey.get(pickedKey) : undefined) ?? trend.items[0] ?? null;

  const series: SeriesView[] = trend.series.map((s, i) => {
    const item = s.itemKey ? (byKey.get(s.itemKey) ?? null) : null;
    return {
      key: s.key,
      itemKey: s.itemKey,
      item,
      members: s.members,
      color: item && item.kind !== "none" ? seriesColor(i) : OTHER_COLOR,
      label: item ? label(item) : t("other"),
    };
  });
  const colorByItem = new Map(series.flatMap((s) => (s.itemKey ? [[s.itemKey, s.color] as const] : [])));
  const colorOf = (key: string) => colorByItem.get(key);
  const select = (key: string) => setPicked((p) => ({ ...p, [dimension]: key }));

  return (
    <div className="grid gap-6">
      <Controls dimension={dimension} period={period} onDimension={setDimension} onPeriod={setPeriod} />
      <SummaryCards trend={trend} colorOf={colorOf} />
      {trend.items.length === 0 ? (
        <Card>
          <EmptyState icon={ChartColumnStacked} message={t("empty")} />
        </Card>
      ) : (
        <>
          <StackChart
            trend={trend}
            series={series}
            selectedKey={selected?.key ?? null}
            emphasize={pickedKey != null && selected?.key === pickedKey}
            onSelect={select}
          />
          {selected ? (
            <FocusCard
              trend={trend}
              item={selected}
              color={colorOf(selected.key) ?? OTHER_COLOR}
              rows={rows}
              allMonths={months}
              period={period}
            />
          ) : null}
          <SpendTrendTable trend={trend} selectedKey={selected?.key ?? null} colorOf={colorOf} onSelect={select} />
        </>
      )}
    </div>
  );
}

// ---- 載入中骨架 ----

/** 同版型的骨架：控制列、4 張摘要卡、堆疊柱、單項月柱與表格。 */
export function SpendTrendSkeleton() {
  const heights = ["h-1/3", "h-1/2", "h-2/5", "h-3/5", "h-1/2", "h-2/3", "h-3/4", "h-1/2", "h-3/5", "h-4/5", "h-2/3", "h-full"];
  return (
    <div className="grid gap-6" aria-busy>
      <div className="flex flex-wrap gap-2">
        <Skeleton className="h-8 w-36" />
        <Skeleton className="h-8 w-56" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {["a", "b", "c", "d"].map((k) => (
          <Card key={k} className="gap-2 p-4">
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="h-7 w-32" />
            <Skeleton className="h-3 w-20" />
          </Card>
        ))}
      </div>
      <Card className="gap-3">
        <CardHeader>
          <Skeleton className="h-4 w-48" />
        </CardHeader>
        <CardContent>
          <div className="flex h-72 items-end gap-3 px-12 pb-6">
            {heights.map((h, i) => (
              <Skeleton key={`${h}-${i}`} className={cn("flex-1 rounded-b-none", h)} />
            ))}
          </div>
        </CardContent>
      </Card>
      <Card className="gap-3">
        <CardHeader>
          <Skeleton className="h-5 w-40" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-56 w-full" />
        </CardContent>
      </Card>
    </div>
  );
}

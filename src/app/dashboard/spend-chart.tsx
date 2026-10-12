"use client";

/**
 * 總覽頁「支出去向」：近 N 個月的支出依交易對象（或分類）排名，前 8 名 + 其他。
 * 資料由 server 一次抓滿 12 個月（getSpendBreakdown），範圍與分組在 client 端切換
 * （src/lib/spend.ts），跟收支趨勢圖同一個做法。點一列 → 交易帳本篩選該對象 / 分類。
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Bar, BarChart, Cell, LabelList, XAxis, YAxis } from "recharts";
import { HandCoins } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/empty-state";
import { PartyAvatar } from "@/components/party-avatar";
import { formatCurrency } from "@/lib/currency";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  summarizeSpend,
  type SpendGroupBy,
  type SpendInputRow,
  type SpendItem,
  type SpendRange,
} from "@/lib/spend";
import { cn } from "@/lib/utils";

const ROW_HEIGHT = 40;
// 左邊「頭像 + 名稱」與右邊「金額 · 占比」的寬度；手機上縮窄、金額改用壓縮表示（1.2萬 / 12K）
const LABEL_WIDTH = 168;
const VALUE_WIDTH = 132;
const LABEL_WIDTH_SM = 108;
const VALUE_WIDTH_SM = 116;
const TICK_GAP = 8;

/** 長條旁邊的金額取整數（總覽看量級，不看角）。 */
const money = (v: number) => formatCurrency(Math.round(v), "TWD");

function itemHref(item: SpendItem): string | null {
  if (item.id == null) return null;
  if (item.kind === "party") return `/dashboard/transactions?party=${item.id}`;
  if (item.kind === "category") return `/dashboard/transactions?category=${item.id}`;
  return null;
}

type Row = SpendItem & { label: string; href: string | null };

/** 範圍與分組切換（標題列右側）。skeleton 也用同一組尺寸，載入完不會跳動。 */
function Controls({
  groupBy,
  range,
  onGroupBy,
  onRange,
}: Readonly<{
  groupBy: SpendGroupBy;
  range: SpendRange;
  onGroupBy: (v: SpendGroupBy) => void;
  onRange: (v: SpendRange) => void;
}>) {
  const t = useTranslations("dashboard.spend");
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Tabs value={groupBy} onValueChange={(v) => onGroupBy(v as SpendGroupBy)}>
        <TabsList className="h-8">
          <TabsTrigger value="party" className="px-2.5 text-xs">{t("byParty")}</TabsTrigger>
          <TabsTrigger value="category" className="px-2.5 text-xs">{t("byCategory")}</TabsTrigger>
        </TabsList>
      </Tabs>
      <Tabs value={range} onValueChange={(v) => onRange(v as SpendRange)}>
        <TabsList className="h-8">
          <TabsTrigger value="month" className="px-2.5 text-xs">{t("range.month")}</TabsTrigger>
          <TabsTrigger value="3m" className="px-2.5 text-xs">{t("range.3m")}</TabsTrigger>
          <TabsTrigger value="12m" className="px-2.5 text-xs">{t("range.12m")}</TabsTrigger>
        </TabsList>
      </Tabs>
    </div>
  );
}

function SectionTitle() {
  const t = useTranslations("dashboard.spend");
  return (
    <h2 className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
      <HandCoins className="size-4" /> {t("title")}
    </h2>
  );
}

/** Y 軸刻度：頭像 + 名稱，可點的是連結（鍵盤也點得到）。 */
function LabelTick({
  x,
  y,
  payload,
  rows,
  groupBy,
  width,
}: Readonly<{
  x?: number | string;
  y?: number | string;
  payload?: { value?: string };
  rows: Map<string, Row>;
  groupBy: SpendGroupBy;
  width: number;
}>) {
  const row = payload?.value ? rows.get(payload.value) : undefined;
  if (!row) return null;
  const content = (
    <>
      {groupBy === "party" && row.kind === "party" ? (
        <PartyAvatar name={row.label} partyId={row.id} avatarVersion={row.avatarVersion} size="md" />
      ) : null}
      <span className="truncate">{row.label}</span>
    </>
  );
  const className = cn(
    "flex h-full min-w-0 items-center gap-2 pr-2 text-sm",
    row.kind === "other" || row.kind === "none" ? "text-muted-foreground" : "text-foreground",
  );
  return (
    // 刻度的 x 是軸線左側（已扣掉 tick 長度），往回推 width 再補回那一小段，左邊才不會被裁掉
    <foreignObject x={Number(x) - width + TICK_GAP} y={Number(y) - ROW_HEIGHT / 2} width={width - TICK_GAP} height={ROW_HEIGHT}>
      {row.href ? (
        <Link href={row.href} className={cn(className, "rounded-sm hover:underline focus-visible:outline-2 focus-visible:outline-ring")}>
          {content}
        </Link>
      ) : (
        <div className={className}>{content}</div>
      )}
    </foreignObject>
  );
}

export function SpendChart({
  months,
  rows,
}: Readonly<{ months: string[]; rows: SpendInputRow[] }>) {
  const t = useTranslations("dashboard.spend");
  const locale = useLocale();
  const router = useRouter();
  const isMobile = useIsMobile();
  const labelWidth = isMobile ? LABEL_WIDTH_SM : LABEL_WIDTH;
  const valueWidth = isMobile ? VALUE_WIDTH_SM : VALUE_WIDTH;
  const [range, setRange] = useState<SpendRange>("3m");
  const [groupBy, setGroupBy] = useState<SpendGroupBy>("party");

  const percent = useMemo(
    () => new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1 }),
    [locale],
  );
  const compact = useMemo(
    () => new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }),
    [locale],
  );
  const barValue = (n: number) => (isMobile ? `NT$${compact.format(n)}` : money(n));
  const chartConfig = {
    total: { label: t("tooltip.amount"), color: "var(--expense)" },
  } satisfies ChartConfig;

  const summary = useMemo(() => summarizeSpend(rows, months, range, groupBy), [rows, months, range, groupBy]);
  const data: Row[] = useMemo(
    () =>
      summary.items.map((item) => {
        let label = item.name ?? "—";
        if (item.kind === "other") label = t("other");
        else if (item.kind === "none") label = groupBy === "party" ? t("unassignedParty") : t("uncategorized");
        return { ...item, label, href: itemHref(item) };
      }),
    [summary.items, groupBy, t],
  );
  const byKey = useMemo(() => new Map(data.map((r) => [r.key, r])), [data]);

  const go = (index: number) => {
    const href = data[index]?.href;
    if (href) router.push(href);
  };

  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SectionTitle />
        <Controls groupBy={groupBy} range={range} onGroupBy={setGroupBy} onRange={setRange} />
      </div>

      <Card className="gap-3">
        <CardHeader>
          <CardTitle className="flex items-baseline justify-between gap-2 text-sm font-medium text-muted-foreground">
            <span>{t("total", { range: t(`range.${range}`) })}</span>
            <span className="text-lg font-semibold tabular-nums text-foreground">{money(summary.total)}</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {data.length === 0 ? (
            <EmptyState icon={HandCoins} message={t("empty")} />
          ) : (
            <ChartContainer
              config={chartConfig}
              className="aspect-auto w-full"
              style={{ height: data.length * ROW_HEIGHT + 8 }}
            >
              <BarChart
                data={data}
                layout="vertical"
                margin={{ top: 4, bottom: 4, left: 0, right: valueWidth }}
                barCategoryGap={10}
              >
                <XAxis type="number" dataKey="total" hide domain={[0, "dataMax"]} />
                <YAxis
                  type="category"
                  dataKey="key"
                  width={labelWidth}
                  tickLine={false}
                  axisLine={false}
                  interval={0}
                  tick={(props) => <LabelTick {...props} rows={byKey} groupBy={groupBy} width={labelWidth} />}
                />
                <ChartTooltip
                  cursor={{ fill: "var(--muted)", opacity: 0.5 }}
                  content={({ active, payload }) => {
                    const row = active ? (payload?.[0]?.payload as Row | undefined) : undefined;
                    if (!row) return null;
                    return (
                      <div className="grid min-w-40 gap-1 rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl">
                        <div className="font-medium">{row.label}</div>
                        <div className="flex justify-between gap-4">
                          <span className="text-muted-foreground">{t("tooltip.amount")}</span>
                          <span className="font-medium tabular-nums">{money(row.total)}</span>
                        </div>
                        <div className="flex justify-between gap-4">
                          <span className="text-muted-foreground">{t("tooltip.share")}</span>
                          <span className="font-medium tabular-nums">{percent.format(row.share)}</span>
                        </div>
                        <div className="flex justify-between gap-4">
                          <span className="text-muted-foreground">{t("tooltip.count")}</span>
                          <span className="font-medium tabular-nums">{row.count}</span>
                        </div>
                        {row.kind === "other" ? (
                          <div className="text-muted-foreground">
                            {groupBy === "party"
                              ? t("tooltip.otherParties", { count: row.members })
                              : t("tooltip.otherCategories", { count: row.members })}
                          </div>
                        ) : null}
                      </div>
                    );
                  }}
                />
                <Bar
                  dataKey="total"
                  radius={[0, 4, 4, 0]}
                  maxBarSize={22}
                  onClick={(_, index) => go(index)}
                  isAnimationActive={false}
                >
                  {data.map((row) => (
                    <Cell
                      key={row.key}
                      fill={row.kind === "other" || row.kind === "none" ? "var(--muted-foreground)" : "var(--color-total)"}
                      fillOpacity={row.kind === "other" || row.kind === "none" ? 0.45 : 0.85}
                      className={row.href ? "cursor-pointer" : undefined}
                    />
                  ))}
                  <LabelList
                    dataKey="total"
                    // 自己畫 <text>：內建的 label 會依剩餘寬度自動換行，金額與占比被拆成兩行
                    content={(props) => {
                      const n = Number(props.value);
                      const share = summary.total > 0 ? n / summary.total : 0;
                      return (
                        <text
                          x={Number(props.x) + Number(props.width) + 8}
                          y={Number(props.y) + Number(props.height) / 2}
                          dominantBaseline="central"
                          className="fill-foreground text-xs tabular-nums"
                        >
                          {barValue(n)}
                          <tspan className="fill-muted-foreground"> · {percent.format(share)}</tspan>
                        </text>
                      );
                    }}
                  />
                </Bar>
              </BarChart>
            </ChartContainer>
          )}
          {summary.unconverted > 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">
              {t("unconverted", { count: summary.unconverted })}
            </p>
          ) : null}
        </CardContent>
      </Card>
    </section>
  );
}

/** 載入中的骨架：同樣的標題列、卡片與 8 列「頭像 + 名稱 + 長條 + 金額」。 */
export function SpendSkeleton() {
  const widths = ["w-full", "w-11/12", "w-4/5", "w-3/5", "w-1/2", "w-2/5", "w-1/3", "w-1/4"];
  return (
    <section className="space-y-2" aria-busy>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <SectionTitle />
        <div className="flex gap-2">
          <Skeleton className="h-8 w-36" />
          <Skeleton className="h-8 w-52" />
        </div>
      </div>
      <Card className="gap-3">
        <CardHeader>
          <div className="flex items-baseline justify-between gap-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-6 w-28" />
          </div>
        </CardHeader>
        <CardContent className="space-y-0">
          {widths.map((w) => (
            <div key={w} className="flex items-center gap-2" style={{ height: ROW_HEIGHT }}>
              <div className="flex shrink-0 items-center gap-2" style={{ width: LABEL_WIDTH }}>
                <Skeleton className="size-7 rounded-md" />
                <Skeleton className="h-3.5 w-20" />
              </div>
              <div className="flex flex-1 items-center gap-2">
                <div className="flex-1">
                  <Skeleton className={cn("h-5", w)} />
                </div>
                <Skeleton className="h-3.5 shrink-0" style={{ width: VALUE_WIDTH - 16 }} />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </section>
  );
}

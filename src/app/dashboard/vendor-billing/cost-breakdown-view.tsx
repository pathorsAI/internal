"use client";

/**
 * 廠商計費「花費明細」：雲端帳號每月的錢花在哪。
 * 資料在 client 端用 server action 抓（costBreakdownAction），切帳號 / 月份只換這一塊，
 * 載入時畫跟真實版面同尺寸的 skeleton。帳號與月份寫在網址上（?view=costs&account=1&month=2026-10）。
 *
 * 由上而下：控制列 → 圖（近 6 個月 × 服務堆疊長條｜本月依服務排序）→ 服務表（可展開看 SKU / 資源）。
 */

import * as React from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Bar, BarChart, CartesianGrid, LabelList, XAxis, YAxis } from "recharts";
import { ChevronRight, Cloud } from "lucide-react";
import { Card } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, type ChartConfig } from "@/components/ui/chart";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState } from "@/components/empty-state";
import { TableCard } from "@/components/table-card";
import { formatCurrency } from "@/lib/currency";
import { cn } from "@/lib/utils";
import { OTHER_SERVICE, type CostBreakdown, type CostService } from "@/lib/vendor-billing/cost-breakdown";
import { costBreakdownAction, type CostBreakdownResult } from "./actions";

const SERIES_COLORS = ["var(--chart-1)", "var(--chart-3)", "var(--chart-5)", "var(--chart-2)", "var(--chart-6)", "var(--chart-4)"];
const OTHER_COLOR = "var(--muted-foreground)";

/** "2026-10-01" → "2026/10"；短版 "26/10" 給 X 軸。 */
const monthLabel = (m: string) => m.slice(0, 7).replace("-", "/");
const monthTick = (m: string) => m.slice(2, 7).replace("-", "/");
/** 網址上的月份是 YYYY-MM */
const toParam = (m: string) => m.slice(0, 7);
const fromParam = (v: string | null) => (v && /^\d{4}-\d{2}$/.test(v) ? `${v}-01` : null);

function useMoney(currency: string | null) {
  const locale = useLocale();
  return React.useMemo(() => {
    const cur = currency ?? "USD";
    const compact = new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 });
    const pct = new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 0, signDisplay: "exceptZero" });
    return {
      full: (v: number) => formatCurrency(Math.round(v * 100) / 100, cur),
      /** 0 寫成「—」，表格裡一整欄 US$0 只是雜訊 */
      cell: (v: number) => (Math.abs(v) < 0.005 ? "—" : formatCurrency(Math.round(v * 100) / 100, cur)),
      whole: (v: number) => formatCurrency(Math.round(v), cur),
      compact: (v: number) => compact.format(v),
      pct: (v: number) => pct.format(v),
    };
  }, [locale, currency]);
}

// ---- 控制列 ----

function Controls({
  data,
  accountId,
  month,
  onAccount,
  onMonth,
}: Readonly<{
  data: Extract<CostBreakdownResult, { ok: true }> | null;
  accountId: number | null;
  month: string | null;
  onAccount: (id: number) => void;
  onMonth: (m: string) => void;
}>) {
  const t = useTranslations("vendorBilling.costs");
  const accounts = data?.accounts ?? [];
  const months = accounts.find((a) => a.id === accountId)?.months ?? [];
  return (
    <div className="flex flex-wrap items-center gap-2">
      {accounts.length > 1 ? (
        <Select value={accountId ? String(accountId) : undefined} onValueChange={(v) => onAccount(Number(v))}>
          <SelectTrigger size="sm" className="w-56" aria-label={t("account")}>
            <SelectValue placeholder={t("account")} />
          </SelectTrigger>
          <SelectContent>
            {accounts.map((a) => (
              <SelectItem key={a.id} value={String(a.id)}>
                <span className="text-muted-foreground uppercase">{a.provider}</span> {a.displayName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : null}
      <Select value={month ?? undefined} onValueChange={onMonth} disabled={months.length === 0}>
        <SelectTrigger size="sm" className="w-40" aria-label={t("month")}>
          <SelectValue placeholder={t("month")} />
        </SelectTrigger>
        <SelectContent>
          {months.map((m) => (
            <SelectItem key={m} value={m}>
              {monthLabel(m)}
              {m === data?.currentMonth ? <span className="text-muted-foreground">{t("monthToDate")}</span> : null}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

// ---- 圖 ----

type Series = { key: string; label: string; color: string };

function StackTooltip({
  active,
  payload,
  label,
  series,
  money,
}: Readonly<{
  active?: boolean;
  payload?: ReadonlyArray<{ dataKey?: unknown; value?: unknown }>;
  label?: unknown;
  series: Series[];
  money: (v: number) => string;
}>) {
  const t = useTranslations("vendorBilling.costs");
  if (!active || !payload?.length) return null;
  const byKey = new Map(series.map((s) => [s.key, s]));
  const rows = payload
    .map((p) => ({ s: byKey.get(String(p.dataKey)), v: Number(p.value) }))
    .filter((r): r is { s: Series; v: number } => r.s != null && r.v !== 0)
    .sort((a, b) => b.v - a.v);
  const total = rows.reduce((sum, r) => sum + r.v, 0);
  return (
    <div className="grid min-w-52 gap-1 rounded-lg border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-lg">
      <div className="font-medium">{monthLabel(typeof label === "string" ? label : "")}</div>
      {rows.map(({ s, v }) => (
        <div key={s.key} className="flex items-center gap-2">
          <span className="size-2.5 shrink-0 rounded-[2px]" style={{ background: s.color }} />
          <span className="flex-1 truncate text-muted-foreground">{s.label}</span>
          <span className="font-medium tabular-nums">{money(v)}</span>
        </div>
      ))}
      <div className="mt-0.5 flex justify-between gap-4 border-t pt-1">
        <span className="text-muted-foreground">{t("total")}</span>
        <span className="font-medium tabular-nums">{money(total)}</span>
      </div>
    </div>
  );
}

function Charts({ b }: Readonly<{ b: CostBreakdown }>) {
  const t = useTranslations("vendorBilling.costs");
  const money = useMoney(b.currency);
  const series: Series[] = b.trendServices.map((key, i) => ({
    key,
    label: key === OTHER_SERVICE ? t("other") : key,
    color: key === OTHER_SERVICE ? OTHER_COLOR : SERIES_COLORS[i % SERIES_COLORS.length],
  }));
  // recharts 的 dataKey 不能含 "."，服務名稱改用序號當鍵
  const keyOf = new Map(series.map((s, i) => [s.key, `s${i}`]));
  const stack = b.trend.map((p) => ({
    month: p.month,
    ...Object.fromEntries(series.map((s) => [keyOf.get(s.key)!, p.byService[s.key] ?? 0])),
  }));
  const stackSeries = series.map((s) => ({ ...s, key: keyOf.get(s.key)! }));
  const stackConfig = Object.fromEntries(stackSeries.map((s) => [s.key, { label: s.label, color: s.color }])) satisfies ChartConfig;

  const ranked = b.services.filter((s) => s.listAmount > 0).slice(0, 10);
  const rankData = ranked.map((s) => ({ service: s.service, value: s.listAmount }));
  const rankConfig = { value: { label: t("columns.list"), color: "var(--chart-1)" } } satisfies ChartConfig;

  return (
    <Card className="grid gap-0 p-0 lg:grid-cols-[3fr_2fr] lg:divide-x">
      <section className="flex min-w-0 flex-col gap-3 p-4">
        <h2 className="text-sm font-medium text-muted-foreground">{t("trendTitle")}</h2>
        <ChartContainer config={stackConfig} className="aspect-auto h-64 w-full">
          <BarChart data={stack} margin={{ left: 4, right: 4 }}>
            <CartesianGrid vertical={false} stroke="var(--border-soft)" />
            <XAxis dataKey="month" tickLine={false} axisLine={false} tickMargin={8} tickFormatter={monthTick} />
            <YAxis tickLine={false} axisLine={false} width={44} tickFormatter={money.compact} />
            <ChartTooltip cursor={{ fill: "var(--muted)", opacity: 0.5 }} content={<StackTooltip series={stackSeries} money={money.whole} />} />
            {stackSeries.map((s, i) => (
              <Bar
                key={s.key}
                dataKey={s.key}
                stackId="cost"
                fill={s.color}
                fillOpacity={s.color === OTHER_COLOR ? 0.35 : 0.9}
                radius={i === stackSeries.length - 1 ? [4, 4, 0, 0] : 0}
                maxBarSize={36}
                animationDuration={500}
              />
            ))}
          </BarChart>
        </ChartContainer>
        <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
          {series.map((s) => (
            <li key={s.key} className="flex items-center gap-1.5">
              <span className="size-2.5 shrink-0 rounded-[3px]" style={{ background: s.color, opacity: s.color === OTHER_COLOR ? 0.45 : 1 }} />
              <span className="max-w-40 truncate">{s.label}</span>
            </li>
          ))}
        </ul>
      </section>
      <section className="flex min-w-0 flex-col gap-3 border-t p-4 lg:border-t-0">
        <h2 className="text-sm font-medium text-muted-foreground">{t("rankTitle", { month: monthLabel(b.month) })}</h2>
        <ChartContainer config={rankConfig} className="aspect-auto w-full" style={{ height: Math.max(120, rankData.length * 28 + 16) }}>
          <BarChart data={rankData} layout="vertical" margin={{ left: 0, right: 84 }}>
            <XAxis type="number" hide domain={[0, "dataMax"]} />
            <YAxis type="category" dataKey="service" tickLine={false} axisLine={false} width={148} tick={{ fontSize: 12 }} />
            <Bar dataKey="value" fill="var(--chart-1)" fillOpacity={0.9} radius={[0, 4, 4, 0]} maxBarSize={18} animationDuration={500}>
              <LabelList dataKey="value" position="right" className="fill-foreground text-xs tabular-nums" formatter={(v: unknown) => money.whole(Number(v))} />
            </Bar>
          </BarChart>
        </ChartContainer>
        <span className="sr-only">{ranked.map((s) => `${s.service} ${money.whole(s.listAmount)}`).join("、")}</span>
      </section>
    </Card>
  );
}

// ---- 表 ----

function Delta({ now, prev, money }: Readonly<{ now: number; prev: number; money: ReturnType<typeof useMoney> }>) {
  const diff = now - prev;
  if (Math.abs(diff) < 0.005) return <span className="text-muted-foreground">—</span>;
  // 花費變多是要留意的事（琥珀），變少用收入色；不用紅
  return (
    <span className={cn("tabular-nums", diff > 0 ? "text-warning" : "text-income")}>
      {diff > 0 ? "+" : "−"}
      {money.whole(Math.abs(diff))}
      {prev > 0.005 ? <span className="ml-1 text-xs text-muted-foreground">{money.pct(diff / prev)}</span> : null}
    </span>
  );
}

function ServiceRows({
  s,
  open,
  onToggle,
  cols,
  money,
}: Readonly<{
  s: CostService;
  open: boolean;
  onToggle: () => void;
  cols: { discount: boolean; credit: boolean; net: boolean };
  money: ReturnType<typeof useMoney>;
}>) {
  const expandable = s.details.length > 0;
  return (
    <>
      <TableRow
        className={cn(expandable && "cursor-pointer", open && "bg-muted/40")}
        onClick={expandable ? onToggle : undefined}
        aria-expanded={expandable ? open : undefined}
      >
        <TableCell className="font-medium">
          <span className="flex items-center gap-1.5">
            <ChevronRight
              className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-90", !expandable && "invisible")}
            />
            <span className="truncate">{s.service}</span>
            {expandable ? <span className="text-xs font-normal text-muted-foreground">{s.details.length}</span> : null}
          </span>
        </TableCell>
        <TableCell className="text-right tabular-nums">{money.full(s.listAmount)}</TableCell>
        {cols.discount ? <TableCell className="text-right text-muted-foreground tabular-nums">{money.cell(s.discount)}</TableCell> : null}
        {cols.credit ? <TableCell className="text-right text-muted-foreground tabular-nums">{money.cell(s.credit)}</TableCell> : null}
        {cols.net ? <TableCell className="text-right font-medium tabular-nums">{money.cell(s.net)}</TableCell> : null}
        <TableCell className="text-right text-muted-foreground tabular-nums">{money.whole(s.prevListAmount)}</TableCell>
        <TableCell className="text-right">
          <Delta now={s.listAmount} prev={s.prevListAmount} money={money} />
        </TableCell>
      </TableRow>
      {open
        ? s.details.map((d) => (
            <TableRow key={d.key} className="text-[13px] hover:bg-transparent">
              <TableCell className="pl-11">
                <div className="truncate">{d.label}</div>
                {d.sub ? <div className="truncate text-xs text-muted-foreground">{d.sub}</div> : null}
              </TableCell>
              <TableCell className="text-right tabular-nums">{money.full(d.listAmount)}</TableCell>
              {cols.discount ? <TableCell className="text-right text-muted-foreground tabular-nums">{money.cell(d.discount)}</TableCell> : null}
              {cols.credit ? <TableCell className="text-right text-muted-foreground tabular-nums">{money.cell(d.credit)}</TableCell> : null}
              {cols.net ? <TableCell className="text-right tabular-nums">{money.cell(d.net)}</TableCell> : null}
              <TableCell className="text-right text-muted-foreground tabular-nums">{money.whole(d.prevListAmount)}</TableCell>
              <TableCell className="text-right text-xs">
                <Delta now={d.listAmount} prev={d.prevListAmount} money={money} />
              </TableCell>
            </TableRow>
          ))
        : null}
    </>
  );
}

function ServiceTable({ b }: Readonly<{ b: CostBreakdown }>) {
  const t = useTranslations("vendorBilling.costs");
  const money = useMoney(b.currency);
  const [open, setOpen] = React.useState<ReadonlySet<string>>(new Set());
  const cols = {
    discount: b.services.some((s) => Math.abs(s.discount) >= 0.005),
    credit: b.services.some((s) => Math.abs(s.credit) >= 0.005),
    net: false,
  };
  // 沒有折扣也沒有抵用（Azure）時原價就是淨額，只留一欄「金額」
  cols.net = cols.discount || cols.credit;
  const toggle = (service: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(service)) next.delete(service);
      else next.add(service);
      return next;
    });

  return (
    <TableCard
      title={t("tableTitle", { month: monthLabel(b.month) })}
      action={b.currency ? t("currencyNote", { currency: b.currency }) : null}
    >
      <div className="overflow-x-auto">
        <Table className={cn("table-fixed", cols.net ? "min-w-[760px]" : "min-w-[560px]")}>
          <colgroup>
            <col />
            <col className="w-28" />
            {cols.discount ? <col className="w-28" /> : null}
            {cols.credit ? <col className="w-28" /> : null}
            {cols.net ? <col className="w-28" /> : null}
            <col className="w-28" />
            <col className="w-36" />
          </colgroup>
          <TableHeader>
            <TableRow>
              <TableHead>{t("columns.service")}</TableHead>
              <TableHead className="text-right">{cols.net ? t("columns.list") : t("columns.amount")}</TableHead>
              {cols.discount ? <TableHead className="text-right">{t("columns.discount")}</TableHead> : null}
              {cols.credit ? <TableHead className="text-right">{t("columns.credit")}</TableHead> : null}
              {cols.net ? <TableHead className="text-right">{t("columns.net")}</TableHead> : null}
              <TableHead className="text-right">{t("columns.prev", { month: monthLabel(b.prevMonth) })}</TableHead>
              <TableHead className="text-right">{t("columns.change")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {b.services.map((s) => (
              <ServiceRows key={s.service} s={s} open={open.has(s.service)} onToggle={() => toggle(s.service)} cols={cols} money={money} />
            ))}
          </TableBody>
          <TableFooter>
            <TableRow className="font-medium">
              <TableCell className="pl-[38px]">{t("total")}</TableCell>
              <TableCell className="text-right tabular-nums">{money.full(b.total.listAmount)}</TableCell>
              {cols.discount ? <TableCell className="text-right tabular-nums">{money.full(b.total.discount)}</TableCell> : null}
              {cols.credit ? <TableCell className="text-right tabular-nums">{money.full(b.total.credit)}</TableCell> : null}
              {cols.net ? <TableCell className="text-right tabular-nums">{money.full(b.total.net)}</TableCell> : null}
              <TableCell className="text-right tabular-nums">{money.whole(b.prevTotal.listAmount)}</TableCell>
              <TableCell className="text-right">
                <Delta now={b.total.listAmount} prev={b.prevTotal.listAmount} money={money} />
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </div>
    </TableCard>
  );
}

// ---- skeleton：跟真實版面同尺寸 ----

function CostSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true">
      <Card className="grid gap-0 p-0 lg:grid-cols-[3fr_2fr] lg:divide-x">
        <div className="flex flex-col gap-3 p-4">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>
        <div className="flex flex-col gap-3 border-t p-4 lg:border-t-0">
          <Skeleton className="h-4 w-32" />
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={`bar-${i}`} className="h-4" style={{ width: `${90 - i * 9}%` }} />
          ))}
        </div>
      </Card>
      <TableCard title={<Skeleton className="h-4 w-32" />}>
        <div className="divide-y">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={`row-${i}`} className="flex h-10 items-center gap-4 px-4">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="ml-auto h-4 w-20" />
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-4 w-24" />
            </div>
          ))}
        </div>
      </TableCard>
    </div>
  );
}

// ---- 主元件 ----

export function CostBreakdownView() {
  const t = useTranslations("vendorBilling.costs");
  const pathname = usePathname();
  const params = useSearchParams();
  const [query, setQuery] = React.useState<{ accountId: number | null; month: string | null }>(() => ({
    accountId: Number(params.get("account")) || null,
    month: fromParam(params.get("month")),
  }));
  // 結果連同它是哪一組查詢抓的一起存：查詢換了、結果還沒回來，就是載入中
  const [result, setResult] = React.useState<{ for: typeof query; res: CostBreakdownResult } | null>(null);
  const data = result?.res ?? null;
  const loading = result?.for !== query;

  React.useEffect(() => {
    let alive = true;
    costBreakdownAction(query)
      .then((res) => {
        if (alive) setResult({ for: query, res });
      })
      .catch(() => {
        if (alive) setResult({ for: query, res: { ok: false, error: t("loadFailed") } });
      });
    return () => {
      alive = false;
    };
  }, [query, t]);

  const ok = data?.ok ? data : null;
  const accountId = ok?.accountId ?? query.accountId;
  const month = ok?.breakdown?.month ?? query.month;

  function change(next: { accountId?: number; month?: string }) {
    const q = { accountId: next.accountId ?? accountId, month: next.accountId ? null : (next.month ?? month) };
    setQuery(q);
    const sp = new URLSearchParams(params.toString());
    sp.set("view", "costs");
    if (q.accountId) sp.set("account", String(q.accountId));
    if (q.month) sp.set("month", toParam(q.month));
    else sp.delete("month");
    // 只改網址不重跑 server page（Next 會同步 useSearchParams）；資料由上面的 effect 抓
    window.history.replaceState(null, "", `${pathname}?${sp.toString()}`);
  }

  let body: React.ReactNode;
  if (loading && !ok) body = <CostSkeleton />;
  else if (data && !data.ok) body = <EmptyState icon={Cloud} message={data.error} />;
  else if (!ok?.breakdown) body = <EmptyState icon={Cloud} message={t("empty")} />;
  else
    body = (
      <div className={cn("flex flex-col gap-4 transition-opacity", loading && "pointer-events-none opacity-60")}>
        <Charts b={ok.breakdown} />
        <ServiceTable b={ok.breakdown} />
      </div>
    );

  return (
    <>
      <Controls
        data={ok}
        accountId={accountId}
        month={month}
        onAccount={(id) => change({ accountId: id })}
        onMonth={(m) => change({ month: m })}
      />
      {body}
    </>
  );
}

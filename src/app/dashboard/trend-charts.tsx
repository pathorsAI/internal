"use client";

/**
 * 總覽頁趨勢圖表：每月收支長條圖 + 帳戶餘額走勢圖。
 * 資料由 server 端一次抓滿 12 個月，篩選（帳戶 / 幣別 / 6 或 12 個月）皆在
 * client 端切換，不需重新載入頁面。不同幣別不混加：一次只看一種幣別。
 */

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { ChartLine } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmptyState } from "@/components/empty-state";
import { CurrencyFlag } from "@/components/currency-flag";
import type { MonthlyTrends } from "@/db/queries";
import { formatCurrency, CURRENCIES, DEFAULT_CURRENCY } from "@/lib/currency";

type AccountOption = { id: number; name: string; currency: string };

/** "2025-08" → "25/08"（X 軸刻度）；tooltip 用完整 "2025/08"。 */
const tickLabel = (ym: string) => ym.slice(2).replace("-", "/");
const fullLabel = (ym: React.ReactNode) => String(ym).replace("-", "/");

/**
 * Y 軸刻度：壓縮表示（zh-TW 的 1.5萬、en 的 15K），跨語系交給 Intl —— 所以格式化
 * 器要跟著當下語系建，不能寫死。
 */
function useCompactNumber() {
  const locale = useLocale();
  return useMemo(
    () => new Intl.NumberFormat(locale, { notation: "compact" }),
    [locale],
  );
}

export function TrendCharts({
  accounts,
  trends,
}: Readonly<{ accounts: AccountOption[]; trends: MonthlyTrends }>) {
  const t = useTranslations("dashboard");
  const tc = useTranslations("common.currency");
  const compact = useCompactNumber();
  // CURRENCIES.code is typed as a plain string; the catalogue is keyed by the
  // same codes, so narrow it at the boundary rather than widening the messages.
  const currencyName = (code: string) => tc(code as Parameters<typeof tc>[0]);
  const chartConfig = {
    income: { label: t("trend.tooltip.income"), color: "var(--income)" },
    expense: { label: t("trend.tooltip.expense"), color: "var(--expense)" },
    balance: { label: t("trend.tooltip.balance"), color: "var(--chart-1)" },
  } satisfies ChartConfig;
  const [range, setRange] = useState<"6" | "12">("6");
  const [scope, setScope] = useState<string>("all"); // "all" 或帳戶 id
  // 幣別清單依 CURRENCIES 註冊順序排序（TWD 最前），未登記的幣別排在最後。
  const currencies = useMemo(() => {
    const order = new Map(CURRENCIES.map((c, i) => [c.code, i]));
    const present = new Set<string>([
      ...accounts.map((a) => a.currency),
      ...trends.totals.map((t) => t.currency),
    ]);
    return [...present].sort(
      (a, b) => (order.get(a) ?? 99) - (order.get(b) ?? 99) || a.localeCompare(b),
    );
  }, [accounts, trends.totals]);
  const pickDefaultCurrency = (list: string[]) =>
    list.includes(DEFAULT_CURRENCY) ? DEFAULT_CURRENCY : (list[0] ?? DEFAULT_CURRENCY);
  const [allCurrency, setAllCurrency] = useState<string>(() =>
    pickDefaultCurrency(currencies),
  );
  // 若資料改變導致目前選的幣別已不存在（例如切換組織後 props 更新但元件未卸載），
  // 自動退回預設幣別，避免圖表卡在空狀態。
  const effectiveAllCurrency = currencies.includes(allCurrency)
    ? allCurrency
    : pickDefaultCurrency(currencies);

  const selectedAccount =
    scope === "all" ? undefined : accounts.find((a) => String(a.id) === scope);
  const currency = selectedAccount?.currency ?? effectiveAllCurrency;

  const months = trends.months.slice(-Number(range));

  // 每月收支：全部帳戶時用全組織口徑（同總覽卡），單一帳戶時只算流經該帳戶的收支
  const flowData = useMemo(() => {
    const byMonth = new Map(months.map((m) => [m, { month: m, income: 0, expense: 0 }]));
    if (selectedAccount) {
      for (const f of trends.accountFlows) {
        const row = byMonth.get(f.month);
        if (row && f.accountId === selectedAccount.id) {
          row.income += f.income;
          row.expense += f.expense;
        }
      }
    } else {
      for (const t of trends.totals) {
        const row = byMonth.get(t.month);
        if (row && t.currency === currency) {
          row.income += t.income;
          row.expense += t.expense;
        }
      }
    }
    return [...byMonth.values()];
  }, [months, selectedAccount, trends, currency]);

  // 餘額走勢：視窗起點餘額 + 逐月淨流量累加（含轉帳），取每月月底餘額
  const balanceData = useMemo(() => {
    const inScope = selectedAccount
      ? [selectedAccount.id]
      : accounts.filter((a) => a.currency === currency).map((a) => a.id);
    const scopeSet = new Set(inScope);
    let balance = trends.startBalances
      .filter((b) => scopeSet.has(b.accountId))
      .reduce((sum, b) => sum + b.balance, 0);
    // 6 個月視角也要先把視窗外（前 6 個月）的淨流量滾進期初
    const skipped = new Set(trends.months.filter((m) => !months.includes(m)));
    for (const f of trends.accountFlows) {
      if (skipped.has(f.month) && scopeSet.has(f.accountId)) balance += f.net;
    }
    const netByMonth = new Map<string, number>();
    for (const f of trends.accountFlows) {
      if (scopeSet.has(f.accountId)) {
        netByMonth.set(f.month, (netByMonth.get(f.month) ?? 0) + f.net);
      }
    }
    const rows: { month: string; balance: number }[] = [];
    for (const m of months) {
      balance += netByMonth.get(m) ?? 0;
      rows.push({ month: m, balance });
    }
    return rows;
  }, [months, selectedAccount, accounts, trends, currency]);

  const hasFlow = flowData.some((d) => d.income !== 0 || d.expense !== 0);
  const hasBalance = balanceData.some((d) => d.balance !== 0);

  // tooltip 內容：色點 + 標籤 + 依幣別格式化的金額
  const money = (value: unknown, name: unknown) => {
    const key = String(name) as keyof typeof chartConfig;
    const cfg = chartConfig[key];
    return (
      <>
        <div
          className="h-2.5 w-2.5 shrink-0 rounded-[2px]"
          style={{ background: cfg?.color }}
        />
        <div className="flex flex-1 items-center justify-between gap-4 leading-none">
          <span className="text-muted-foreground">{cfg?.label ?? String(name)}</span>
          <span className="font-medium tabular-nums text-foreground">
            {formatCurrency(Number(value), currency)}
          </span>
        </div>
      </>
    );
  };

  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
          <ChartLine className="size-4" /> {t("trend.title")}
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          {scope === "all" && currencies.length > 1 && (
            <Tabs value={effectiveAllCurrency} onValueChange={setAllCurrency}>
              <TabsList className="h-8">
                {currencies.map((c) => (
                  <TabsTrigger key={c} value={c} className="gap-1.5 px-2.5 text-xs">
                    <CurrencyFlag currency={c} className="h-3" />
                    {currencyName(c)}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          )}
          <Select value={scope} onValueChange={setScope}>
            <SelectTrigger size="sm" className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("trend.allAccounts")}</SelectItem>
              {currencies.map((c) => {
                const group = accounts.filter((a) => a.currency === c);
                if (group.length === 0) return null;
                return (
                  <SelectGroup key={c}>
                    <SelectLabel>{currencyName(c)}</SelectLabel>
                    {group.map((a) => (
                      <SelectItem key={a.id} value={String(a.id)}>
                        {a.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                );
              })}
            </SelectContent>
          </Select>
          <Tabs value={range} onValueChange={(v) => setRange(v as "6" | "12")}>
            <TabsList className="h-8">
              <TabsTrigger value="6" className="px-2.5 text-xs">{t("trend.months6")}</TabsTrigger>
              <TabsTrigger value="12" className="px-2.5 text-xs">{t("trend.months12")}</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="gap-3">
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {selectedAccount
                ? t("trend.flowTitleWithAccount", { account: selectedAccount.name })
                : t("trend.flowTitle")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {hasFlow ? (
              <ChartContainer config={chartConfig} className="h-56 w-full">
                <BarChart data={flowData} margin={{ left: 4, right: 4 }}>
                  <CartesianGrid vertical={false} />
                  <XAxis
                    dataKey="month"
                    tickLine={false}
                    axisLine={false}
                    tickMargin={8}
                    tickFormatter={tickLabel}
                  />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    width={48}
                    tickFormatter={(v: number) => compact.format(v)}
                  />
                  <ChartTooltip
                    content={
                      <ChartTooltipContent labelFormatter={fullLabel} formatter={money} />
                    }
                  />
                  <Bar dataKey="income" fill="var(--color-income)" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="expense" fill="var(--color-expense)" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ChartContainer>
            ) : (
              <EmptyState icon={ChartLine} message={t("trend.flowEmpty")} />
            )}
          </CardContent>
        </Card>

        <Card className="gap-3">
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">
              {selectedAccount
                ? t("trend.balanceTitleWithAccount", { account: selectedAccount.name })
                : t("trend.balanceTitle")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {hasBalance ? (
              <ChartContainer config={chartConfig} className="h-56 w-full">
                <AreaChart data={balanceData} margin={{ left: 4, right: 4 }}>
                  <defs>
                    <linearGradient id="fillBalance" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--color-balance)" stopOpacity={0.35} />
                      <stop offset="95%" stopColor="var(--color-balance)" stopOpacity={0.03} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid vertical={false} />
                  <XAxis
                    dataKey="month"
                    tickLine={false}
                    axisLine={false}
                    tickMargin={8}
                    tickFormatter={tickLabel}
                  />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    width={48}
                    domain={["auto", "auto"]}
                    tickFormatter={(v: number) => compact.format(v)}
                  />
                  <ChartTooltip
                    content={
                      <ChartTooltipContent labelFormatter={fullLabel} formatter={money} />
                    }
                  />
                  <Area
                    dataKey="balance"
                    type="monotone"
                    stroke="var(--color-balance)"
                    strokeWidth={2}
                    fill="url(#fillBalance)"
                  />
                </AreaChart>
              </ChartContainer>
            ) : (
              <EmptyState icon={ChartLine} message={t("trend.balanceEmpty")} />
            )}
          </CardContent>
        </Card>
      </div>
    </section>
  );
}

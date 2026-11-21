"use client";

/**
 * 支出分析頁共用的小零件：顏色、項目名稱、項目標記（廠商頭像 / 類別色點）與數字格式。
 */

import { useMemo } from "react";
import { useLocale, useTranslations } from "next-intl";
import { PartyAvatar } from "@/components/party-avatar";
import { formatCurrency } from "@/lib/currency";
import type { CompositionItem, TrendItem } from "@/lib/spend-trend";
import { cn } from "@/lib/utils";

/**
 * 堆疊序列的顏色：八個都是主題的 chart token（globals.css），淺色 / 深色各有一份。
 * 順序刻意讓相鄰兩個序列的色相差得遠一點。
 */
export const SERIES_COLORS = [
  "var(--chart-1)",
  "var(--chart-3)",
  "var(--chart-5)",
  "var(--chart-2)",
  "var(--chart-6)",
  "var(--chart-4)",
  "var(--chart-7)",
  "var(--chart-8)",
] as const;
export const OTHER_COLOR = "var(--muted-foreground)";

export const seriesColor = (index: number) => SERIES_COLORS[index % SERIES_COLORS.length];

/** "2025-08" → "25/08"（X 軸）；完整版 "2025/08"（tooltip、表頭）。 */
export const tickLabel = (ym: string) => ym.slice(2).replace("-", "/");
export const fullLabel = (ym: string) => ym.replace("-", "/");

/** 總覽看量級，不看角：金額取整數。 */
export const money = (v: number) => formatCurrency(Math.round(v), "TWD");

export function useFormatters() {
  const locale = useLocale();
  return useMemo(
    () => ({
      compact: new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }),
      percent: new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1 }),
      signedPercent: new Intl.NumberFormat(locale, {
        style: "percent",
        maximumFractionDigits: 1,
        signDisplay: "exceptZero",
      }),
    }),
    [locale],
  );
}

type Labeled = Pick<TrendItem, "kind" | "name" | "key"> | Pick<CompositionItem, "kind" | "name" | "key">;

/** 項目的顯示名稱：未分類 / 未指定對象 / 其他套翻譯。 */
export function useItemLabel() {
  const t = useTranslations("reports.spendTrend");
  return (item: Labeled) => {
    if (item.kind === "other") return t("other");
    if (item.kind === "none") return item.key.startsWith("category:") ? t("uncategorized") : t("unassignedParty");
    return item.name ?? "—";
  };
}

/** 項目前面的標記：廠商用頭像（logo），其餘用顏色方塊（跟圖上的顏色對得起來）。 */
export function ItemMark({
  item,
  label,
  color,
  size = "md",
}: Readonly<{
  item: Pick<CompositionItem, "kind" | "id" | "avatarVersion" | "key">;
  label: string;
  color?: string;
  size?: "sm" | "md";
}>) {
  if (item.kind === "party") {
    return <PartyAvatar name={label} partyId={item.id} avatarVersion={item.avatarVersion} size={size} />;
  }
  return (
    <span
      aria-hidden
      className={cn("shrink-0 rounded-[3px]", size === "sm" ? "size-2.5" : "size-3")}
      style={{ background: color ?? OTHER_COLOR, opacity: item.kind === "category" ? 1 : 0.5 }}
    />
  );
}

/** 期間走勢的迷你折線（表格每列一條）。自己畫 SVG，一列一個 recharts 太重。 */
export function Sparkline({
  values,
  color,
  width = 80,
  height = 24,
}: Readonly<{ values: number[]; color: string; width?: number; height?: number }>) {
  const max = Math.max(...values, 0);
  const min = Math.min(...values, 0);
  const span = max - min || 1;
  const step = values.length > 1 ? width / (values.length - 1) : 0;
  const points = values
    .map((v, i) => `${(i * step).toFixed(1)},${(height - 2 - ((v - min) / span) * (height - 4)).toFixed(1)}`)
    .join(" ");
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden className="overflow-visible">
      <polyline points={points} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

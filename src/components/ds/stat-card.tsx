"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { CountUp } from "@/components/ds/count-up";
import { Sparkline } from "@/components/ds/sparkline";
import { StatusDot } from "@/components/ds/status-dot";

type Tone = "default" | "primary" | "income" | "risk" | "warning";

const toneText: Record<Tone, string> = {
  default: "text-foreground",
  primary: "text-primary",
  income: "text-income",
  risk: "text-destructive",
  warning: "text-warning",
};

/**
 * 總覽與看板的統計卡：光點跟著滑鼠（.spot-card）、數字滾動、可選的走勢線。
 * 只用在「一眼要看到的數字」，不要拿來包表格列或表單。
 *   - value 給數字；currency 有給就當金額格式化，否則是筆數（可加 suffix）
 *   - spark 給有時間序列的數字（至少兩點），沒有歷史就不要硬塞
 *   - pulse 只給「逾期」「同步失敗」這種要人處理的狀態
 */
export function StatCard({
  label,
  value,
  currency,
  suffix,
  hint,
  icon,
  spark,
  tone = "default",
  pulse = false,
  active = false,
  className,
  children,
}: Readonly<{
  label: React.ReactNode;
  value: number;
  currency?: string;
  suffix?: string;
  /** 數字下方的一行補充（次要金額、說明） */
  hint?: React.ReactNode;
  icon?: React.ReactNode;
  spark?: readonly number[];
  tone?: Tone;
  pulse?: boolean;
  /** 目前被選中的卡（例如看板的篩選） */
  active?: boolean;
  className?: string;
  children?: React.ReactNode;
}>) {
  const ref = React.useRef<HTMLDivElement>(null);
  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${e.clientX - r.left}px`);
    el.style.setProperty("--my", `${e.clientY - r.top}px`);
  };
  const onLeave = () => {
    ref.current?.style.removeProperty("--mx");
    ref.current?.style.removeProperty("--my");
  };

  return (
    <div
      ref={ref}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      data-active={active || undefined}
      className={cn(
        "spot-card flex min-w-0 flex-col rounded-xl border px-4 pt-3.5 pb-3 shadow-xs",
        "data-[active]:border-primary/50 data-[active]:shadow-md",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className="flex min-w-0 items-center gap-1.5">
          {pulse ? <StatusDot tone="risk" pulse /> : null}
          <span className="truncate">{label}</span>
        </span>
        {icon ? <span className="shrink-0 text-subtle-foreground [&_svg]:size-4">{icon}</span> : null}
      </div>
      <CountUp
        value={value}
        currency={currency}
        suffix={suffix}
        className={cn(
          "mt-1 block truncate text-2xl leading-8 font-semibold tracking-tight tabular-nums",
          toneText[tone],
        )}
      />
      {hint ? <div className="mt-0.5 truncate text-xs text-muted-foreground">{hint}</div> : null}
      {children}
      {spark && spark.length > 1 ? (
        <Sparkline
          data={spark}
          tone={tone === "income" ? "income" : tone === "risk" ? "risk" : "primary"}
          className="mt-2"
        />
      ) : null}
    </div>
  );
}

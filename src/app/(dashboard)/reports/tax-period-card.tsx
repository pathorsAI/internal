import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { TaxPeriodSummary } from "@/db/queries";
import type { TaxPeriod } from "@/lib/vat";

function Line({
  label,
  count,
  amount,
  tone,
}: Readonly<{ label: string; count: number; amount: number; tone?: string }>) {
  return (
    <div className="flex items-baseline justify-between gap-2 py-1.5">
      <span className="text-sm text-muted-foreground">
        {label}
        <span className="ml-1.5 text-xs tabular-nums">{count} 筆</span>
      </span>
      <span className={cn("text-sm font-medium tabular-nums", tone)}>
        {formatCurrency(amount, "TWD")}
      </span>
    </div>
  );
}

/**
 * 單一營業稅期（雙月）的發票概況：該開多少、開了多少、還差多少。
 *
 * 只算台幣 —— 營業稅本來就只管台幣，把外幣混進來只會讓申報時對不上。
 */
export function TaxPeriodCard({
  period,
  summary,
  highlight = false,
}: Readonly<{ period: TaxPeriod; summary: TaxPeriodSummary; highlight?: boolean }>) {
  const hasGap = summary.missing.count > 0 || summary.pending.count > 0;

  return (
    <Card className={cn("gap-0 p-4", highlight && "border-primary/40")}>
      <div className="flex items-baseline justify-between gap-2">
        <div className="text-sm font-medium">{period.label}</div>
        <div className="text-xs text-muted-foreground">{highlight ? "本期" : "上一期"}</div>
      </div>
      <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
        {period.start} ~ {period.end}
      </p>

      <div className="mt-3 divide-y">
        <Line label="本期該開" count={summary.shouldIssue.count} amount={summary.shouldIssue.amount} />
        <Line label="已開（銷項有效）" count={summary.issued.count} amount={summary.issued.amount} />
        <Line
          label="已建、Simpany 待開"
          count={summary.pending.count}
          amount={summary.pending.amount}
          tone={summary.pending.count > 0 ? "text-expense" : undefined}
        />
        <Line
          label="該開連紀錄都沒有"
          count={summary.missing.count}
          amount={summary.missing.amount}
          tone={summary.missing.count > 0 ? "text-expense" : undefined}
        />
      </div>

      {hasGap && (
        <Button asChild size="sm" variant="outline" className="mt-3 w-full">
          <Link href="/invoices/reconcile">去對帳</Link>
        </Button>
      )}
    </Card>
  );
}

import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { AlertTriangle, Clock, HandCoins, Receipt } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { BillingBucket, BillingSummary } from "@/db/queries";

export type BoardFilter = "due" | "awaiting" | "overdue" | "invoice";

/** 金額依幣別分開顯示 —— 本系統一律不做匯率換算。 */
function bucketAmount(bucket: BillingBucket) {
  const entries = Object.entries(bucket.amounts);
  if (entries.length === 0) return "—";
  return entries.map(([currency, amount]) => formatCurrency(amount, currency)).join(" · ");
}

export async function SummaryCards({
  summary,
  active,
}: Readonly<{ summary: BillingSummary; active: BoardFilter | null }>) {
  const t = await getTranslations("billing");

  const cards: {
    key: BoardFilter;
    label: string;
    hint: string;
    icon: React.ComponentType<{ className?: string }>;
    accent: string;
  }[] = [
    {
      key: "due",
      label: t("status.due"),
      hint: t("summary.due.hint"),
      icon: HandCoins,
      accent: "text-primary",
    },
    {
      key: "awaiting",
      label: t("summary.awaiting.label"),
      hint: t("summary.awaiting.hint"),
      icon: Clock,
      accent: "text-muted-foreground",
    },
    {
      key: "overdue",
      label: t("status.overdue"),
      hint: t("summary.overdue.hint"),
      icon: AlertTriangle,
      accent: "text-expense",
    },
    {
      key: "invoice",
      label: t("summary.invoice.label"),
      hint: t("summary.invoice.hint"),
      icon: Receipt,
      accent: "text-muted-foreground",
    },
  ];

  const buckets: Record<BoardFilter, BillingBucket> = {
    due: summary.due,
    awaiting: summary.awaiting,
    overdue: summary.overdue,
    invoice: summary.needsInvoice,
  };

  return (
    <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map((c) => {
        const bucket = buckets[c.key];
        const isActive = active === c.key;
        const Icon = c.icon;
        return (
          <Link
            key={c.key}
            href={isActive ? "/billing" : `/billing?filter=${c.key}`}
            aria-pressed={isActive}
            className="rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Card
              className={cn(
                "h-full transition-colors hover:border-primary/40",
                isActive && "border-primary ring-1 ring-primary",
              )}
            >
              <CardContent className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm text-muted-foreground">{c.label}</span>
                  <Icon className={cn("size-4", c.accent)} />
                </div>
                <div className="text-2xl font-semibold tabular-nums">{bucket.count}</div>
                <div className="text-xs tabular-nums text-muted-foreground">
                  {bucketAmount(bucket)}
                </div>
                <p className="text-xs text-muted-foreground/80">{c.hint}</p>
              </CardContent>
            </Card>
          </Link>
        );
      })}
    </section>
  );
}

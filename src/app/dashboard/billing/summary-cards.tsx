import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { AlertTriangle, Clock, HandCoins, Receipt } from "lucide-react";
import { StatCard } from "@/components/ds/stat-card";
import { formatCurrency } from "@/lib/format";
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
  }[] = [
    { key: "due", label: t("status.due"), hint: t("summary.due.hint"), icon: HandCoins },
    {
      key: "awaiting",
      label: t("summary.awaiting.label"),
      hint: t("summary.awaiting.hint"),
      icon: Clock,
    },
    {
      key: "overdue",
      label: t("status.overdue"),
      hint: t("summary.overdue.hint"),
      icon: AlertTriangle,
    },
    {
      key: "invoice",
      label: t("summary.invoice.label"),
      hint: t("summary.invoice.hint"),
      icon: Receipt,
    },
  ];

  const buckets: Record<BoardFilter, BillingBucket> = {
    due: summary.due,
    awaiting: summary.awaiting,
    overdue: summary.overdue,
    invoice: summary.needsInvoice,
  };

  return (
    <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map((c) => {
        const bucket = buckets[c.key];
        const isActive = active === c.key;
        // 逾期有件數才變紅、才呼吸；零件時跟其他卡一樣安靜
        const risk = c.key === "overdue" && bucket.count > 0;
        const Icon = c.icon;
        return (
          <Link
            key={c.key}
            href={isActive ? "/billing" : `/billing?filter=${c.key}`}
            aria-pressed={isActive}
            className="rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <StatCard
              label={c.label}
              value={bucket.count}
              hint={<span className="tabular-nums">{bucketAmount(bucket)}</span>}
              icon={<Icon />}
              tone={risk ? "risk" : "default"}
              pulse={risk}
              active={isActive}
              className="h-full transition-colors hover:border-primary/40"
            >
              <p className="mt-1 text-xs text-subtle-foreground">{c.hint}</p>
            </StatCard>
          </Link>
        );
      })}
    </section>
  );
}

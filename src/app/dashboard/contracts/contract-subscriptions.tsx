import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { formatCurrency } from "@/lib/format";
import type { ContractSubscription } from "@/db/queries";

const statusVariant: Record<string, "default" | "secondary" | "outline"> = {
  active: "default",
  paused: "secondary",
  ended: "outline",
};

function intervalLabel(
  t: Awaited<ReturnType<typeof getTranslations<"contracts">>>,
  months: number,
) {
  if (months === 1) return t("linkedSubscriptions.interval.monthly");
  if (months === 3) return t("linkedSubscriptions.interval.quarterly");
  if (months === 12) return t("linkedSubscriptions.interval.yearly");
  return t("linkedSubscriptions.interval.everyNMonths", { months });
}

/**
 * 合約編輯視窗裡的「綁定的訂閱」區塊：這張合約談好的週期性費用。
 * 沒有綁任何訂閱就整塊不出現 —— 大多數合約都沒有，留一行空狀態只是噪音。
 */
export async function ContractSubscriptions({
  rows,
}: Readonly<{ rows: ContractSubscription[] }>) {
  if (rows.length === 0) return null;
  const t = await getTranslations("contracts");
  const statusLabels: Record<string, string> = {
    active: t("linkedSubscriptions.status.active"),
    paused: t("linkedSubscriptions.status.paused"),
    ended: t("linkedSubscriptions.status.ended"),
  };
  return (
    <section className="space-y-2 rounded-lg border p-3 sm:col-span-2">
      <div className="text-sm font-medium">{t("linkedSubscriptions.heading")}</div>
      <ul className="divide-y">
        {rows.map((s) => (
          <li key={s.id} className="flex items-center justify-between gap-2 py-2 text-sm">
            <div className="min-w-0">
              <div className="truncate font-medium">{s.name}</div>
              <div className="text-xs text-muted-foreground tabular-nums">
                {formatCurrency(s.amount, s.currency)} · {intervalLabel(t, s.intervalMonths)}
              </div>
            </div>
            <Badge variant={statusVariant[s.status] ?? "outline"}>
              {statusLabels[s.status] ?? s.status}
            </Badge>
          </li>
        ))}
      </ul>
      <Link
        href="/dashboard/subscriptions"
        className="block w-full py-1 text-center text-xs text-muted-foreground hover:text-foreground"
      >
        {t("linkedSubscriptions.manageLink")}
      </Link>
    </section>
  );
}

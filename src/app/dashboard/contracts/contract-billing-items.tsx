import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Button } from "@/components/ui/button";
import { formatCurrency, formatDate } from "@/lib/format";
import type { BillingRow } from "@/db/queries";
import { BillingStatusBadge } from "../billing/billing-status";
import { NewBillingItemDialog } from "../billing/new-billing-item-dialog";
import { TaxBreakdown } from "@/components/tax-breakdown";
import type { TaxSetting } from "@/lib/tax-treatment";

/**
 * 合約編輯視窗裡的「分期請款」區塊：列出掛在這張合約下的請款項目，
 * 並可直接新增一期。詳細操作（標記已請款 / 開發票）在請款看板上做。
 */
export async function ContractBillingItems({
  contractId,
  rows,
  parties,
  projects,
  orgTax,
}: Readonly<{
  orgTax: TaxSetting;
  contractId: number;
  rows: BillingRow[];
  parties: { id: number; name: string }[];
  projects: { id: number; name: string }[];
}>) {
  const t = await getTranslations("contracts");
  return (
    <section className="space-y-2 rounded-lg border p-3 sm:col-span-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-medium">{t("billingItems.heading")}</div>
        <NewBillingItemDialog
          parties={parties}
          contracts={[]}
          projects={projects}
          contractId={contractId}
          triggerLabel={t("billingItems.addButton")}
          triggerVariant="outline"
          orgTax={orgTax}
        />
      </div>

      {rows.length === 0 ? (
        <p className="py-2 text-xs text-muted-foreground">
          {t("billingItems.empty")}
        </p>
      ) : (
        <ul className="divide-y">
          {rows.map((r) => (
            <li key={r.key} className="flex items-center justify-between gap-2 py-2 text-sm">
              <div className="min-w-0">
                <div className="truncate font-medium">{r.title}</div>
                <div className="text-xs text-muted-foreground tabular-nums">
                  {r.dueDate
                    ? t("billingItems.dueDate", { date: formatDate(r.dueDate) })
                    : t("billingItems.noDueDate")}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {/* 應收是含稅 gross，有稅額才多一行未稅＋稅 */}
                <div className="text-right">
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {formatCurrency(r.paid, r.currency)} / {formatCurrency(r.expected, r.currency)}
                  </span>
                  <TaxBreakdown net={r.net} tax={r.tax} />
                </div>
                <BillingStatusBadge status={r.status} />
              </div>
            </li>
          ))}
        </ul>
      )}

      <Button asChild variant="ghost" size="sm" className="w-full">
        <Link href="/dashboard/billing">{t("billingItems.manageLink")}</Link>
      </Button>
    </section>
  );
}

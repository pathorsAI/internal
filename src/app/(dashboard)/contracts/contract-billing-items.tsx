import Link from "next/link";
import { Button } from "@/components/ui/button";
import { formatCurrency, formatDate } from "@/lib/format";
import type { BillingRow } from "@/db/queries";
import { BillingStatusBadge } from "../billing/billing-status";
import { NewBillingItemDialog } from "../billing/new-billing-item-dialog";

/**
 * 合約編輯視窗裡的「分期請款」區塊：列出掛在這張合約下的請款項目，
 * 並可直接新增一期。詳細操作（標記已請款 / 開發票）在請款看板上做。
 */
export function ContractBillingItems({
  contractId,
  rows,
  parties,
  projects,
}: Readonly<{
  contractId: number;
  rows: BillingRow[];
  parties: { id: number; name: string }[];
  projects: { id: number; name: string }[];
}>) {
  return (
    <section className="space-y-2 rounded-lg border p-3 sm:col-span-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-medium">分期請款</div>
        <NewBillingItemDialog
          parties={parties}
          contracts={[]}
          projects={projects}
          contractId={contractId}
          triggerLabel="新增一期"
          triggerVariant="outline"
        />
      </div>

      {rows.length === 0 ? (
        <p className="py-2 text-xs text-muted-foreground">
          尚未排定分期。例如簽約金 / 期中款 / 尾款，設好應請款日後就會出現在請款看板。
        </p>
      ) : (
        <ul className="divide-y">
          {rows.map((r) => (
            <li key={r.key} className="flex items-center justify-between gap-2 py-2 text-sm">
              <div className="min-w-0">
                <div className="truncate font-medium">{r.title}</div>
                <div className="text-xs text-muted-foreground tabular-nums">
                  {r.dueDate ? `應請款 ${formatDate(r.dueDate)}` : "未設應請款日"}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="text-xs tabular-nums text-muted-foreground">
                  {formatCurrency(r.paid, r.currency)} / {formatCurrency(r.expected, r.currency)}
                </span>
                <BillingStatusBadge status={r.status} />
              </div>
            </li>
          ))}
        </ul>
      )}

      <Button asChild variant="ghost" size="sm" className="w-full">
        <Link href="/billing">到請款看板管理</Link>
      </Button>
    </section>
  );
}

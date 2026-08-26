import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { TableCard } from "@/components/table-card";
import { EmptyRow } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ContractCoverageRow } from "@/db/queries";
import { formatCurrency } from "@/lib/format";

/** 差額在 1 元以內視為已排完（分期尾差不該被當成漏排）。 */
const TOLERANCE = 1;

/** 未排欄：缺口 / 超排 / 已排完 / 無從比較（合約沒設金額）。 */
async function GapCell({ gap, currency }: Readonly<{ gap: number | null; currency: string }>) {
  if (gap == null) return <span className="text-xs text-muted-foreground">—</span>;
  const t = await getTranslations("reports.contractCoverage.gap");
  if (gap > TOLERANCE) {
    return (
      <Badge variant="outline" className="border-expense/40 text-expense">
        {t("short", { amount: formatCurrency(gap, currency) })}
      </Badge>
    );
  }
  if (gap < -TOLERANCE) {
    return <Badge variant="outline">{t("over", { amount: formatCurrency(-gap, currency) })}</Badge>;
  }
  return <span className="text-xs text-muted-foreground">{t("done")}</span>;
}

/**
 * 合約完整性：談了多少 → 排了多少 → 請了多少 → 收了多少。
 *
 * 這是最容易漏錢的一道對帳：合約談 100 萬只排了 80 萬的請款，剩下 20 萬不會有
 * 任何人提醒你。有缺口的排最前面。
 */
export async function ContractCoverage({ rows }: Readonly<{ rows: ContractCoverageRow[] }>) {
  const t = await getTranslations("reports.contractCoverage");
  const gaps = rows.filter((r) => r.unscheduled != null && r.unscheduled > TOLERANCE);

  return (
    <TableCard
      title={t("title")}
      action={gaps.length === 0 ? t("allScheduled") : t("gapsSummary", { count: gaps.length })}
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("columns.contract")}</TableHead>
            <TableHead>{t("columns.client")}</TableHead>
            <TableHead className="text-right">{t("columns.amount")}</TableHead>
            <TableHead className="text-right">{t("columns.scheduled")}</TableHead>
            <TableHead className="text-right">{t("columns.billed")}</TableHead>
            <TableHead className="text-right">{t("columns.paid")}</TableHead>
            <TableHead className="text-right">{t("columns.unscheduled")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <EmptyRow colSpan={7} message={t("empty.message")}>
              {t("empty.hint")}
            </EmptyRow>
          ) : (
            rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="max-w-[24ch] truncate font-medium" title={r.title}>
                    {r.title}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{r.customerName ?? "—"}</TableCell>
                  <TableCell className="text-right text-sm tabular-nums">
                    {r.amount == null ? t("unsetAmount") : formatCurrency(r.amount, r.currency)}
                  </TableCell>
                  <TableCell className="text-right text-sm tabular-nums">
                    {formatCurrency(r.scheduled, r.currency)}
                  </TableCell>
                  <TableCell className="text-right text-sm tabular-nums text-muted-foreground">
                    {formatCurrency(r.billed, r.currency)}
                  </TableCell>
                  <TableCell className="text-right text-sm tabular-nums text-muted-foreground">
                    {formatCurrency(r.paid, r.currency)}
                  </TableCell>
                  <TableCell className="text-right">
                    <GapCell gap={r.unscheduled} currency={r.currency} />
                  </TableCell>
                </TableRow>
              ))
          )}
        </TableBody>
      </Table>

      {gaps.length > 0 && (
        <div className="border-t p-3">
          <Button asChild size="sm" variant="ghost" className="w-full">
            <Link href="/dashboard/contracts">{t("goToContracts")}</Link>
          </Button>
        </div>
      )}
    </TableCard>
  );
}

import Link from "next/link";
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
function GapCell({ gap, currency }: Readonly<{ gap: number | null; currency: string }>) {
  if (gap == null) return <span className="text-xs text-muted-foreground">—</span>;
  if (gap > TOLERANCE) {
    return (
      <Badge variant="outline" className="border-expense/40 text-expense">
        缺 {formatCurrency(gap, currency)}
      </Badge>
    );
  }
  if (gap < -TOLERANCE) {
    return <Badge variant="outline">超排 {formatCurrency(-gap, currency)}</Badge>;
  }
  return <span className="text-xs text-muted-foreground">已排完</span>;
}

/**
 * 合約完整性：談了多少 → 排了多少 → 請了多少 → 收了多少。
 *
 * 這是最容易漏錢的一道對帳：合約談 100 萬只排了 80 萬的請款，剩下 20 萬不會有
 * 任何人提醒你。有缺口的排最前面。
 */
export function ContractCoverage({ rows }: Readonly<{ rows: ContractCoverageRow[] }>) {
  const gaps = rows.filter((r) => r.unscheduled != null && r.unscheduled > TOLERANCE);

  return (
    <TableCard
      title="合約完整性"
      action={
        gaps.length === 0
          ? "每張合約的金額都排進請款了"
          : `${gaps.length} 張合約有錢還沒排進請款`
      }
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>合約</TableHead>
            <TableHead>客戶</TableHead>
            <TableHead className="text-right">合約金額</TableHead>
            <TableHead className="text-right">已排程</TableHead>
            <TableHead className="text-right">已請款</TableHead>
            <TableHead className="text-right">已收款</TableHead>
            <TableHead className="text-right">未排</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <EmptyRow colSpan={7} message="尚無合約">
              到合約頁新增，設好請款方式就會自動展開排程
            </EmptyRow>
          ) : (
            rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="max-w-[24ch] truncate font-medium" title={r.title}>
                    {r.title}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{r.customerName ?? "—"}</TableCell>
                  <TableCell className="text-right text-sm tabular-nums">
                    {r.amount == null ? "未設金額" : formatCurrency(r.amount, r.currency)}
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
            <Link href="/contracts">到合約頁補排請款</Link>
          </Button>
        </div>
      )}
    </TableCard>
  );
}

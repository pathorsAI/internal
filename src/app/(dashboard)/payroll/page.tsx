import Link from "next/link";
import { Users } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { TableCard } from "@/components/table-card";
import { EmptyRow } from "@/components/empty-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { listPayslipRecords } from "@/db/queries";
import { formatCurrency, formatYearMonth } from "@/lib/format";
import { DeleteButton } from "@/components/delete-button";
import { deletePayslip } from "@/db/mutations";
import { requireOrg } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function PayrollPage() {
  const { orgId } = await requireOrg();
  const rows = await listPayslipRecords(orgId);

  return (
    <>
      <PageHeader
        title="薪資"
        description="到「員工」頁對每位員工發放薪資；這裡是發放紀錄"
      >
        <Button size="sm" asChild>
          <Link href="/employees">
            <Users className="size-4" /> 去員工頁發薪
          </Link>
        </Button>
      </PageHeader>

      <TableCard title="發放紀錄">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>月份</TableHead>
              <TableHead>員工</TableHead>
              <TableHead className="text-right">應稅</TableHead>
              <TableHead className="text-right">免稅</TableHead>
              <TableHead className="text-right">實發</TableHead>
              <TableHead>交易</TableHead>
              <TableHead className="text-right">動作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <EmptyRow colSpan={7} message="尚無發放紀錄" />
            ) : (
              rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {formatYearMonth(r.periodYear, r.periodMonth)}
                  </TableCell>
                  <TableCell className="font-medium">{r.employeeName ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {formatCurrency(r.taxableTotal)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {formatCurrency(r.nontaxableTotal)}
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {formatCurrency(r.netPay)}
                  </TableCell>
                  <TableCell>
                    {r.paidTransactionId ? (
                      <Link href="/transactions" className="text-xs text-primary hover:underline">
                        已入帳
                      </Link>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <DeleteButton
                      action={deletePayslip}
                      id={r.id}
                      title="撤銷這筆發放？"
                      description="會一併刪除它產生的薪資支出交易。"
                    />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableCard>
    </>
  );
}

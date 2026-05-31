import Link from "next/link";
import { Users } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { listPayslipRecords } from "@/db/queries";
import { formatCurrency } from "@/lib/format";
import { DeleteButton } from "@/components/delete-button";
import { deletePayslip } from "@/db/mutations";

export const dynamic = "force-dynamic";

export default async function PayrollPage() {
  const rows = await listPayslipRecords();

  return (
    <>
      <PageHeader
        title="薪資"
        description="到「員工」頁對每位員工發放薪資；這裡是發放紀錄"
      >
        <Link
          href="/employees"
          className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          <Users className="size-4" /> 去員工頁發薪
        </Link>
      </PageHeader>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">發放紀錄</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
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
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground">
                    尚無發放紀錄
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {r.periodYear}-{String(r.periodMonth).padStart(2, "0")}
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
        </CardContent>
      </Card>
    </>
  );
}

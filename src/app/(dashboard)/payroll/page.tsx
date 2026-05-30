import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { listPayrollRuns } from "@/db/queries";
import { formatCurrency, formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

const statusCfg: Record<string, { label: string; variant: "default" | "secondary" | "outline" }> = {
  draft: { label: "草稿", variant: "secondary" },
  finalized: { label: "已結算", variant: "outline" },
  paid: { label: "已發放", variant: "default" },
};

export default async function PayrollPage() {
  const rows = await listPayrollRuns();

  return (
    <>
      <PageHeader title="薪資" description="每月薪資結算批次" />
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>期間</TableHead>
              <TableHead>發薪日</TableHead>
              <TableHead>狀態</TableHead>
              <TableHead className="text-right">薪資單</TableHead>
              <TableHead className="text-right">實發合計</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground">
                  尚無薪資批次
                </TableCell>
              </TableRow>
            ) : (
              rows.map((r) => {
                const cfg = statusCfg[r.status] ?? { label: r.status, variant: "outline" as const };
                return (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">
                      {r.periodYear} 年 {String(r.periodMonth).padStart(2, "0")} 月
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {r.payDate ? formatDate(r.payDate) : "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant={cfg.variant}>{cfg.label}</Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {r.payslipCount}
                    </TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {formatCurrency(r.netTotal)}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}

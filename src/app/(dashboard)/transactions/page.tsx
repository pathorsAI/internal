import { Plus } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { WireframeNotice } from "@/components/wireframe-notice";
import { Button } from "@/components/ui/button";
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
import { formatCurrency, formatDate } from "@/lib/format";
import { sampleTransactions } from "@/lib/wireframe-data";

export default function TransactionsPage() {
  return (
    <>
      <PageHeader
        title="記帳"
        description="團隊收支紀錄，之後可與其他系統同步"
      >
        <Button size="sm">
          <Plus className="size-4" /> 新增交易
        </Button>
      </PageHeader>
      <WireframeNotice />

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>日期</TableHead>
              <TableHead>類別</TableHead>
              <TableHead>說明</TableHead>
              <TableHead>類型</TableHead>
              <TableHead className="text-right">金額</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sampleTransactions.map((t) => (
              <TableRow key={t.id}>
                <TableCell className="text-muted-foreground">
                  {formatDate(t.occurredAt)}
                </TableCell>
                <TableCell>{t.category}</TableCell>
                <TableCell className="text-muted-foreground">
                  {t.description}
                </TableCell>
                <TableCell>
                  <Badge variant={t.type === "income" ? "default" : "secondary"}>
                    {t.type === "income" ? "收入" : "支出"}
                  </Badge>
                </TableCell>
                <TableCell
                  className={
                    "text-right font-medium tabular-nums " +
                    (t.type === "income" ? "text-emerald-600" : "")
                  }
                >
                  {t.type === "expense" ? "-" : ""}
                  {formatCurrency(t.amount, t.currency)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}

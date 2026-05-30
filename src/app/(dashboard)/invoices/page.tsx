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
import { listInvoices } from "@/db/queries";
import { formatCurrency, formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function InvoicesPage() {
  const rows = await listInvoices();

  return (
    <>
      <PageHeader title="發票" description="進項與銷項發票" />
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>日期</TableHead>
              <TableHead>方向</TableHead>
              <TableHead>發票號碼</TableHead>
              <TableHead>對象</TableHead>
              <TableHead>統編</TableHead>
              <TableHead>狀態</TableHead>
              <TableHead className="text-right">未稅</TableHead>
              <TableHead className="text-right">稅額</TableHead>
              <TableHead className="text-right">含稅</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={9} className="text-center text-muted-foreground">
                  尚無發票
                </TableCell>
              </TableRow>
            ) : (
              rows.map((v) => (
                <TableRow key={v.id}>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {v.invoiceDate ? formatDate(v.invoiceDate) : "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant={v.direction === "issued" ? "default" : "secondary"}>
                      {v.direction === "issued" ? "銷項" : "進項"}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{v.invoiceNumber ?? "—"}</TableCell>
                  <TableCell>{v.counterpartyName ?? "—"}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {v.counterpartyTaxId ?? "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant={v.status === "valid" ? "outline" : "destructive"}>
                      {v.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {v.amountNet ? formatCurrency(v.amountNet, v.currency) : "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {v.tax ? formatCurrency(v.tax, v.currency) : "—"}
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {v.amountGross ? formatCurrency(v.amountGross, v.currency) : "—"}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}

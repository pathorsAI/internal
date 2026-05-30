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
import { listSuppliers, listBankAccounts } from "@/db/queries";
import { formatCurrency } from "@/lib/format";
import { NewSupplierDialog } from "./new-supplier-dialog";

export const dynamic = "force-dynamic";

export default async function SuppliersPage() {
  const [rows, accounts] = await Promise.all([listSuppliers(), listBankAccounts()]);

  return (
    <>
      <PageHeader title="供應商" description="每月固定收款的廠商，含預設帳戶與幣別">
        <NewSupplierDialog
          accounts={accounts.map((a) => ({ id: a.id, name: a.name, currency: a.currency }))}
        />
      </PageHeader>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>名稱</TableHead>
              <TableHead>統編</TableHead>
              <TableHead>幣別</TableHead>
              <TableHead>預設帳戶</TableHead>
              <TableHead>狀態</TableHead>
              <TableHead className="text-right">慣常金額</TableHead>
              <TableHead className="text-right">交易數</TableHead>
              <TableHead className="text-right">累計 (TWD)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-muted-foreground">
                  尚無供應商，點右上角新增
                </TableCell>
              </TableRow>
            ) : (
              rows.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">{s.name}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {s.taxId ?? "—"}
                  </TableCell>
                  <TableCell>{s.defaultCurrency ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {s.accountName ?? "—"}
                  </TableCell>
                  <TableCell>
                    <Badge variant={s.isActive ? "outline" : "secondary"}>
                      {s.isActive ? "啟用" : "停用"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {s.typicalAmount
                      ? formatCurrency(s.typicalAmount, s.defaultCurrency ?? "TWD")
                      : "—"}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{s.txnCount}</TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {formatCurrency(s.txnTotal)}
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

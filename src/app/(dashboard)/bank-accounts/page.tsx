import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { BookBadge } from "@/components/book-badge";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { listBankAccounts } from "@/db/queries";
import { formatCurrency } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function BankAccountsPage() {
  const rows = await listBankAccounts();

  return (
    <>
      <PageHeader title="銀行帳戶" description="現金與銀行帳戶" />
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>名稱</TableHead>
              <TableHead>類型</TableHead>
              <TableHead>幣別</TableHead>
              <TableHead>預設帳別</TableHead>
              <TableHead>狀態</TableHead>
              <TableHead className="text-right">期初餘額</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground">
                  尚無帳戶
                </TableCell>
              </TableRow>
            ) : (
              rows.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="font-medium">{a.name}</TableCell>
                  <TableCell className="text-muted-foreground">{a.kind}</TableCell>
                  <TableCell>{a.currency}</TableCell>
                  <TableCell>
                    <BookBadge book={a.defaultBook} />
                  </TableCell>
                  <TableCell>
                    <Badge variant={a.isActive ? "outline" : "secondary"}>
                      {a.isActive ? "啟用" : "停用"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {formatCurrency(a.openingBalance, a.currency)}
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

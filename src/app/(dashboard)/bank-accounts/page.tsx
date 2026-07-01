import { RowDialog } from "@/components/row-dialog";
import { DeleteButton } from "@/components/delete-button";
import { deleteBankAccount } from "@/db/mutations";
import { EditBankAccountForm } from "./edit-bank-account-form";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
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
import { listAccountBalances } from "@/db/queries";
import { formatCurrency } from "@/lib/format";
import { CurrencyFlag } from "@/components/currency-flag";
import { NewBankAccountDialog } from "./new-bank-account-dialog";
import { requireOrg } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function BankAccountsPage() {
  const { orgId } = await requireOrg();
  const rows = await listAccountBalances(orgId, { includeInactive: true });

  return (
    <>
      <PageHeader title="銀行帳戶" description="現金與銀行帳戶">
        <NewBankAccountDialog />
      </PageHeader>
      <TableCard>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>名稱</TableHead>
              <TableHead>類型</TableHead>
              <TableHead>幣別</TableHead>
              <TableHead>狀態</TableHead>
              <TableHead className="text-right">期初餘額</TableHead>
              <TableHead className="text-right">目前餘額</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <EmptyRow colSpan={6} message="尚無帳戶" />
            ) : (
              rows.map((a) => (
                <RowDialog
                  key={a.id}
                  title={a.name}
                  description="銀行帳戶"
                  cells={
                    <>
                      <TableCell className="font-medium">{a.name}</TableCell>
                      <TableCell>
                        <Badge variant={a.kind === "bank" ? "outline" : "secondary"}>
                          {a.kind === "bank" ? "實體" : "虛擬"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <span className="flex items-center gap-2">
                          <CurrencyFlag currency={a.currency} />
                          {a.currency}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge variant={a.isActive ? "outline" : "secondary"}>
                          {a.isActive ? "啟用" : "停用"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {formatCurrency(a.openingBalance, a.currency)}
                      </TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">
                        {formatCurrency(a.bookBalance, a.currency)}
                      </TableCell>
                    </>
                  }
                >
                  <EditBankAccountForm
                    account={{
                      id: a.id,
                      name: a.name,
                      kind: a.kind,
                      currency: a.currency,
                      openingBalance: a.openingBalance,
                      isActive: a.isActive,
                    }}
                    footer={<DeleteButton action={deleteBankAccount} id={a.id} />}
                  />
                </RowDialog>
              ))
            )}
          </TableBody>
        </Table>
      </TableCard>
    </>
  );
}

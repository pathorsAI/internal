import { CheckCircle2, AlertTriangle } from "lucide-react";
import { RowDialog } from "@/components/row-dialog";
import { DeleteButton } from "@/components/delete-button";
import { deleteReconciliation } from "@/db/mutations";
import { EditReconciliationForm } from "./edit-reconciliation-form";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  listAccountBalances,
  listReconciliations,
  listBankAccounts,
} from "@/db/queries";
import { formatCurrency, formatDate } from "@/lib/format";
import { NewReconciliationDialog } from "./new-reconciliation-dialog";
import { requireOrg } from "@/lib/session";

export const dynamic = "force-dynamic";

const EPS = 0.01;

export default async function ReconciliationPage() {
  const { orgId } = await requireOrg();
  const [balances, recons, accounts] = await Promise.all([
    listAccountBalances(orgId),
    listReconciliations(orgId),
    listBankAccounts(orgId),
  ]);

  return (
    <>
      <PageHeader title="對帳" description="比對帳面餘額與帳戶實際餘額，確保記帳對得上">
        <NewReconciliationDialog
          accounts={accounts.map((a) => ({ id: a.id, name: a.name, currency: a.currency }))}
        />
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {balances.map((b) => (
          <Card key={b.id}>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">{b.name}</CardTitle>
              <CardDescription>
                {b.lastReconciledAt
                  ? `上次對帳：${formatDate(b.lastReconciledAt)}`
                  : "尚未對帳"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold tabular-nums">
                {formatCurrency(b.bookBalance, b.currency)}
              </div>
              <p className="text-xs text-muted-foreground">目前帳面餘額</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">對帳紀錄</CardTitle>
          <CardDescription>每筆紀錄比對截止日的帳面餘額與實際餘額</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>截止日</TableHead>
                <TableHead>帳戶</TableHead>
                <TableHead className="text-right">帳面餘額</TableHead>
                <TableHead className="text-right">實際餘額</TableHead>
                <TableHead className="text-right">差額</TableHead>
                <TableHead>狀態</TableHead>
                <TableHead>備註</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recons.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground">
                    尚無對帳紀錄
                  </TableCell>
                </TableRow>
              ) : (
                recons.map((r) => {
                  const diff = Number(r.statementBalance) - Number(r.bookBalance);
                  const matched = Math.abs(diff) < EPS;
                  return (
                    <RowDialog
                      key={r.id}
                      title="編輯對帳紀錄"
                      cells={
                        <>
                          <TableCell className="whitespace-nowrap text-muted-foreground">
                            {formatDate(r.asOfDate)}
                          </TableCell>
                          <TableCell>{r.accountName ?? "—"}</TableCell>
                          <TableCell className="text-right tabular-nums text-muted-foreground">
                            {formatCurrency(r.bookBalance, r.currency ?? "TWD")}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatCurrency(r.statementBalance, r.currency ?? "TWD")}
                          </TableCell>
                          <TableCell
                            className={
                              "text-right font-medium tabular-nums " +
                              (matched ? "text-muted-foreground" : "text-red-600")
                            }
                          >
                            {formatCurrency(diff, r.currency ?? "TWD")}
                          </TableCell>
                          <TableCell>
                            {matched ? (
                              <Badge variant="outline" className="gap-1">
                                <CheckCircle2 className="size-3" /> 已對平
                              </Badge>
                            ) : (
                              <Badge variant="destructive" className="gap-1">
                                <AlertTriangle className="size-3" /> 有差額
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {r.note ?? "—"}
                          </TableCell>
                        </>
                      }
                    >
                      <EditReconciliationForm
                        recon={{
                          id: r.id,
                          accountId: r.accountId,
                          asOfDate: r.asOfDate,
                          statementBalance: r.statementBalance,
                          note: r.note,
                        }}
                        accounts={accounts.map((a) => ({
                          id: a.id,
                          name: a.name,
                          currency: a.currency,
                        }))}
                        footer={<DeleteButton action={deleteReconciliation} id={r.id} />}
                      />
                    </RowDialog>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}

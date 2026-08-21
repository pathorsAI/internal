import { CheckCircle2, AlertTriangle } from "lucide-react";
import { getTranslations } from "next-intl/server";
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
import { TableCard } from "@/components/table-card";
import { EmptyRow } from "@/components/empty-state";
import { signColor } from "@/components/amount";
import {
  listAccountBalances,
  listReconciliations,
  listBankAccounts,
} from "@/db/queries";
import { formatCurrency, formatDate } from "@/lib/format";
import { NewReconciliationDialog } from "./new-reconciliation-dialog";
import { requireOrg } from "@/lib/session";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const EPS = 0.01;

export default async function ReconciliationPage() {
  const t = await getTranslations("reconciliation");
  const { orgId } = await requireOrg();
  const [balances, recons, accounts] = await Promise.all([
    listAccountBalances(orgId),
    listReconciliations(orgId),
    listBankAccounts(orgId),
  ]);

  return (
    <>
      <PageHeader title={t("title")} description={t("description")}>
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
                  ? t("card.lastReconciled", { date: formatDate(b.lastReconciledAt) })
                  : t("card.never")}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold tabular-nums">
                {formatCurrency(b.bookBalance, b.currency)}
              </div>
              <p className="text-xs text-muted-foreground">{t("card.currentBookBalance")}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <TableCard>
        <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("columns.asOfDate")}</TableHead>
                <TableHead>{t("columns.account")}</TableHead>
                <TableHead className="text-right">{t("columns.bookBalance")}</TableHead>
                <TableHead className="text-right">{t("columns.statementBalance")}</TableHead>
                <TableHead className="text-right">{t("columns.diff")}</TableHead>
                <TableHead>{t("columns.status")}</TableHead>
                <TableHead>{t("columns.note")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recons.length === 0 ? (
                <EmptyRow colSpan={7} message={t("empty")} />
              ) : (
                recons.map((r) => {
                  const diff = Number(r.statementBalance) - Number(r.bookBalance);
                  const matched = Math.abs(diff) < EPS;
                  return (
                    <RowDialog
                      key={r.id}
                      title={t("editTitle")}
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
                            className={cn(
                              "text-right font-medium tabular-nums",
                              matched ? "text-muted-foreground" : signColor(diff),
                            )}
                          >
                            {formatCurrency(diff, r.currency ?? "TWD")}
                          </TableCell>
                          <TableCell>
                            {matched ? (
                              <Badge variant="outline" className="gap-1">
                                <CheckCircle2 className="size-3" /> {t("status.matched")}
                              </Badge>
                            ) : (
                              <Badge variant="destructive" className="gap-1">
                                <AlertTriangle className="size-3" /> {t("status.mismatched")}
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
      </TableCard>
    </>
  );
}

import { getTranslations } from "next-intl/server";
import { RowDialog } from "@/components/row-dialog";
import { DeleteButton } from "@/components/delete-button";
import { deleteReconciliation } from "@/db/mutations";
import { EditReconciliationForm } from "./edit-reconciliation-form";
import { PageHeader } from "@/components/page-header";
import { StatusTag } from "@/components/ds/status-dot";
import { StatCard } from "@/components/ds/stat-card";
import { Progress } from "@/components/ds/progress";
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
import { Amount } from "@/components/amount";
import {
  listAccountBalances,
  listReconciliations,
  listBankAccounts,
} from "@/db/queries";
import { formatDate } from "@/lib/format";
import { NewReconciliationDialog } from "./new-reconciliation-dialog";
import { requireOrg } from "@/lib/session";

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
  // 對平幾筆 / 共幾筆（全部對帳紀錄），放在表格標題列的進度條
  const matchedCount = recons.filter(
    (r) => Math.abs(Number(r.statementBalance) - Number(r.bookBalance)) < EPS,
  ).length;

  return (
    <>
      <PageHeader title={t("title")} description={t("description")}>
        <NewReconciliationDialog
          accounts={accounts.map((a) => ({ id: a.id, name: a.name, currency: a.currency }))}
        />
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {balances.map((b) => (
          <StatCard
            key={b.id}
            label={b.name}
            value={Number(b.bookBalance)}
            currency={b.currency}
            hint={
              b.lastReconciledAt
                ? t("card.lastReconciled", { date: formatDate(b.lastReconciledAt) })
                : t("card.never")
            }
          />
        ))}
      </div>

      <TableCard
        title={<span className="text-muted-foreground">{t("table.title")}</span>}
        action={
          recons.length > 0 ? (
            <span className="flex items-center gap-2">
              <Progress
                value={matchedCount}
                max={recons.length}
                className="w-24"
                label={t("table.matched", { matched: matchedCount, total: recons.length })}
              />
              <span className="tabular-nums">
                {t("table.matched", { matched: matchedCount, total: recons.length })}
              </span>
            </span>
          ) : null
        }
      >
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
                          <TableCell className="text-right text-muted-foreground">
                            <Amount value={r.bookBalance} currency={r.currency ?? "TWD"} kind="neutral" />
                          </TableCell>
                          <TableCell className="text-right">
                            <Amount value={r.statementBalance} currency={r.currency ?? "TWD"} kind="neutral" />
                          </TableCell>
                          <TableCell className="text-right font-medium">
                            {matched ? (
                              <span className="text-subtle-foreground">—</span>
                            ) : (
                              // 有差額就是要有人去查的事：紅字，帶正負號（實際 − 帳面）
                              <Amount
                                value={diff}
                                currency={r.currency ?? "TWD"}
                                kind={diff > 0 ? "income" : "expense"}
                                className="text-destructive"
                              />
                            )}
                          </TableCell>
                          <TableCell>
                            {matched ? (
                              <StatusTag tone="income">{t("status.matched")}</StatusTag>
                            ) : (
                              <StatusTag tone="risk">{t("status.mismatched")}</StatusTag>
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

import { Info } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/page-header";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { StatCard } from "@/components/ds/stat-card";
import { Amount } from "@/components/amount";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyRow } from "@/components/empty-state";
import { TableCard } from "@/components/table-card";
import { listOutstandingAdvances, listBankAccounts } from "@/db/queries";
import { formatDate } from "@/lib/format";
import { RecordReimbursementDialog } from "./record-reimbursement-dialog";
import { requireOrg } from "@/lib/session";
import { groupAccountsByEmployee, listEmployeeAccounts } from "@/db/employee-accounts";

export const dynamic = "force-dynamic";

export default async function AdvancesPage() {
  const t = await getTranslations("advances");
  const { orgId } = await requireOrg();
  const [rows, accounts] = await Promise.all([
    listOutstandingAdvances(orgId),
    listBankAccounts(orgId),
  ]);
  // 只撈有未還代墊的員工的帳戶（遮罩後），給「匯入帳戶」下拉用
  const settleIds = [...new Set(rows.map((r) => r.settleEmployeeId).filter((id): id is number => id != null))];
  const accountsByEmployee = groupAccountsByEmployee(await listEmployeeAccounts(orgId, settleIds));
  const total = rows.reduce((s, r) => s + Number(r.amountTwd ?? r.amount ?? 0), 0);
  const accountOpts = accounts.map((a) => ({ id: a.id, name: a.name, currency: a.currency }));

  return (
    <>
      <PageHeader
        title={
          <span className="inline-flex items-center gap-1.5">
            {t("title")}
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-foreground"
                    aria-label={t("tooltipAria")}
                  >
                    <Info className="size-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent>{t("tooltipContent")}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </span>
        }
        description={t("description")}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label={t("card.totalLabel")}
          value={total}
          currency="TWD"
          hint={t("card.count", { count: rows.length })}
        />
      </div>

      <TableCard>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("columns.date")}</TableHead>
              <TableHead>{t("columns.payer")}</TableHead>
              <TableHead>{t("columns.vendorPurpose")}</TableHead>
              <TableHead>{t("columns.category")}</TableHead>
              <TableHead className="text-right">{t("columns.amount")}</TableHead>
              <TableHead className="text-right">{t("columns.action")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <EmptyRow colSpan={6} message={t("empty")} />
            ) : (
              rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {formatDate(r.txnDate)}
                  </TableCell>
                  <TableCell className="font-medium">{r.settleName ?? "—"}</TableCell>
                  <TableCell>
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate">{r.vendorName ?? "—"}</span>
                      {r.description ? (
                        <span className="truncate text-xs text-muted-foreground">
                          {r.description}
                        </span>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{r.categoryName ?? "—"}</TableCell>
                  <TableCell className="text-right font-medium">
                    {/* 未還金額是欠員工的餘額，不帶正負號 */}
                    <Amount value={r.amount ?? 0} currency={r.currency ?? "TWD"} kind="neutral" />
                  </TableCell>
                  <TableCell className="text-right">
                    <RecordReimbursementDialog
                      advance={{
                        id: r.id,
                        settleName: r.settleName ?? "",
                        amount: r.amount ?? "0",
                        currency: r.currency ?? "TWD",
                        vendorName: r.vendorName ?? "",
                      }}
                      accounts={accountOpts}
                      employeeAccounts={(r.settleEmployeeId == null
                        ? []
                        : (accountsByEmployee.get(r.settleEmployeeId) ?? [])
                      ).filter((a) => a.isActive)}
                    />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableCard>
    </>
  );
}

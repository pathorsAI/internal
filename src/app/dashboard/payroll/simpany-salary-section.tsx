import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { TableCard } from "@/components/table-card";
import { EmptyRow } from "@/components/empty-state";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCurrency, formatDateTime } from "@/lib/format";
import type { IntegrationSummary } from "@/lib/integrations/types";
import type { SalaryMonthStatus, SalaryReconciliation } from "@/lib/simpany-salary";
import { currentYearMonth } from "@/lib/simpany-payroll";
import { cn } from "@/lib/utils";
import { ArrearsDetailSheet, SalarySyncButton } from "./simpany-salary-client";
import { SalaryFilingSheet } from "./simpany-salary-filing";

const statusClass: Record<SalaryMonthStatus, string> = {
  settled: "border-emerald-500/40 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400",
  draft: "border-sky-500/40 bg-sky-500/5 text-sky-700 dark:text-sky-400",
  empty: "border-amber-500/40 bg-amber-500/5 text-amber-700 dark:text-amber-400",
  missing: "border-dashed text-muted-foreground",
  not_synced: "border-dashed text-muted-foreground/70",
};

/**
 * 薪資頁的「Simpany 薪資申報」區塊：月份狀態格 + 每位員工的欠薪對帳 + 未指定員工的薪資支出。
 * 資料只讀本地表（simpany_salary_* / payslips / transactions）；同步按鈕限 owner / admin。
 */
export async function SimpanySalarySection({
  recon,
  integration,
  canManage,
}: Readonly<{
  recon: SalaryReconciliation;
  integration: IntegrationSummary | null;
  canManage: boolean;
}>) {
  const t = await getTranslations("payroll.simpany");
  const usable = integration?.status === "connected" && integration.enabled;
  const { year } = recon;
  // 申報寫入只開放給 owner / admin，而且只到本月（還沒發生的月份不能申報）。
  const now = currentYearMonth();
  const canFile = (month: number) =>
    canManage && usable && (year < now.year || (year === now.year && month <= now.month));

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-base font-semibold">{t("title")}</h2>
          <p className="text-sm text-muted-foreground">{t("description")}</p>
          <p className="text-xs text-muted-foreground">
            {recon.lastSyncedAt
              ? t("lastSynced", { date: formatDateTime(recon.lastSyncedAt) })
              : t("neverSynced")}
            {usable ? null : (
              <>
                {" · "}
                {t("notConnected")}{" "}
                <Link href="/dashboard/settings/integrations" className="text-primary hover:underline">
                  {t("settingsLink")}
                </Link>
              </>
            )}
          </p>
        </div>
        <div className="flex items-start gap-2">
          <div className="flex items-center gap-1">
            <Button size="icon" variant="ghost" className="size-8" asChild>
              <Link href={`/dashboard/payroll?year=${year - 1}`} aria-label={t("prevYear")}>
                <ChevronLeft className="size-4" />
              </Link>
            </Button>
            <span className="min-w-[4ch] text-center text-sm font-medium tabular-nums">{year}</span>
            <Button size="icon" variant="ghost" className="size-8" asChild>
              <Link href={`/dashboard/payroll?year=${year + 1}`} aria-label={t("nextYear")}>
                <ChevronRight className="size-4" />
              </Link>
            </Button>
          </div>
          {canManage && usable ? <SalarySyncButton year={year} /> : null}
        </div>
      </div>

      <Card className="gap-0 p-3">
        <div className="mb-2 text-sm font-medium">{t("months.title")}</div>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6 lg:grid-cols-12">
          {recon.months.map((m) => (
            <div
              key={m.month}
              className={cn("flex flex-col gap-0.5 rounded-md border px-2 py-1.5 text-xs", statusClass[m.status])}
              title={m.payday ? t("months.payday", { date: m.payday }) : undefined}
            >
              <span className="font-medium tabular-nums text-foreground">
                {t("months.month", { month: m.month })}
              </span>
              <span>{t(`months.status.${m.status}`)}</span>
              {m.employeeCount > 0 && m.status !== "missing" ? (
                <span className="tabular-nums opacity-80">
                  {t("months.filedOf", { filed: m.filedCount, total: m.employeeCount })}
                </span>
              ) : null}
              {canFile(m.month) ? (
                <SalaryFilingSheet year={year} month={m.month} settled={m.status === "settled"} />
              ) : null}
            </div>
          ))}
        </div>
      </Card>

      <TableCard
        title={t("arrears.title")}
        action={t("arrears.window", {
          month: recon.throughMonth,
          from: recon.paidFrom,
          to: recon.paidTo,
        })}
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("arrears.columns.employee")}</TableHead>
              <TableHead className="text-right">{t("arrears.columns.declared")}</TableHead>
              <TableHead className="text-right">{t("arrears.columns.paid")}</TableHead>
              <TableHead className="text-right">{t("arrears.columns.arrears")}</TableHead>
              <TableHead className="text-right">{t("arrears.columns.detail")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {recon.employees.length === 0 ? (
              <EmptyRow colSpan={5} message={t("arrears.empty")} />
            ) : (
              recon.employees.map((e) => (
                <TableRow key={e.key}>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-medium">{e.name}</span>
                      {e.isCompanyOwner ? <Badge variant="secondary">{t("arrears.owner")}</Badge> : null}
                      {e.employeeId == null ? (
                        <Badge variant="outline" className="text-muted-foreground">
                          {t("arrears.unlinked")}
                        </Badge>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    <div>{formatCurrency(e.totalDeclaredNet)}</div>
                    {e.totalEstimatedNet > 0 ? (
                      <div className="text-xs text-amber-700 dark:text-amber-400">
                        {t("arrears.estimatedExtra", { amount: formatCurrency(e.totalEstimatedNet) })}
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    <div>{formatCurrency(e.totalPaid)}</div>
                    {e.credit > 0 ? (
                      <div className="text-xs">{t("arrears.credit", { amount: formatCurrency(e.credit) })}</div>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    <div className={e.arrears > 0 ? "font-semibold text-expense" : "text-muted-foreground"}>
                      {formatCurrency(e.arrears)}
                    </div>
                    {e.estimatedArrears > 0 ? (
                      <div className="text-xs text-amber-700 dark:text-amber-400">
                        {t("arrears.estimatedExtra", { amount: formatCurrency(e.estimatedArrears) })}
                      </div>
                    ) : null}
                    {e.notYetDue > 0 ? (
                      <div className="text-xs text-muted-foreground">
                        {t("arrears.notYetDue", { amount: formatCurrency(e.notYetDue) })}
                      </div>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-right">
                    <ArrearsDetailSheet employee={e} />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
          {recon.employees.length > 1 ? (
            <TableFooter>
              <TableRow>
                <TableCell className="font-medium">{t("arrears.total")}</TableCell>
                <TableCell className="text-right tabular-nums">{formatCurrency(recon.totals.declaredNet)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatCurrency(recon.totals.paid)}</TableCell>
                <TableCell className="text-right font-semibold tabular-nums">
                  {formatCurrency(recon.totals.arrears)}
                  {recon.totals.estimatedArrears > 0 ? (
                    <div className="text-xs font-normal text-amber-700 dark:text-amber-400">
                      {t("arrears.estimatedExtra", { amount: formatCurrency(recon.totals.estimatedArrears) })}
                    </div>
                  ) : null}
                </TableCell>
                <TableCell />
              </TableRow>
            </TableFooter>
          ) : null}
        </Table>
      </TableCard>
      {recon.totals.estimatedNet > 0 ? (
        <p className="text-xs text-muted-foreground">{t("arrears.estimateNote")}</p>
      ) : null}

      {recon.unallocatedPayments.length > 0 ? (
        <TableCard
          title={t("unallocated.title")}
          action={formatCurrency(recon.totals.unallocated)}
        >
          <p className="border-b px-4 py-2 text-xs text-muted-foreground">{t("unallocated.description")}</p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("unallocated.columns.date")}</TableHead>
                <TableHead>{t("unallocated.columns.description")}</TableHead>
                <TableHead>{t("unallocated.columns.party")}</TableHead>
                <TableHead>{t("unallocated.columns.account")}</TableHead>
                <TableHead className="text-right">{t("unallocated.columns.amount")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {recon.unallocatedPayments.map((p) => (
                <TableRow key={p.transactionId}>
                  <TableCell className="whitespace-nowrap tabular-nums text-muted-foreground">
                    <Link href="/dashboard/transactions" className="hover:underline">
                      {p.date}
                    </Link>
                  </TableCell>
                  <TableCell className="max-w-[32ch] truncate">{p.description ?? "—"}</TableCell>
                  <TableCell>{p.partyName ?? "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{p.accountName ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCurrency(p.amount, p.currency)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableCard>
      ) : null}
    </section>
  );
}

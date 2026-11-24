import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/page-header";
import { TableCard } from "@/components/table-card";
import { StatusTag } from "@/components/ds/status-dot";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  countTransactionsByMonth,
  getAccountingSettings,
  listFiscalPeriods,
  loadLedgerInputs,
  monthEnd,
  todayInTaipei,
} from "@/db/ledger";
import { runChecks } from "@/lib/ledger";
import type { Check } from "@/lib/ledger/types";
import { formatDate, formatDateTime, formatYearMonth } from "@/lib/format";
import { canManageOrg, requireOrgWithRole } from "@/lib/session";
import { AccountingNav } from "../accounting-nav";
import { PeriodActions } from "./periods-client";

export const dynamic = "force-dynamic";

const CHECK_TONE = { pass: "income", warn: "warning", fail: "risk" } as const;

type Month = { year: number; month: number; ym: string };

function ymOf(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

/** 從 (year, month) 起連續 count 個月。 */
function monthsFrom(year: number, month: number, count: number): Month[] {
  const start = year * 12 + (month - 1);
  return Array.from({ length: count }, (_, i) => {
    const y = Math.floor((start + i) / 12);
    const m = ((start + i) % 12) + 1;
    return { year: y, month: m, ym: ymOf(y, m) };
  });
}

type PeriodState = "closed" | "future" | "open";

const PERIOD_TONE = { closed: "income", future: "neutral", open: "warning" } as const;

function periodState(isClosed: boolean, future: boolean): PeriodState {
  if (isClosed) return "closed";
  if (future) return "future";
  return "open";
}

async function safeChecks(orgId: string, asOf: string): Promise<Check[] | null> {
  try {
    const inputs = await loadLedgerInputs(orgId);
    return runChecks(inputs, "government", asOf);
  } catch {
    return null;
  }
}

export default async function PeriodsPage() {
  const t = await getTranslations("accounting");
  const { orgId, role } = await requireOrgWithRole();
  const canManage = canManageOrg(role);
  const today = todayInTaipei();
  const [ty, tm] = today.split("-").map(Number);
  const currentYm = ymOf(ty, tm);

  const settings = await getAccountingSettings(orgId);
  const fy = settings.fiscalYearStartMonth;
  // 本會計年度的起始年：今天的月份還沒到起始月，就是去年開始的那個年度
  const fyStartYear = tm >= fy ? ty : ty - 1;
  const months = monthsFrom(fyStartYear - 1, fy, 24);
  const windowEnd = monthEnd(months[23].year, months[23].month);

  const [periods, txnCounts] = await Promise.all([
    listFiscalPeriods(orgId),
    countTransactionsByMonth(orgId, "1900-01-01", windowEnd),
  ]);
  const byYm = new Map(periods.map((p) => [ymOf(p.year, p.month), p]));
  const closed = new Set(periods.filter((p) => p.status === "closed").map((p) => ymOf(p.year, p.month)));
  const openWithTxns = Object.keys(txnCounts)
    .filter((ym) => !closed.has(ym))
    .sort((a, b) => a.localeCompare(b));

  // 檢查：最近一個還沒結帳、且已經到了的月份的月底
  const latestOpen = [...months].reverse().find((m) => m.ym <= currentYm && !closed.has(m.ym));
  const asOf = latestOpen ? monthEnd(latestOpen.year, latestOpen.month) : today;
  // 檢查日不晚於今天
  let checkDate = today;
  if (asOf < today) checkDate = asOf;
  const checks = await safeChecks(orgId, checkDate);

  // 新的年度在前；每個年度內新的月份在前，標題用年度第一個月的年份
  const fiscalYears = [
    { year: months[12].year, list: months.slice(12).reverse() },
    { year: months[0].year, list: months.slice(0, 12).reverse() },
  ];

  return (
    <>
      <PageHeader title={t("title")} />
      <AccountingNav active="periods" />
      <p className="text-sm text-muted-foreground">{t("periods.description")}</p>

      <Card className="gap-3 py-4">
        <CardHeader className="px-4">
          <CardTitle className="text-sm font-medium">
            {t("periods.checksTitle", { date: formatDate(checkDate) })}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4">
          {checks === null ? (
            <p className="text-sm text-muted-foreground">{t("periods.checksUnavailable")}</p>
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2">
              {checks.map((c) => (
                <li key={c.code} className="flex min-w-0 items-start gap-2 text-sm">
                  <StatusTag tone={CHECK_TONE[c.status]}>{t(`checks.status.${c.status}`)}</StatusTag>
                  <span className="min-w-0">
                    {t(`checks.${c.code}`)}
                    {/* 通過就不囉嗦；沒過才說差多少、哪個帳戶 */}
                    {c.status !== "pass" && typeof c.params.diff === "number" ? (
                      <span className="block truncate text-xs text-muted-foreground tabular-nums">
                        {c.params.account
                          ? t("checks.diffAccount", { account: String(c.params.account), diff: c.params.diff.toLocaleString() })
                          : t("checks.diff", { diff: c.params.diff.toLocaleString() })}
                      </span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {fiscalYears.map(({ year: label, list }) => {
        return (
          <TableCard key={label} title={t("periods.fiscalYear", { year: label })}>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-28">{t("periods.period")}</TableHead>
                    <TableHead>{t("periods.status")}</TableHead>
                    <TableHead className="text-right">{t("periods.transactions")}</TableHead>
                    <TableHead>{t("periods.closedAt")}</TableHead>
                    <TableHead>{t("periods.closedBy")}</TableHead>
                    <TableHead className="w-32 text-right" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {list.map((m) => {
                    const p = byYm.get(m.ym);
                    const isClosed = p?.status === "closed";
                    const future = m.ym > currentYm;
                    const earlierOpen = openWithTxns.filter((ym) => ym < m.ym).length;
                    const periodLabel = formatYearMonth(m.year, m.month);
                    const state = periodState(isClosed, future);
                    return (
                      <TableRow key={m.ym}>
                        <TableCell className="font-medium tabular-nums">{periodLabel}</TableCell>
                        <TableCell>
                          <StatusTag tone={PERIOD_TONE[state]}>{t(`periods.${state}`)}</StatusTag>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{txnCounts[m.ym] ?? 0}</TableCell>
                        <TableCell className="text-xs text-muted-foreground tabular-nums">
                          {isClosed && p?.closedAt ? formatDateTime(p.closedAt) : t("common.none")}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {isClosed ? (p?.closedBy ?? t("common.none")) : t("common.none")}
                        </TableCell>
                        <TableCell className="text-right">
                          {canManage && !future ? (
                            <PeriodActions
                              year={m.year}
                              month={m.month}
                              label={periodLabel}
                              closed={isClosed}
                              earlierOpen={earlierOpen}
                            />
                          ) : null}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </TableCard>
        );
      })}
      {canManage ? null : <p className="text-sm text-muted-foreground">{t("periods.manageOnly")}</p>}
    </>
  );
}

"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { FileSpreadsheet } from "lucide-react";
import { Amount } from "@/components/amount";
import { EmptyRow } from "@/components/empty-state";
import { TableCard } from "@/components/table-card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { LedgerKind, Period, StatementRow, TrialBalanceRow } from "@/lib/ledger/types";
import { cn } from "@/lib/utils";
import { AccountLedgerSheet, type DrillTarget } from "./account-ledger-sheet";
import { changeRatio, formatPercent, loose, rowClass, rowLabel } from "./labels";

/**
 * 資產負債表、損益表、現金流量表共用的表格：代碼、名稱、本期、比較期、變動 %。
 * drill 有給時，科目列整列可點，右側滑出下鑽明細；列印頁不給 drill。
 */
export function StatementTable({
  title,
  rows,
  currentLabel,
  compareLabel,
  drill,
}: Readonly<{
  title: string;
  rows: StatementRow[];
  currentLabel: string;
  compareLabel: string | null;
  drill?: { ledger: LedgerKind; period: Period };
}>) {
  const t = useTranslations("statements");
  const lt = loose(t);
  const locale = useLocale();
  const [target, setTarget] = useState<DrillTarget | null>(null);
  const hasCompare = compareLabel !== null;
  const colSpan = hasCompare ? 5 : 3;

  return (
    <TableCard title={title} action={drill ? t("table.drillHint") : undefined}>
      <div className="min-w-0 overflow-x-auto">
        <Table className={hasCompare ? "min-w-[720px]" : "min-w-[480px]"}>
          <TableHeader>
            <TableRow>
              <TableHead className="w-20">{t("table.code")}</TableHead>
              <TableHead>{t("table.name")}</TableHead>
              <TableHead className="w-40 text-right">{currentLabel}</TableHead>
              {hasCompare ? <TableHead className="w-40 text-right">{compareLabel}</TableHead> : null}
              {hasCompare ? <TableHead className="w-24 text-right">{t("table.change")}</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <EmptyRow colSpan={colSpan} icon={FileSpreadsheet} message={t("table.empty")} />
            ) : (
              rows.map((row) => (
                <StatementTableRow
                  key={row.key}
                  row={row}
                  label={rowLabel(lt, row)}
                  hasCompare={hasCompare}
                  locale={locale}
                  onDrill={drill ? setTarget : undefined}
                />
              ))
            )}
          </TableBody>
        </Table>
      </div>
      {drill ? (
        <AccountLedgerSheet target={target} ledger={drill.ledger} period={drill.period} onClose={() => setTarget(null)} />
      ) : null}
    </TableCard>
  );
}

/** 報表的一列；onDrill 有給時科目列整列可點。 */
function StatementTableRow({
  row,
  label,
  hasCompare,
  locale,
  onDrill,
}: Readonly<{
  row: StatementRow;
  label: string;
  hasCompare: boolean;
  locale: string;
  onDrill?: (target: DrillTarget) => void;
}>) {
  const clickable = !!onDrill && row.kind === "account" && row.glAccountId !== null;
  const isHeader = row.kind === "header";
  return (
    <TableRow
      className={cn(rowClass(row.kind), clickable && "cursor-pointer", !clickable && row.kind === "account" && "hover:bg-transparent")}
      onClick={
        clickable && onDrill
          ? () => onDrill({ glAccountId: row.glAccountId as number, code: row.code, name: row.label })
          : undefined
      }
    >
      <TableCell className="tabular-nums text-muted-foreground">{row.code ?? ""}</TableCell>
      <TableCell style={{ paddingLeft: `${16 + Math.max(0, row.level) * 16}px` }}>{label}</TableCell>
      <TableCell className="text-right">{isHeader ? null : <Amount value={row.amount} kind="neutral" />}</TableCell>
      {hasCompare ? <CompareCells row={row} isHeader={isHeader} locale={locale} /> : null}
    </TableRow>
  );
}

/** 比較期的兩欄：比較期金額、增減百分比。 */
function CompareCells({
  row,
  isHeader,
  locale,
}: Readonly<{ row: StatementRow; isHeader: boolean; locale: string }>) {
  const showAmount = !isHeader && row.compareAmount !== null;
  return (
    <>
      <TableCell className="text-right text-muted-foreground">
        {showAmount ? <Amount value={row.compareAmount as number} kind="neutral" /> : null}
      </TableCell>
      <TableCell className="text-right tabular-nums text-muted-foreground">
        {isHeader ? null : formatPercent(changeRatio(row.amount, row.compareAmount), locale)}
      </TableCell>
    </>
  );
}

/** 試算表：期初、本期借、本期貸、期末；最後一列合計（借貸必相等）。 */
export function TrialBalanceTable({
  rows,
  drill,
}: Readonly<{ rows: TrialBalanceRow[]; drill?: { ledger: LedgerKind; period: Period } }>) {
  const t = useTranslations("statements");
  const [target, setTarget] = useState<DrillTarget | null>(null);
  const totals = rows.reduce(
    (s, r) => ({
      opening: s.opening + r.opening,
      debit: s.debit + r.debit,
      credit: s.credit + r.credit,
      closing: s.closing + r.closing,
    }),
    { opening: 0, debit: 0, credit: 0, closing: 0 },
  );
  const balanced = Math.abs(totals.debit - totals.credit) < 0.005;

  return (
    <TableCard
      title={t("reports.tb")}
      action={balanced ? t("tb.balanced") : <span className="text-destructive">{t("tb.unbalanced")}</span>}
    >
      <div className="min-w-0 overflow-x-auto">
        <Table className="min-w-[800px]">
          <TableHeader>
            <TableRow>
              <TableHead className="w-20">{t("table.code")}</TableHead>
              <TableHead>{t("table.name")}</TableHead>
              <TableHead className="w-36 text-right">{t("tb.opening")}</TableHead>
              <TableHead className="w-36 text-right">{t("tb.debit")}</TableHead>
              <TableHead className="w-36 text-right">{t("tb.credit")}</TableHead>
              <TableHead className="w-36 text-right">{t("tb.closing")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <EmptyRow colSpan={6} icon={FileSpreadsheet} message={t("table.empty")} />
            ) : (
              <>
                {rows.map((r) => (
                  <TableRow
                    key={r.glAccountId}
                    className={drill ? "cursor-pointer" : "hover:bg-transparent"}
                    onClick={drill ? () => setTarget({ glAccountId: r.glAccountId, code: r.code, name: r.name }) : undefined}
                  >
                    <TableCell className="tabular-nums text-muted-foreground">{r.code}</TableCell>
                    <TableCell>{r.name}</TableCell>
                    <TableCell className="text-right">
                      <Amount value={r.opening} kind="neutral" />
                    </TableCell>
                    <TableCell className="text-right">
                      {r.debit ? <Amount value={r.debit} kind="neutral" /> : null}
                    </TableCell>
                    <TableCell className="text-right">
                      {r.credit ? <Amount value={r.credit} kind="neutral" /> : null}
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      <Amount value={r.closing} kind="neutral" />
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className={rowClass("total")}>
                  <TableCell />
                  <TableCell>{t("tb.total")}</TableCell>
                  <TableCell className="text-right">
                    <Amount value={totals.opening} kind="neutral" />
                  </TableCell>
                  <TableCell className={cn("text-right", !balanced && "text-destructive")}>
                    <Amount value={totals.debit} kind="neutral" />
                  </TableCell>
                  <TableCell className={cn("text-right", !balanced && "text-destructive")}>
                    <Amount value={totals.credit} kind="neutral" />
                  </TableCell>
                  <TableCell className="text-right">
                    <Amount value={totals.closing} kind="neutral" />
                  </TableCell>
                </TableRow>
              </>
            )}
          </TableBody>
        </Table>
      </div>
      <p className="border-t px-4 py-2 text-xs text-muted-foreground">{t("tb.signNote")}</p>
      {drill ? (
        <AccountLedgerSheet target={target} ledger={drill.ledger} period={drill.period} onClose={() => setTarget(null)} />
      ) : null}
    </TableCard>
  );
}

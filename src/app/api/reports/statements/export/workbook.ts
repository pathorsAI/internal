/**
 * 財務報表 Excel 的內容：試算表、四大報表、總分類帳（每一行分錄）、待處理。
 * 純函式（翻譯函式由 route 傳進來），金額一律是數字儲存格，會計師可以直接加總。
 */
import {
  balanceSheet,
  cashFlowStatement,
  equityChanges,
  incomeStatement,
  reviewItems,
  trialBalance,
} from "@/lib/ledger";
import type { BuildResult, LedgerInputs, Statement } from "@/lib/ledger/types";
import { periodText, rowLabel, type LooseT } from "@/app/dashboard/reports/statements/labels";
import type { StatementParams } from "@/app/dashboard/reports/statements/params";
import { reviewDetail } from "@/app/dashboard/reports/statements/review-detail";
import type { XlsxCell, XlsxSheet } from "@/lib/xlsx-write";

const bold = (v: string | number | null): XlsxCell => ({ v, bold: true });

function headerRows(t: LooseT, inputs: LedgerInputs, params: StatementParams, title: string, sub: string): XlsxCell[][] {
  const ledgerName = t(`ledger.${params.ledger}`);
  const unit = t("print.unit", { currency: inputs.settings.functionalCurrency });
  return [[bold(inputs.orgName)], [bold(title)], [sub], [`${ledgerName} · ${unit}`], []];
}

/** 一張報表分頁：名稱、副標、報表本體、本期／比較期欄位標題。 */
type StatementSheetSpec = {
  name: string;
  sub: string;
  statement: Statement;
  currentLabel: string;
  compareLabel: string | null;
};

function statementSheet(
  t: LooseT,
  inputs: LedgerInputs,
  params: StatementParams,
  { name, sub, statement, currentLabel, compareLabel }: StatementSheetSpec,
): XlsxSheet {
  const hasCompare = compareLabel !== null;
  const head: XlsxCell[] = [bold(t("table.code")), bold(t("table.name")), bold(currentLabel)];
  if (hasCompare) head.push(bold(compareLabel), bold(t("table.change")));
  const rows = statement.rows.map((r): XlsxCell[] => {
    const strong = r.kind !== "account";
    const indent = "  ".repeat(Math.max(0, r.level));
    const label = `${indent}${rowLabel(t, r)}`;
    if (r.kind === "header") return [r.code ?? "", bold(label)];
    const cells: XlsxCell[] = [r.code ?? "", strong ? bold(label) : label, strong ? bold(r.amount) : r.amount];
    if (hasCompare) {
      cells.push(r.compareAmount);
      const ratio =
        r.compareAmount === null || Math.abs(r.compareAmount) < 0.005
          ? null
          : Math.round(((r.amount - r.compareAmount) / Math.abs(r.compareAmount)) * 1000) / 10;
      cells.push(ratio === null ? "" : { v: ratio, plain: true });
    }
    return cells;
  });
  return {
    name,
    widths: hasCompare ? [10, 40, 18, 18, 10] : [10, 40, 18],
    rows: [...headerRows(t, inputs, params, name, sub), head, ...rows],
  };
}

export function buildStatementsWorkbook(
  t: LooseT,
  inputs: LedgerInputs,
  built: BuildResult,
  params: StatementParams,
): XlsxSheet[] {
  const { period, comparePeriod } = params;
  const asOf = period.to;
  const periodSub = t("print.period", { period: periodText(period) });
  const asOfSub = t("print.asOf", { date: asOf });

  // 試算表
  const tb = trialBalance(inputs, params.ledger, period);
  const tbTotals = tb.reduce(
    (s, r) => ({ opening: s.opening + r.opening, debit: s.debit + r.debit, credit: s.credit + r.credit, closing: s.closing + r.closing }),
    { opening: 0, debit: 0, credit: 0, closing: 0 },
  );
  const tbSheet: XlsxSheet = {
    name: t("reports.tb"),
    widths: [10, 36, 18, 18, 18, 18],
    rows: [
      ...headerRows(t, inputs, params, t("reports.tb"), periodSub),
      [bold(t("table.code")), bold(t("table.name")), bold(t("tb.opening")), bold(t("tb.debit")), bold(t("tb.credit")), bold(t("tb.closing"))],
      ...tb.map((r): XlsxCell[] => [r.code, r.name, r.opening, r.debit, r.credit, r.closing]),
      ["", bold(t("tb.total")), bold(tbTotals.opening), bold(tbTotals.debit), bold(tbTotals.credit), bold(tbTotals.closing)],
      [],
      [t("tb.signNote")],
    ],
  };

  const bsSheet = statementSheet(t, inputs, params, {
    name: t("reports.bs"),
    sub: asOfSub,
    statement: balanceSheet(inputs, params.ledger, asOf, comparePeriod?.to ?? null),
    currentLabel: t("table.asOf", { date: asOf }),
    compareLabel: comparePeriod ? t("table.asOf", { date: comparePeriod.to }) : null,
  });
  const isSheet = statementSheet(t, inputs, params, {
    name: t("reports.is"),
    sub: periodSub,
    statement: incomeStatement(inputs, params.ledger, period, comparePeriod),
    currentLabel: periodText(period),
    compareLabel: comparePeriod ? periodText(comparePeriod) : null,
  });
  const cfSheet = statementSheet(t, inputs, params, {
    name: t("reports.cf"),
    sub: periodSub,
    statement: cashFlowStatement(inputs, params.ledger, period, comparePeriod),
    currentLabel: periodText(period),
    compareLabel: comparePeriod ? periodText(comparePeriod) : null,
  });

  // 權益變動表
  const eq = equityChanges(inputs, params.ledger, period);
  const eqCols = ["capital", "retained", "other", "total"] as const;
  const eqSheet: XlsxSheet = {
    name: t("reports.eq"),
    widths: [24, 18, 18, 18, 18],
    rows: [
      ...headerRows(t, inputs, params, t("reports.eq"), periodSub),
      [bold(t("table.item")), ...eqCols.map((c) => bold(t(`labels.equity.columns.${c}`)))],
      ...eq.map((r): XlsxCell[] => {
        const strong = r.key === "opening" || r.key === "closing";
        const label = t(`labels.equity.${r.key}`);
        return [strong ? bold(label) : label, ...eqCols.map((c) => (strong ? bold(r[c]) : r[c]))];
      }),
    ],
  };

  // 總分類帳：期間內每一行分錄
  const accountById = new Map(inputs.accounts.map((a) => [a.id, a]));
  const glRows: XlsxCell[][] = [];
  const postings = built.postings
    .filter((p) => p.ledger === params.ledger && p.date >= period.from && p.date <= period.to)
    .sort((a, b) => (a.date === b.date ? a.key.localeCompare(b.key) : a.date.localeCompare(b.date)));
  for (const p of postings) {
    for (const l of p.lines) {
      const account = accountById.get(l.glAccountId);
      glRows.push([
        p.date,
        p.key,
        t(`source.${p.sourceType}`),
        account?.code ?? "",
        account?.name ?? String(l.glAccountId),
        l.memo ?? p.memo,
        l.debit || null,
        l.credit || null,
        l.currency ?? "",
        l.fxAmount,
      ]);
    }
  }
  const glDebit = postings.reduce((s, p) => s + p.lines.reduce((x, l) => x + l.debit, 0), 0);
  const glCredit = postings.reduce((s, p) => s + p.lines.reduce((x, l) => x + l.credit, 0), 0);
  const glSheet: XlsxSheet = {
    name: t("export.generalLedger"),
    widths: [12, 30, 10, 10, 28, 40, 16, 16, 8, 16],
    rows: [
      ...headerRows(t, inputs, params, t("export.generalLedger"), periodSub),
      [
        bold(t("export.gl.date")),
        bold(t("export.gl.key")),
        bold(t("export.gl.source")),
        bold(t("table.code")),
        bold(t("export.gl.account")),
        bold(t("export.gl.memo")),
        bold(t("tb.debit")),
        bold(t("tb.credit")),
        bold(t("export.gl.currency")),
        bold(t("export.gl.fxAmount")),
      ],
      ...glRows,
      ["", "", "", "", "", bold(t("tb.total")), bold(glDebit), bold(glCredit)],
    ],
  };

  // 待處理
  const review = reviewItems(inputs, asOf).filter((r) => r.ledger === "both" || r.ledger === params.ledger);
  const reviewSheet: XlsxSheet = {
    name: t("reports.review"),
    widths: [28, 10, 10, 12, 16, 12, 10, 50],
    rows: [
      ...headerRows(t, inputs, params, t("reports.review"), asOfSub),
      [
        bold(t("export.review.code")),
        bold(t("export.review.severity")),
        bold(t("review.columns.ledger")),
        bold(t("review.columns.date")),
        bold(t("review.columns.amount")),
        bold(t("review.columns.source")),
        bold(t("export.review.sourceId")),
        bold(t("review.columns.detail")),
      ],
      ...review.map((r): XlsxCell[] => {
        const key = `review.codes.${r.code}.title`;
        return [
          t.has(key) ? t(key) : r.code,
          t(`review.severity.${r.severity}`),
          t(`review.ledger.${r.ledger}`),
          r.date ?? "",
          r.amount,
          t(`source.${r.sourceType}`),
          r.sourceId === null ? "" : { v: r.sourceId, plain: true },
          reviewDetail(inputs, r),
        ];
      }),
    ],
  };

  return [tbSheet, bsSheet, isSheet, cfSheet, eqSheet, glSheet, reviewSheet];
}

import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  balanceSheet,
  buildLedger,
  cashFlowStatement,
  equityChanges,
  incomeStatement,
} from "@/lib/ledger";
import { requireOrg } from "@/lib/session";
import { periodText } from "../labels";
import { loadStatementsContext } from "../load";
import { buildNotes } from "../notes";
import { statementQuery } from "../params";
import { StatementTable } from "../statement-table";
import { EquityTable, NotesView, StatementsEmpty } from "../views";
import { PrintButton } from "./print-button";

export const dynamic = "force-dynamic";

/**
 * 列印／存 PDF：四大報表＋附註，依台灣財報的順序。dashboard layout 的側欄與頂列在列印時藏起來
 * （下面那段 @media print），螢幕上照常顯示，方便按「返回」。每張報表各自一頁。
 */
const PRINT_CSS = `
@media print {
  @page { size: A4; margin: 14mm 12mm; }
  [data-slot="sidebar"], [data-slot="sidebar-gap"], [data-slot="sidebar-inset"] > header,
  [data-print-hide] { display: none !important; }
  [data-slot="sidebar-inset"] { margin: 0 !important; box-shadow: none !important; }
  [data-slot="sidebar-inset"] > * { padding: 0 !important; }
  [data-print-page] { break-before: page; }
  [data-print-page]:first-of-type { break-before: auto; }
  [data-slot="card"] { box-shadow: none !important; }
  [data-print-root] * { overflow: visible !important; }
}
`;

type SearchParams = Record<string, string | string[] | undefined>;

export default async function StatementsPrintPage({
  searchParams,
}: Readonly<{ searchParams: Promise<SearchParams> }>) {
  const { orgId } = await requireOrg();
  const t = await getTranslations("statements");
  const ctx = await loadStatementsContext(orgId, await searchParams);
  const { inputs, params } = ctx;
  const { ledger, period, comparePeriod } = params;
  const backHref = `/dashboard/reports/statements?${statementQuery(params)}`;

  const toolbar = (
    <div data-print-hide className="flex items-center justify-between gap-2">
      <Button asChild size="sm" variant="ghost">
        <Link href={backHref}>
          <ArrowLeft /> {t("print.back")}
        </Link>
      </Button>
      <PrintButton />
    </div>
  );

  if (!ctx.hasData) {
    return (
      <>
        {toolbar}
        <StatementsEmpty />
      </>
    );
  }

  const asOf = period.to;
  const built = buildLedger(inputs, { ledger, asOf });
  const bs = balanceSheet(inputs, ledger, asOf, comparePeriod?.to ?? null);
  const is = incomeStatement(inputs, ledger, period, comparePeriod);
  const cf = cashFlowStatement(inputs, ledger, period, comparePeriod);
  const eq = equityChanges(inputs, ledger, period);
  const notes = buildNotes(inputs, built, ledger, asOf);
  const unit = t("print.unit", { currency: inputs.settings.functionalCurrency });

  const titleBlock = (report: string, sub: string) => (
    <header className="grid gap-0.5 text-center">
      <p className="text-base font-semibold">{inputs.orgName}</p>
      <h2 className="text-lg font-semibold tracking-wide">{report}</h2>
      <p className="text-xs text-muted-foreground tabular-nums">{sub}</p>
      <p className="text-right text-xs text-muted-foreground">
        {t(`ledger.${ledger}`)} · {unit}
      </p>
    </header>
  );

  return (
    <div data-print-root className="mx-auto grid w-full max-w-4xl gap-10">
      <style>{PRINT_CSS}</style>
      {toolbar}

      <section data-print-page className="grid gap-3">
        {titleBlock(t("reports.bs"), t("print.asOf", { date: asOf }))}
        <StatementTable
          title={t("reports.bs")}
          rows={bs.rows}
          currentLabel={t("table.asOf", { date: asOf })}
          compareLabel={comparePeriod ? t("table.asOf", { date: comparePeriod.to }) : null}
        />
      </section>

      <section data-print-page className="grid gap-3">
        {titleBlock(t("reports.is"), t("print.period", { period: periodText(period) }))}
        <StatementTable
          title={t("reports.is")}
          rows={is.rows}
          currentLabel={periodText(period)}
          compareLabel={comparePeriod ? periodText(comparePeriod) : null}
        />
      </section>

      <section data-print-page className="grid gap-3">
        {titleBlock(t("reports.cf"), t("print.period", { period: periodText(period) }))}
        <StatementTable
          title={t("reports.cf")}
          rows={cf.rows}
          currentLabel={periodText(period)}
          compareLabel={comparePeriod ? periodText(comparePeriod) : null}
        />
      </section>

      <section data-print-page className="grid gap-3">
        {titleBlock(t("reports.eq"), t("print.period", { period: periodText(period) }))}
        <EquityTable rows={eq} />
      </section>

      <section data-print-page className="grid gap-3">
        {titleBlock(t("reports.notes"), t("print.asOf", { date: asOf }))}
        <NotesView data={notes} />
      </section>

      <p className="text-center text-xs text-muted-foreground">{t("print.footer", { date: ctx.today })}</p>
    </div>
  );
}

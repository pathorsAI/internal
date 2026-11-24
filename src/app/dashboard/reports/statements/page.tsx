import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/page-header";
import {
  balanceSheet,
  buildLedger,
  cashFlowStatement,
  equityChanges,
  fiscalYearStart,
  incomeStatement,
  reviewItems,
  runChecks,
  trialBalance,
  vatReport,
} from "@/lib/ledger";
import { requireOrg } from "@/lib/session";
import { ReportsNav } from "../reports-nav";
import { StatementControls } from "./controls";
import { periodText } from "./labels";
import { loadStatementsContext } from "./load";
import { buildNotes } from "./notes";
import { reviewDetail } from "./review-detail";
import { statementQuery } from "./params";
import { StatementTable, TrialBalanceTable } from "./statement-table";
import { ChecksStrip, EquityTable, NotesView, ReviewList, StatementsEmpty, VatTable } from "./views";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

export default async function FinancialStatementsPage({
  searchParams,
}: Readonly<{ searchParams: Promise<SearchParams> }>) {
  const { orgId } = await requireOrg();
  const t = await getTranslations("statements");
  const ctx = await loadStatementsContext(orgId, await searchParams);
  const { inputs, params, presets, years } = ctx;
  const { report, ledger, period, comparePeriod } = params;

  const header = (
    <>
      <PageHeader title={t("title")} />
      <ReportsNav active="statements" />
    </>
  );
  if (!ctx.hasData) {
    return (
      <>
        {header}
        <StatementsEmpty />
      </>
    );
  }

  const asOf = period.to;
  const checks = runChecks(inputs, ledger, asOf);
  const review = reviewItems(inputs, asOf).filter((r) => r.ledger === "both" || r.ledger === ledger);
  const reviewHref = `/dashboard/reports/statements?${statementQuery({ ...params, report: "review" })}`;
  const drill = { ledger, period };

  let body: React.ReactNode;
  switch (report) {
    case "bs": {
      const statement = balanceSheet(inputs, ledger, asOf, comparePeriod?.to ?? null);
      body = (
        <StatementTable
          title={t("reports.bs")}
          rows={statement.rows}
          currentLabel={t("table.asOf", { date: asOf })}
          compareLabel={comparePeriod ? t("table.asOf", { date: comparePeriod.to }) : null}
          drill={{ ledger, period: { from: fiscalYearStart(asOf, inputs.settings.fiscalYearStartMonth), to: asOf } }}
        />
      );
      break;
    }
    case "is":
    case "cf": {
      const fn = report === "is" ? incomeStatement : cashFlowStatement;
      const statement = fn(inputs, ledger, period, comparePeriod);
      body = (
        <StatementTable
          title={t(`reports.${report}`)}
          rows={statement.rows}
          currentLabel={periodText(period)}
          compareLabel={comparePeriod ? periodText(comparePeriod) : null}
          drill={drill}
        />
      );
      break;
    }
    case "eq":
      body = <EquityTable rows={equityChanges(inputs, ledger, period)} />;
      break;
    case "tb":
      body = <TrialBalanceTable rows={trialBalance(inputs, ledger, period)} drill={drill} />;
      break;
    case "vat":
      body = <VatTable rows={vatReport(inputs, params.year)} regime={inputs.settings.vatRegime} year={params.year} />;
      break;
    case "review":
      body = <ReviewList items={review} detail={(item) => reviewDetail(inputs, item)} />;
      break;
    case "notes":
      body = <NotesView data={buildNotes(inputs, buildLedger(inputs, { ledger, asOf }), ledger, asOf)} />;
      break;
  }

  return (
    <>
      {header}
      <StatementControls
        key={`${period.from}:${period.to}`}
        report={report}
        ledger={ledger}
        periodKey={params.periodKey}
        period={period}
        compare={params.compare}
        year={params.year}
        years={years}
        presets={presets}
      />
      <ChecksStrip checks={checks} reviewCount={review.length} reviewHref={reviewHref} />
      <p className="-mt-3 text-xs text-muted-foreground">{t(`ledgerNote.${ledger}`)}</p>
      {body}
    </>
  );
}

import { getTranslations } from "next-intl/server";
import { ArrowLeftRight } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { TableCard } from "@/components/table-card";
import { EmptyRow } from "@/components/empty-state";
import { DeleteButton } from "@/components/delete-button";
import { CurrencyFlag } from "@/components/currency-flag";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { countMissingAmountTwd, getAccountingSettings, listForeignCurrencies, listFxRates } from "@/db/ledger";
import { deleteFxRate } from "@/db/ledger-mutations";
import { formatDate } from "@/lib/format";
import { requireOrg } from "@/lib/session";
import { AccountingNav } from "../accounting-nav";
import { FillAmountTwdButton, ImportWiseRatesButton, PasteRatesButton } from "./fx-client";

export const dynamic = "force-dynamic";

export default async function FxRatesPage() {
  const t = await getTranslations("accounting");
  const { orgId } = await requireOrg();
  const settings = await getAccountingSettings(orgId);
  const base = settings.functionalCurrency;
  const [rates, missing, foreign] = await Promise.all([
    listFxRates(orgId),
    countMissingAmountTwd(orgId, base),
    listForeignCurrencies(orgId, base),
  ]);
  const currencies = [...new Set(rates.map((r) => r.currency))];

  return (
    <>
      <PageHeader title={t("title")}>
        <ImportWiseRatesButton currencies={foreign} />
        <FillAmountTwdButton missing={missing} />
        <PasteRatesButton currencies={currencies} functionalCurrency={base} />
      </PageHeader>
      <AccountingNav active="fx" />
      <p className="text-sm text-muted-foreground">
        {t("fx.description")}
        {missing > 0 ? <span className="ml-1 text-warning">{t("fx.fillHint", { count: missing })}</span> : null}
      </p>

      <TableCard title={t("fx.title")} action={t("fx.count", { count: rates.length })}>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-28">{t("fx.currency")}</TableHead>
                <TableHead className="w-32">{t("fx.date")}</TableHead>
                <TableHead className="text-right">{t("fx.rate", { base })}</TableHead>
                <TableHead>{t("fx.source")}</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rates.length === 0 ? (
                <EmptyRow colSpan={5} icon={ArrowLeftRight} message={t("fx.empty")} />
              ) : (
                rates.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell>
                      <span className="flex items-center gap-2 font-medium">
                        <CurrencyFlag currency={r.currency} />
                        {r.currency}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs tabular-nums">{formatDate(r.rateDate)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.rate.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 })}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {r.source === "manual" ? t("fx.sourceManual") : r.source === "wise" ? t("fx.sourceWise") : r.source}
                    </TableCell>
                    <TableCell className="text-right">
                      <DeleteButton
                        action={deleteFxRate}
                        id={r.id}
                        title={t("fx.deleteTitle")}
                        description={t("fx.deleteDescription")}
                      />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </TableCard>
    </>
  );
}

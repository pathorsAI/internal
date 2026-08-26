import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/page-header";
import { TableCard } from "@/components/table-card";
import { EmptyRow } from "@/components/empty-state";
import { signColor, txnTypeColor } from "@/components/amount";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  computeReceivableAging,
  listBillingBoard,
  listContractCoverage,
  listVendorCosts,
  listProjects,
  summarizeTaxPeriod,
} from "@/db/queries";
import { formatCurrency } from "@/lib/format";
import { requireOrg } from "@/lib/session";
import { cn } from "@/lib/utils";
import { shiftTaxPeriod, taxPeriodOf } from "@/lib/vat";
import { todayStr } from "@/lib/mcp/shared";
import { ReceivableAging } from "./receivable-aging";
import { TaxPeriodCard } from "./tax-period-card";
import { ContractCoverage } from "./contract-coverage";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  const t = await getTranslations("reports");
  const labelMap: Record<string, string> = {
    vendor: t("partyLabel.vendor"),
    customer: t("partyLabel.customer"),
    gov: t("partyLabel.gov"),
    other: t("partyLabel.other"),
  };
  const { orgId } = await requireOrg();
  // 稅期預設看當期；上一期常常還在申報中，一起帶出來比較有用。
  const current = taxPeriodOf(todayStr());
  const previous = shiftTaxPeriod(current, -1);

  // 三張新報表都建立在同一份看板資料上 —— 抓一次就好，數字也保證一致。
  const board = await listBillingBoard(orgId, { includeAllHistory: true });
  const [vendorCosts, projects, coverage, currentTax, previousTax] = await Promise.all([
    listVendorCosts(orgId),
    listProjects(orgId),
    listContractCoverage(orgId, board),
    summarizeTaxPeriod(orgId, board, current.start, current.end),
    summarizeTaxPeriod(orgId, board, previous.start, previous.end),
  ]);
  const aging = computeReceivableAging(board, todayStr());
  const totalVendorCost = vendorCosts.reduce((s, v) => s + v.total, 0);

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />

      <div className="grid gap-6">
        <ReceivableAging rows={aging} />

        <div className="grid gap-6 lg:grid-cols-2">
          <TaxPeriodCard period={current} summary={currentTax} highlight />
          <TaxPeriodCard period={previous} summary={previousTax} />
        </div>

        <ContractCoverage rows={coverage} />
        <TableCard
          title={t("vendorCosts.title")}
          action={t("vendorCosts.summary", { total: formatCurrency(totalVendorCost) })}
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("vendorCosts.columns.counterparty")}</TableHead>
                <TableHead>{t("vendorCosts.columns.type")}</TableHead>
                <TableHead className="text-right">{t("vendorCosts.columns.txnCount")}</TableHead>
                <TableHead className="text-right">{t("vendorCosts.columns.amount")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {vendorCosts.length === 0 ? (
                <EmptyRow colSpan={4} message={t("vendorCosts.empty")} />
              ) : (
                vendorCosts.map((v) => (
                  <TableRow key={v.partyId}>
                    <TableCell className="font-medium">{v.partyName}</TableCell>
                    <TableCell>
                      <Badge variant="outline">{labelMap[v.label] ?? v.label}</Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{v.txnCount}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {formatCurrency(v.total)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableCard>

        <TableCard title={t("projectPnl.title")} action={t("projectPnl.description")}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("projectPnl.columns.project")}</TableHead>
                <TableHead>{t("projectPnl.columns.client")}</TableHead>
                <TableHead className="text-right">{t("projectPnl.columns.income")}</TableHead>
                <TableHead className="text-right">{t("projectPnl.columns.expense")}</TableHead>
                <TableHead className="text-right">{t("projectPnl.columns.net")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {projects.length === 0 ? (
                <EmptyRow colSpan={5} message={t("projectPnl.empty")} />
              ) : (
                projects.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium">{p.name}</TableCell>
                    <TableCell className="text-muted-foreground">{p.clientName ?? "—"}</TableCell>
                    <TableCell className={cn("text-right tabular-nums", txnTypeColor("income"))}>
                      {formatCurrency(p.income)}
                    </TableCell>
                    <TableCell className={cn("text-right tabular-nums", txnTypeColor("expense"))}>
                      {formatCurrency(p.expense)}
                    </TableCell>
                    <TableCell
                      className={cn("text-right font-medium tabular-nums", signColor(p.net))}
                    >
                      {formatCurrency(p.net)}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableCard>
      </div>
    </>
  );
}

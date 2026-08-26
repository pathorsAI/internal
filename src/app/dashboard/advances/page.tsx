import { Info } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/page-header";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { EmptyRow } from "@/components/empty-state";
import { tableEdgePadding } from "@/components/table-card";
import { listOutstandingAdvances, listBankAccounts } from "@/db/queries";
import { formatCurrency, formatDate } from "@/lib/format";
import { RecordReimbursementDialog } from "./record-reimbursement-dialog";
import { requireOrg } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function AdvancesPage() {
  const t = await getTranslations("advances");
  const { orgId } = await requireOrg();
  const [rows, accounts] = await Promise.all([
    listOutstandingAdvances(orgId),
    listBankAccounts(orgId),
  ]);
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

      <Card>
        <CardHeader className="pb-2">
          <CardDescription>{t("card.totalLabel")}</CardDescription>
          <CardTitle className="text-2xl tabular-nums">{formatCurrency(total, "TWD")}</CardTitle>
        </CardHeader>
        <CardContent className={`p-0 ${tableEdgePadding}`}>
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
                    <TableCell className="text-muted-foreground">
                      {r.vendorName ?? "—"}
                      {r.description ? `(${r.description})` : ""}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{r.categoryName ?? "—"}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {formatCurrency(r.amount, r.currency ?? "TWD")}
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
                      />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}

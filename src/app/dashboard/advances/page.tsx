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
import { groupAccountsByEmployee, listEmployeeAccounts } from "@/db/employee-accounts";
import { summarizeOutstandingByPayee, type AdvancePayeeKind } from "@/lib/advance-payee";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

export default async function AdvancesPage() {
  const t = await getTranslations("advances");
  const { orgId } = await requireOrg();
  const [rows, accounts] = await Promise.all([
    listOutstandingAdvances(orgId),
    listBankAccounts(orgId),
  ]);
  // 只撈有未還代墊的員工的帳戶（遮罩後），給「匯入帳戶」下拉用；公司代墊沒有員工帳戶
  const settleIds = [
    ...new Set(
      rows
        .filter((r) => r.settleKind === "employee")
        .map((r) => r.settleEmployeeId)
        .filter((id): id is number => id != null),
    ),
  ];
  const accountsByEmployee = groupAccountsByEmployee(await listEmployeeAccounts(orgId, settleIds));
  const total = rows.reduce((s, r) => s + Number(r.amountTwd ?? r.amount ?? 0), 0);
  const accountOpts = accounts.map((a) => ({ id: a.id, name: a.name, currency: a.currency }));
  const byPayee = summarizeOutstandingByPayee(rows);

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

      {byPayee.length > 0 ? (
        <Card className="mb-4">
          <CardHeader className="pb-2">
            <CardDescription>{t("byPayee.title")}</CardDescription>
          </CardHeader>
          <CardContent className={`p-0 ${tableEdgePadding}`}>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("columns.payer")}</TableHead>
                  <TableHead className="text-right">{t("byPayee.count")}</TableHead>
                  <TableHead className="text-right">{t("columns.amount")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {byPayee.map((g) => (
                  <TableRow key={g.key}>
                    <TableCell className="font-medium">
                      <PayeeName kind={g.kind} name={g.name ?? t("byPayee.unassigned")} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">{g.count}</TableCell>
                    <TableCell className="text-right font-medium tabular-nums">
                      {g.totals.map((m) => formatCurrency(m.amount, m.currency)).join(" + ")}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}

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
                    <TableCell className="font-medium">
                      <PayeeName kind={r.settleKind} name={r.settleName ?? "—"} />
                    </TableCell>
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
                          settleKind: r.settleKind,
                          amount: r.amount ?? "0",
                          currency: r.currency ?? "TWD",
                          vendorName: r.vendorName ?? "",
                        }}
                        accounts={accountOpts}
                        employeeAccounts={(r.settleKind !== "employee" || r.settleEmployeeId == null
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
        </CardContent>
      </Card>
    </>
  );
}

/** 代墊人名稱；公司代墊加一個「公司」標籤，跟員工區分。 */
async function PayeeName({ kind, name }: Readonly<{ kind: AdvancePayeeKind | null; name: string }>) {
  const t = await getTranslations("advances");
  return (
    <span className="inline-flex items-center gap-1.5">
      {name}
      {kind === "party" ? (
        <Badge variant="secondary" className="font-normal">
          {t("companyBadge")}
        </Badge>
      ) : null}
    </span>
  );
}

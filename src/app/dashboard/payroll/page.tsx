import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Users } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { TableCard } from "@/components/table-card";
import { EmptyRow } from "@/components/empty-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { listPayslipRecords } from "@/db/queries";
import { formatCurrency, formatYearMonth } from "@/lib/format";
import { DeleteButton } from "@/components/delete-button";
import { deletePayslip } from "@/db/mutations";
import { requireOrg } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function PayrollPage() {
  const t = await getTranslations("payroll");
  const { orgId } = await requireOrg();
  const rows = await listPayslipRecords(orgId);

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("description")}
      >
        <Button size="sm" asChild>
          <Link href="/dashboard/employees">
            <Users className="size-4" /> {t("goToEmployees")}
          </Link>
        </Button>
      </PageHeader>

      <TableCard title={t("table.title")}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("table.columns.period")}</TableHead>
              <TableHead>{t("table.columns.employee")}</TableHead>
              <TableHead className="text-right">{t("table.columns.taxable")}</TableHead>
              <TableHead className="text-right">{t("table.columns.nontaxable")}</TableHead>
              <TableHead className="text-right">{t("table.columns.netPay")}</TableHead>
              <TableHead>{t("table.columns.transaction")}</TableHead>
              <TableHead className="text-right">{t("table.columns.actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <EmptyRow colSpan={7} message={t("table.empty")} />
            ) : (
              rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {formatYearMonth(r.periodYear, r.periodMonth)}
                  </TableCell>
                  <TableCell className="font-medium">{r.employeeName ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {formatCurrency(r.taxableTotal)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {formatCurrency(r.nontaxableTotal)}
                  </TableCell>
                  <TableCell className="text-right font-medium tabular-nums">
                    {formatCurrency(r.netPay)}
                  </TableCell>
                  <TableCell>
                    {r.paidTransactionId ? (
                      <Link href="/dashboard/transactions" className="text-xs text-primary hover:underline">
                        {t("table.posted")}
                      </Link>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <DeleteButton
                      action={deletePayslip}
                      id={r.id}
                      title={t("delete.title")}
                      description={t("delete.description")}
                    />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableCard>
    </>
  );
}

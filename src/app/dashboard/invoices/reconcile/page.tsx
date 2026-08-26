import Link from "next/link";
import { AlertTriangle, ArrowLeft } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/page-header";
import { TableCard } from "@/components/table-card";
import { EmptyRow } from "@/components/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { listIssuedInvoicesForReconcile, listMissingInvoices } from "@/db/queries";
import { formatCurrency, formatDate } from "@/lib/format";
import { requireOrg } from "@/lib/session";
import { SimpanyReconcile } from "./simpany-reconcile";

export const dynamic = "force-dynamic";

export default async function InvoiceReconcilePage() {
  const t = await getTranslations("invoices.reconcile");
  const { orgId } = await requireOrg();
  const [missing, issued] = await Promise.all([
    listMissingInvoices(orgId),
    listIssuedInvoicesForReconcile(orgId),
  ]);

  // 本系統認為已開（有號碼），但還沒被標記成 Simpany issued 的，也值得看一眼。
  const pending = issued.filter((i) => i.externalStatus === "pending" && i.status === "valid");

  return (
    <>
      <PageHeader title={t("title")} description={t("description")}>
        <Button asChild size="sm" variant="outline">
          <Link href="/dashboard/invoices">
            <ArrowLeft className="size-4" /> {t("back")}
          </Link>
        </Button>
      </PageHeader>

      <TableCard
        title={t("missing.title")}
        action={t("missing.count", { count: missing.length })}
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("missing.columns.customer")}</TableHead>
              <TableHead>{t("missing.columns.item")}</TableHead>
              <TableHead>{t("missing.columns.dueDate")}</TableHead>
              <TableHead className="text-right">{t("missing.columns.amount")}</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {missing.length === 0 ? (
              <EmptyRow colSpan={5} message={t("missing.empty.message")}>
                {t("missing.empty.hint")}
              </EmptyRow>
            ) : (
              missing.map((r) => (
                <TableRow key={r.key}>
                  <TableCell className="font-medium">{r.customerName ?? "—"}</TableCell>
                  <TableCell className="max-w-[26ch] truncate">{r.title}</TableCell>
                  <TableCell className="text-sm tabular-nums text-muted-foreground">
                    {r.billedOn ? formatDate(r.billedOn) : t("missing.notBilledYet")}
                  </TableCell>
                  <TableCell className="text-right text-sm tabular-nums">
                    {formatCurrency(r.amount, r.currency)}
                  </TableCell>
                  <TableCell>
                    <Button asChild size="sm" variant="ghost">
                      <Link href="/dashboard/billing?filter=invoice">{t("missing.goToBoard")}</Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableCard>

      <TableCard title={t("pending.title")} action={t("pending.count", { count: pending.length })}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("pending.columns.date")}</TableHead>
              <TableHead>{t("pending.columns.counterparty")}</TableHead>
              <TableHead>{t("pending.columns.invoiceNumber")}</TableHead>
              <TableHead className="text-right">{t("pending.columns.amountGross")}</TableHead>
              <TableHead>{t("pending.columns.simpany")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pending.length === 0 ? (
              <EmptyRow colSpan={5} message={t("pending.empty.message")}>
                {t("pending.empty.hint")}
              </EmptyRow>
            ) : (
              pending.map((inv) => (
                <TableRow key={inv.id}>
                  <TableCell className="text-sm tabular-nums">
                    {inv.invoiceDate ? formatDate(inv.invoiceDate) : "—"}
                  </TableCell>
                  <TableCell className="font-medium">{inv.displayName ?? "—"}</TableCell>
                  <TableCell className="text-sm tabular-nums text-muted-foreground">
                    {inv.invoiceNumber ?? t("pending.notNumberedYet")}
                  </TableCell>
                  <TableCell className="text-right text-sm tabular-nums">
                    {inv.amountGross == null ? "—" : formatCurrency(inv.amountGross, inv.currency)}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="border-expense/40 text-expense">
                      {t("pending.badge")}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableCard>

      <SimpanyReconcile
        local={issued.map((i) => ({
          id: i.id,
          invoiceNumber: i.invoiceNumber,
          externalRef: i.externalRef,
          invoiceDate: i.invoiceDate,
          amountGross: i.amountGross,
          displayName: i.displayName,
          status: i.status,
        }))}
      />

      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <AlertTriangle className="size-3.5" />
        {t("footerNote")}
      </p>
    </>
  );
}

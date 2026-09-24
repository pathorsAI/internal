import Link from "next/link";
import { Scale } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/page-header";
import { TableCard } from "@/components/table-card";
import { EmptyRow } from "@/components/empty-state";
import { RowDialog } from "@/components/row-dialog";
import { DeleteButton } from "@/components/delete-button";
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
import {
  listContracts,
  listInvoiceableBillingItems,
  listInvoicesDetailed,
  listParties,
} from "@/db/queries";
import { deleteInvoice } from "@/db/mutations";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/format";
import { canManageOrg, requireOrgWithRole } from "@/lib/session";
import { getIntegration } from "@/lib/integrations/store";
import type { IntegrationSummary } from "@/lib/integrations/types";
import { defaultSyncRange } from "@/lib/simpany-sync";
import { NewInvoiceDialog } from "./new-invoice-dialog";
import { EditInvoiceForm } from "./edit-invoice-form";
import { SimpanySyncSheet } from "./simpany-sync-sheet";

export const dynamic = "force-dynamic";

const statusVariant: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  valid: "secondary",
  void: "destructive",
  allowance: "outline",
};

async function ExternalStatusBadge({ status }: Readonly<{ status: string }>) {
  const t = await getTranslations("invoices.externalStatus");
  if (status === "n_a") return <span className="text-xs text-muted-foreground">—</span>;
  if (status === "pending") {
    return (
      <Badge variant="outline" className="border-expense/40 text-expense">
        {t("pending")}
      </Badge>
    );
  }
  const externalLabel: Record<string, string> = {
    pending: t("pending"),
    issued: t("issued"),
    void: t("void"),
  };
  return <Badge variant="outline">{externalLabel[status] ?? status}</Badge>;
}

const taxChipClass: Record<string, string> = {
  taxable: "text-muted-foreground",
  zero_rated: "border-sky-500/40 text-sky-700 dark:text-sky-400",
  exempt: "border-amber-500/40 text-amber-700 dark:text-amber-400",
};

/** 發票列的狀態格：課稅別 + 有效 / 作廢（作廢附原因）。 */
async function InvoiceStatusCell({
  status,
  taxTreatment,
  voidReason,
}: Readonly<{ status: string; taxTreatment: string; voidReason: string | null }>) {
  const t = await getTranslations("invoices");
  const taxLabel: Record<string, string> = {
    taxable: t("taxTreatment.taxable"),
    zero_rated: t("taxTreatment.zero_rated"),
    exempt: t("taxTreatment.exempt"),
  };
  const statusLabel: Record<string, string> = {
    valid: t("status.valid"),
    void: t("voidedChip"),
    allowance: t("status.allowance"),
  };
  return (
    <div className="flex max-w-[26ch] flex-col gap-1">
      <div className="flex flex-wrap gap-1">
        <Badge variant="outline" className={taxChipClass[taxTreatment] ?? ""}>
          {taxLabel[taxTreatment] ?? taxTreatment}
        </Badge>
        <Badge variant={statusVariant[status] ?? "outline"}>{statusLabel[status] ?? status}</Badge>
      </div>
      {status === "void" && voidReason ? (
        <span className="truncate text-xs text-muted-foreground" title={voidReason}>
          {t("voidReason", { reason: voidReason })}
        </span>
      ) : null}
    </div>
  );
}

/** 標題下方那行 Simpany 狀態：連接了才顯示。 */
async function SimpanyStatusLine({
  integration,
  canManage,
}: Readonly<{ integration: IntegrationSummary | null; canManage: boolean }>) {
  if (!integration) return null;
  const t = await getTranslations("invoices.simpany.status");
  const settings = (
    <Link href="/dashboard/settings/integrations" className="text-primary hover:underline">
      {t("settingsLink")}
    </Link>
  );
  let text: React.ReactNode;
  if (integration.status !== "connected") {
    text = (
      <span className="text-destructive">
        {t("needsReauth", { error: integration.lastError ?? "" })} · {settings}
      </span>
    );
  } else if (!integration.enabled) {
    text = (
      <>
        {t("off")} {settings}
      </>
    );
  } else {
    text = (
      <>
        {integration.lastSyncedAt
          ? t("lastSynced", { date: formatDateTime(integration.lastSyncedAt) })
          : t("neverSynced")}
        {canManage ? null : ` · ${t("readOnly")}`}
      </>
    );
  }
  return <p className="text-xs text-muted-foreground">{text}</p>;
}

export default async function InvoicesPage({
  searchParams,
}: Readonly<{ searchParams: Promise<{ direction?: string }> }>) {
  const t = await getTranslations("invoices");
  const directions = [
    { key: "issued" as const, label: t("direction.issued") },
    { key: "received" as const, label: t("direction.received") },
  ];
  const { orgId, role } = await requireOrgWithRole();
  const canManage = canManageOrg(role);
  const { direction: raw } = await searchParams;
  const direction = raw === "received" ? "received" : "issued";

  const [rows, parties, contracts, billingItems, simpany] = await Promise.all([
    listInvoicesDetailed(orgId, direction),
    listParties(orgId),
    listContracts(orgId),
    listInvoiceableBillingItems(orgId),
    getIntegration(orgId, "simpany"),
  ]);
  const simpanyUsable = Boolean(simpany?.enabled && simpany.status === "connected");
  const syncRange = defaultSyncRange();

  const partyOptions = parties.map((p) => ({ id: p.id, name: p.name }));
  const contractOptions = contracts.map((c) => ({ id: c.id, name: c.title }));
  const billingOptions = billingItems.map((b) => ({
    id: b.id,
    name: b.invoiced ? t("billingItemInvoiced", { name: b.name }) : b.name,
  }));

  return (
    <>
      <PageHeader title={t("title")} description={t("description")}>
        {simpanyUsable && canManage ? (
          <SimpanySyncSheet defaultStart={syncRange.startDate} defaultEnd={syncRange.endDate} />
        ) : null}
        <Button asChild size="sm" variant="outline">
          <Link href="/dashboard/invoices/reconcile">
            <Scale className="size-4" /> {t("reconcileLink")}
          </Link>
        </Button>
        <NewInvoiceDialog
          parties={partyOptions}
          contracts={contractOptions}
          billingItems={billingOptions}
        />
      </PageHeader>

      <SimpanyStatusLine integration={simpany} canManage={canManage} />

      <div className="flex gap-1">
        {directions.map((d) => (
          <Button
            key={d.key}
            asChild
            size="sm"
            variant={direction === d.key ? "default" : "outline"}
          >
            <Link href={`/dashboard/invoices?direction=${d.key}`}>{d.label}</Link>
          </Button>
        ))}
      </div>

      <TableCard action={t("rowCount", { count: rows.length })}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("columns.date")}</TableHead>
              <TableHead>{t("columns.counterparty")}</TableHead>
              <TableHead>{t("columns.invoiceNumber")}</TableHead>
              <TableHead className="text-right">{t("columns.amountGross")}</TableHead>
              <TableHead>{t("columns.billingRef")}</TableHead>
              <TableHead>{t("columns.simpany")}</TableHead>
              <TableHead>{t("columns.status")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <EmptyRow colSpan={7} message={t("empty.message")}>
                {t("empty.hint")}
              </EmptyRow>
            ) : (
              rows.map((inv) => (
                <RowDialog
                  key={inv.id}
                  rowId={inv.id}
                  title={inv.invoiceNumber ?? t("defaultTitle")}
                  description={inv.displayName ?? undefined}
                  cells={
                    <>
                      <TableCell className="text-sm tabular-nums">
                        {inv.invoiceDate ? formatDate(inv.invoiceDate) : "—"}
                      </TableCell>
                      <TableCell className="font-medium">{inv.displayName ?? "—"}</TableCell>
                      <TableCell className="text-sm tabular-nums text-muted-foreground">
                        {inv.invoiceNumber ?? "—"}
                      </TableCell>
                      <TableCell className="text-right text-sm tabular-nums">
                        {inv.amountGross == null
                          ? "—"
                          : formatCurrency(Number(inv.amountGross), inv.currency)}
                      </TableCell>
                      <TableCell className="max-w-[22ch] truncate text-xs text-muted-foreground">
                        {inv.billingItemTitle ?? inv.contractTitle ?? "—"}
                      </TableCell>
                      <TableCell>
                        <ExternalStatusBadge status={inv.externalStatus} />
                      </TableCell>
                      <TableCell>
                        <InvoiceStatusCell
                          status={inv.status}
                          taxTreatment={inv.taxTreatment}
                          voidReason={inv.voidReason}
                        />
                      </TableCell>
                    </>
                  }
                >
                  <EditInvoiceForm
                    id={inv.id}
                    values={{
                      direction: inv.direction,
                      invoiceNumber: inv.invoiceNumber,
                      invoiceDate: inv.invoiceDate,
                      partyId: inv.partyId,
                      partyName: inv.partyName ?? inv.counterpartyName,
                      counterpartyName: inv.counterpartyName,
                      counterpartyTaxId: inv.counterpartyTaxId,
                      amountNet: inv.amountNet,
                      tax: inv.tax,
                      amountGross: inv.amountGross,
                      currency: inv.currency,
                      status: inv.status,
                      note: inv.note,
                      contractId: inv.contractId,
                      billingItemId: inv.billingItemId,
                      externalStatus: inv.externalStatus,
                    }}
                    parties={partyOptions}
                    contracts={contractOptions}
                    billingItems={billingOptions}
                    footer={<DeleteButton action={deleteInvoice} id={inv.id} />}
                  />
                </RowDialog>
              ))
            )}
          </TableBody>
        </Table>
      </TableCard>
    </>
  );
}

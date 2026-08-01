import Link from "next/link";
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
import { formatCurrency, formatDate } from "@/lib/format";
import { requireOrg } from "@/lib/session";
import { NewInvoiceDialog } from "./new-invoice-dialog";
import { EditInvoiceForm } from "./edit-invoice-form";

export const dynamic = "force-dynamic";

const statusLabel: Record<string, string> = {
  valid: "有效",
  void: "作廢",
  allowance: "折讓",
};
const statusVariant: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  valid: "secondary",
  void: "destructive",
  allowance: "outline",
};

const directions = [
  { key: "issued" as const, label: "開給客戶" },
  { key: "received" as const, label: "廠商開給我" },
];

export default async function InvoicesPage({
  searchParams,
}: Readonly<{ searchParams: Promise<{ direction?: string }> }>) {
  const { orgId } = await requireOrg();
  const { direction: raw } = await searchParams;
  const direction = raw === "received" ? "received" : "issued";

  const [rows, parties, contracts, billingItems] = await Promise.all([
    listInvoicesDetailed(orgId, direction),
    listParties(orgId),
    listContracts(orgId),
    listInvoiceableBillingItems(orgId),
  ]);

  const partyOptions = parties.map((p) => ({ id: p.id, name: p.name }));
  const contractOptions = contracts.map((c) => ({ id: c.id, name: c.title }));
  const billingOptions = billingItems.map((b) => ({
    id: b.id,
    name: b.invoiced ? `${b.name}（已開）` : b.name,
  }));

  return (
    <>
      <PageHeader title="發票" description="開給客戶與廠商開給我的發票，點列可編輯">
        <NewInvoiceDialog
          parties={partyOptions}
          contracts={contractOptions}
          billingItems={billingOptions}
        />
      </PageHeader>

      <div className="flex gap-1">
        {directions.map((d) => (
          <Button
            key={d.key}
            asChild
            size="sm"
            variant={direction === d.key ? "default" : "outline"}
          >
            <Link href={`/invoices?direction=${d.key}`}>{d.label}</Link>
          </Button>
        ))}
      </div>

      <TableCard action={`${rows.length} 筆`}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>日期</TableHead>
              <TableHead>對象</TableHead>
              <TableHead>發票號碼</TableHead>
              <TableHead className="text-right">含稅金額</TableHead>
              <TableHead>對應請款</TableHead>
              <TableHead>狀態</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <EmptyRow colSpan={6} message="尚無發票">
                點右上角新增
              </EmptyRow>
            ) : (
              rows.map((inv) => (
                <RowDialog
                  key={inv.id}
                  title={inv.invoiceNumber ?? "發票"}
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
                        <Badge variant={statusVariant[inv.status] ?? "outline"}>
                          {statusLabel[inv.status] ?? inv.status}
                        </Badge>
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

import Link from "next/link";
import { AlertTriangle, ArrowLeft } from "lucide-react";
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
  const { orgId } = await requireOrg();
  const [missing, issued] = await Promise.all([
    listMissingInvoices(orgId),
    listIssuedInvoicesForReconcile(orgId),
  ]);

  // 本系統認為已開（有號碼），但還沒被標記成 Simpany issued 的，也值得看一眼。
  const pending = issued.filter((i) => i.externalStatus === "pending" && i.status === "valid");

  return (
    <>
      <PageHeader title="Simpany 對帳" description="本系統該開的發票，與 Simpany 實際開的對得起來嗎">
        <Button asChild size="sm" variant="outline">
          <Link href="/invoices">
            <ArrowLeft className="size-4" /> 回發票
          </Link>
        </Button>
      </PageHeader>

      <TableCard
        title="該開未開"
        action={`${missing.length} 筆`}
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>客戶</TableHead>
              <TableHead>項目</TableHead>
              <TableHead>請款日</TableHead>
              <TableHead className="text-right">金額</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {missing.length === 0 ? (
              <EmptyRow colSpan={5} message="沒有欠著的發票">
                已請款的項目都有對應發票了
              </EmptyRow>
            ) : (
              missing.map((r) => (
                <TableRow key={r.key}>
                  <TableCell className="font-medium">{r.customerName ?? "—"}</TableCell>
                  <TableCell className="max-w-[26ch] truncate">{r.title}</TableCell>
                  <TableCell className="text-sm tabular-nums text-muted-foreground">
                    {r.billedOn ? formatDate(r.billedOn) : "尚未請款"}
                  </TableCell>
                  <TableCell className="text-right text-sm tabular-nums">
                    {formatCurrency(r.amount, r.currency)}
                  </TableCell>
                  <TableCell>
                    <Button asChild size="sm" variant="ghost">
                      <Link href="/billing?filter=invoice">到看板開票</Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableCard>

      <TableCard title="本系統已建、Simpany 待確認" action={`${pending.length} 筆`}>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>日期</TableHead>
              <TableHead>對象</TableHead>
              <TableHead>發票號碼</TableHead>
              <TableHead className="text-right">含稅金額</TableHead>
              <TableHead>Simpany</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {pending.length === 0 ? (
              <EmptyRow colSpan={5} message="沒有待確認的發票">
                建立的發票都已經標記為 Simpany 已開立
              </EmptyRow>
            ) : (
              pending.map((inv) => (
                <TableRow key={inv.id}>
                  <TableCell className="text-sm tabular-nums">
                    {inv.invoiceDate ? formatDate(inv.invoiceDate) : "—"}
                  </TableCell>
                  <TableCell className="font-medium">{inv.displayName ?? "—"}</TableCell>
                  <TableCell className="text-sm tabular-nums text-muted-foreground">
                    {inv.invoiceNumber ?? "尚未取號"}
                  </TableCell>
                  <TableCell className="text-right text-sm tabular-nums">
                    {inv.amountGross == null ? "—" : formatCurrency(inv.amountGross, inv.currency)}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="border-expense/40 text-expense">
                      待開立
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
        Simpany 才是發票的真相來源。本系統只負責「該開什麼」與「開了沒」，兩邊不一致時以 Simpany 為準，回來這裡修正紀錄。
      </p>
    </>
  );
}

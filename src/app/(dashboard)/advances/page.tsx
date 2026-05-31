import { Info } from "lucide-react";
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
import { listOutstandingAdvances, listBankAccounts } from "@/db/queries";
import { formatCurrency, formatDate } from "@/lib/format";
import { RecordReimbursementDialog } from "./record-reimbursement-dialog";

export const dynamic = "force-dynamic";

export default async function AdvancesPage() {
  const [rows, accounts] = await Promise.all([listOutstandingAdvances(), listBankAccounts()]);
  const total = rows.reduce((s, r) => s + Number(r.amountTwd ?? r.amount ?? 0), 0);
  const accountOpts = accounts.map((a) => ({ id: a.id, name: a.name, currency: a.currency }));

  return (
    <>
      <PageHeader
        title={
          <span className="inline-flex items-center gap-1.5">
            代墊
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      className="text-muted-foreground hover:text-foreground"
                      aria-label="代墊說明"
                    />
                  }
                >
                  <Info className="size-4" />
                </TooltipTrigger>
                <TooltipContent>員工已代墊並納入帳務（進項），公司尚未撥款</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </span>
        }
        description="員工先付、公司尚未撥款的費用"
      />

      <Card>
        <CardHeader className="pb-2">
          <CardDescription>目前未還總額</CardDescription>
          <CardTitle className="text-2xl tabular-nums">{formatCurrency(total, "TWD")}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>日期</TableHead>
                <TableHead>代墊人</TableHead>
                <TableHead>廠商 / 用途</TableHead>
                <TableHead>分類</TableHead>
                <TableHead className="text-right">金額</TableHead>
                <TableHead className="text-right">動作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">
                    沒有未還的代墊
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {formatDate(r.txnDate)}
                    </TableCell>
                    <TableCell className="font-medium">{r.settleName ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {r.vendorName ?? "—"}
                      {r.description ? `（${r.description}）` : ""}
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

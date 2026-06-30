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
import { listVendorCosts, listProjects } from "@/db/queries";
import { formatCurrency } from "@/lib/format";
import { requireOrg } from "@/lib/session";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const labelMap: Record<string, string> = {
  vendor: "廠商",
  customer: "客戶",
  gov: "政府機關",
  other: "其他",
};

export default async function ReportsPage() {
  const { orgId } = await requireOrg();
  const [vendorCosts, projects] = await Promise.all([listVendorCosts(orgId), listProjects(orgId)]);
  const totalVendorCost = vendorCosts.reduce((s, v) => s + v.total, 0);

  return (
    <>
      <PageHeader title="報表" description="廠商 / infra 成本與各專案損益" />

      <div className="grid gap-6">
        <TableCard
          title="廠商 / infra 成本"
          action={`依交易對象彙總的支出（含代墊，TWD）— 合計 ${formatCurrency(totalVendorCost)}`}
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>交易對象</TableHead>
                <TableHead>類型</TableHead>
                <TableHead className="text-right">交易數</TableHead>
                <TableHead className="text-right">支出 (TWD)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {vendorCosts.length === 0 ? (
                <EmptyRow colSpan={4} message="尚無支出資料" />
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

        <TableCard title="專案損益 (P&L)" action="每個專案的收入、支出與淨額（TWD）">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>專案</TableHead>
                <TableHead>客戶</TableHead>
                <TableHead className="text-right">收入</TableHead>
                <TableHead className="text-right">支出</TableHead>
                <TableHead className="text-right">淨額</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {projects.length === 0 ? (
                <EmptyRow colSpan={5} message="尚無專案" />
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

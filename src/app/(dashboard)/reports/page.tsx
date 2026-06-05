import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
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
        <Card>
          <CardHeader>
            <CardTitle>廠商 / infra 成本</CardTitle>
            <CardDescription>
              依交易對象彙總的支出（含代墊，TWD）— 合計 {formatCurrency(totalVendorCost)}
            </CardDescription>
          </CardHeader>
          <CardContent className="px-0">
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
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground">
                      尚無支出資料
                    </TableCell>
                  </TableRow>
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
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>專案損益 (P&L)</CardTitle>
            <CardDescription>每個專案的收入、支出與淨額（TWD）</CardDescription>
          </CardHeader>
          <CardContent className="px-0">
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
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground">
                      尚無專案
                    </TableCell>
                  </TableRow>
                ) : (
                  projects.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell className="font-medium">{p.name}</TableCell>
                      <TableCell className="text-muted-foreground">{p.clientName ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums text-emerald-600">
                        {formatCurrency(p.income)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-rose-600">
                        {formatCurrency(p.expense)}
                      </TableCell>
                      <TableCell
                        className={`text-right font-medium tabular-nums ${p.net < 0 ? "text-rose-600" : ""}`}
                      >
                        {formatCurrency(p.net)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

import { EmptyRow } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { TableCard } from "@/components/table-card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { listActivity } from "@/db/queries";
import { formatDateTime } from "@/lib/format";
import { requireOrg } from "@/lib/session";

export const dynamic = "force-dynamic";

const actionLabel: Record<string, string> = {
  create: "新增",
  update: "修改",
  delete: "刪除",
  read: "讀取",
};
const actionVariant: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  create: "secondary",
  update: "outline",
  delete: "destructive",
  read: "outline",
};
const entityLabel: Record<string, string> = {
  transaction: "交易",
  party: "交易對象",
  category: "分類",
  bank_account: "銀行帳戶",
  employee: "員工",
  invoice: "發票",
  reconciliation: "對帳",
  project: "專案",
  subscription: "訂閱",
  contract: "合約",
  billing_item: "請款項目",
  document: "憑證",
  payroll_run: "薪資批次",
  payslip: "薪資單",
};

export default async function ActivityPage() {
  const { orgId } = await requireOrg();
  const rows = await listActivity(orgId, { limit: 300 });

  return (
    <>
      <PageHeader
        title="操作紀錄"
        description="誰在什麼時候新增 / 修改 / 刪除了哪筆資料（含透過 MCP 的操作），用來追查亂紀錄或亂刪除"
      />
      <TableCard>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>時間</TableHead>
              <TableHead>操作人</TableHead>
              <TableHead>來源</TableHead>
              <TableHead>動作</TableHead>
              <TableHead>對象</TableHead>
              <TableHead>說明</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <EmptyRow colSpan={6} message="尚無操作紀錄" />
            ) : (
              rows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {formatDateTime(r.createdAt)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {r.actorName ?? r.actorEmail ?? "—"}
                  </TableCell>
                  <TableCell>
                    {r.channel === "mcp" ? (
                      <Badge variant="secondary">MCP</Badge>
                    ) : (
                      <span className="text-muted-foreground">網頁</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={actionVariant[r.action] ?? "outline"}>
                      {actionLabel[r.action] ?? r.action}
                    </Badge>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {entityLabel[r.entityType] ?? r.entityType}
                    {r.entityId != null ? ` #${r.entityId}` : ""}
                  </TableCell>
                  <TableCell className="max-w-[28ch] truncate text-muted-foreground" title={r.summary ?? ""}>
                    {r.summary ?? "—"}
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

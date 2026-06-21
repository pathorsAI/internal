import { RowDialog } from "@/components/row-dialog";
import { DeleteButton } from "@/components/delete-button";
import { deleteContract } from "@/db/mutations";
import { EditContractForm } from "./edit-contract-form";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { listContracts, listParties, listProjects } from "@/db/queries";
import { formatCurrency, formatDate } from "@/lib/format";
import { NewContractDialog } from "./new-contract-dialog";
import { ContractFileLink } from "./contract-file-link";
import { requireOrg } from "@/lib/session";

export const dynamic = "force-dynamic";

const statusMap: Record<string, string> = {
  draft: "草稿",
  active: "進行中",
  completed: "已完成",
  cancelled: "已取消",
};
const statusVariant: Record<string, "default" | "secondary" | "outline"> = {
  draft: "outline",
  active: "default",
  completed: "secondary",
  cancelled: "outline",
};

export default async function ContractsPage() {
  const { orgId } = await requireOrg();
  const [rows, parties, projects] = await Promise.all([
    listContracts(orgId),
    listParties(orgId),
    listProjects(orgId),
  ]);
  const partyOptions = parties.map((p) => ({ id: p.id, name: p.name }));
  const projectOptions = projects.map((p) => ({ id: p.id, name: p.name }));

  return (
    <>
      <PageHeader title="合約" description="客戶合約，點列可編輯">
        <NewContractDialog parties={partyOptions} projects={projectOptions} />
      </PageHeader>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>合約</TableHead>
              <TableHead>客戶</TableHead>
              <TableHead>專案</TableHead>
              <TableHead className="text-right">金額</TableHead>
              <TableHead>期間</TableHead>
              <TableHead>狀態</TableHead>
              <TableHead>檔案</TableHead>
              <TableHead className="text-right">動作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-muted-foreground">
                  尚無合約，點右上角新增
                </TableCell>
              </TableRow>
            ) : (
              rows.map((c) => (
                <RowDialog
                  key={c.id}
                  title={c.title}
                  description="合約"
                  cells={
                    <>
                      <TableCell className="font-medium">{c.title}</TableCell>
                      <TableCell>{c.customerName ?? "—"}</TableCell>
                      <TableCell className="text-muted-foreground">{c.projectName ?? "—"}</TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {c.amount == null ? "—" : formatCurrency(c.amount, c.currency)}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {c.startDate ? formatDate(c.startDate) : "—"}
                        {c.endDate ? ` ~ ${formatDate(c.endDate)}` : ""}
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusVariant[c.status] ?? "outline"}>
                          {statusMap[c.status] ?? c.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {c.fileUrl ? (
                          <ContractFileLink url={c.fileUrl} />
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <DeleteButton action={deleteContract} id={c.id} />
                      </TableCell>
                    </>
                  }
                >
                  <EditContractForm
                    contract={{
                      id: c.id,
                      customerPartyId: c.customerPartyId,
                      projectId: c.projectId,
                      title: c.title,
                      amount: c.amount,
                      currency: c.currency,
                      startDate: c.startDate,
                      endDate: c.endDate,
                      status: c.status,
                      note: c.note,
                      fileUrl: c.fileUrl,
                    }}
                    parties={partyOptions}
                    projects={projectOptions}
                  />
                </RowDialog>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}

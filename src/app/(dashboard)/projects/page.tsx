import { RowDialog } from "@/components/row-dialog";
import { DeleteButton } from "@/components/delete-button";
import { deleteProject } from "@/db/mutations";
import { EditProjectForm } from "./edit-project-form";
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
import { listProjects, listParties } from "@/db/queries";
import { formatCurrency } from "@/lib/format";
import { NewProjectDialog } from "./new-project-dialog";
import { requireOrg } from "@/lib/session";

export const dynamic = "force-dynamic";

const statusMap: Record<string, string> = { active: "進行中", archived: "封存" };

export default async function ProjectsPage() {
  const { orgId } = await requireOrg();
  const [rows, parties] = await Promise.all([listProjects(orgId), listParties(orgId)]);
  const partyOptions = parties.map((p) => ({ id: p.id, name: p.name }));

  return (
    <>
      <PageHeader title="專案" description="每個專案的收支由交易上的「專案」欄位彙總（P&L）">
        <NewProjectDialog parties={partyOptions} />
      </PageHeader>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>專案</TableHead>
              <TableHead>客戶</TableHead>
              <TableHead>狀態</TableHead>
              <TableHead className="text-right">收入</TableHead>
              <TableHead className="text-right">支出</TableHead>
              <TableHead className="text-right">淨額</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground">
                  尚無專案，點右上角新增
                </TableCell>
              </TableRow>
            ) : (
              rows.map((p) => (
                <RowDialog
                  key={p.id}
                  title={p.name}
                  description="專案"
                  cells={
                    <>
                      <TableCell className="font-medium">{p.name}</TableCell>
                      <TableCell className="text-muted-foreground">{p.clientName ?? "—"}</TableCell>
                      <TableCell>
                        <Badge variant={p.status === "active" ? "default" : "outline"}>
                          {statusMap[p.status] ?? p.status}
                        </Badge>
                      </TableCell>
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
                    </>
                  }
                >
                  <EditProjectForm
                    project={{
                      id: p.id,
                      name: p.name,
                      clientPartyId: p.clientPartyId,
                      status: p.status,
                      description: p.description,
                    }}
                    parties={partyOptions}
                    footer={<DeleteButton action={deleteProject} id={p.id} />}
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

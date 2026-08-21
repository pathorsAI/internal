import { RowDialog } from "@/components/row-dialog";
import { DeleteButton } from "@/components/delete-button";
import { deleteProject } from "@/db/mutations";
import { EditProjectForm } from "./edit-project-form";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { TableCard } from "@/components/table-card";
import { EmptyRow } from "@/components/empty-state";
import { signColor, txnTypeColor } from "@/components/amount";
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
import { cn } from "@/lib/utils";
import { NewProjectDialog } from "./new-project-dialog";
import { requireOrg } from "@/lib/session";

export const dynamic = "force-dynamic";

const statusMap: Record<string, string> = { active: "進行中", archived: "封存" };
const statusVariant: Record<string, "default" | "secondary" | "outline"> = {
  active: "default",
  archived: "secondary",
};

export default async function ProjectsPage() {
  const { orgId } = await requireOrg();
  const [rows, parties] = await Promise.all([listProjects(orgId), listParties(orgId)]);
  const partyOptions = parties.map((p) => ({ id: p.id, name: p.name }));

  return (
    <>
      <PageHeader title="專案" description="每個專案的收支由交易上的「專案」欄位彙總（P&L）">
        <NewProjectDialog parties={partyOptions} />
      </PageHeader>

      <TableCard>
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
              <EmptyRow colSpan={6} message="尚無專案，點右上角新增" />
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
                        <Badge variant={statusVariant[p.status] ?? "outline"}>
                          {statusMap[p.status] ?? p.status}
                        </Badge>
                      </TableCell>
                      <TableCell className={cn("text-right tabular-nums", signColor(p.income))}>
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
                    </>
                  }
                >
                  <EditProjectForm
                    project={{
                      id: p.id,
                      name: p.name,
                      clientPartyId: p.clientPartyId,
                      clientName: p.clientName,
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
      </TableCard>
    </>
  );
}

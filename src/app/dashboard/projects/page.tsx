import { getTranslations } from "next-intl/server";
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

const statusVariant: Record<string, "default" | "secondary" | "outline"> = {
  active: "default",
  archived: "secondary",
};

export default async function ProjectsPage() {
  const { orgId } = await requireOrg();
  const t = await getTranslations("projects");
  const [rows, parties] = await Promise.all([listProjects(orgId), listParties(orgId)]);
  const partyOptions = parties.map((p) => ({ id: p.id, name: p.name }));
  const statusLabels: Record<string, string> = {
    active: t("status.active"),
    archived: t("status.archived"),
  };

  return (
    <>
      <PageHeader title={t("list.title")} description={t("list.description")}>
        <NewProjectDialog parties={partyOptions} />
      </PageHeader>

      <TableCard>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("list.columns.project")}</TableHead>
              <TableHead>{t("list.columns.customer")}</TableHead>
              <TableHead>{t("list.columns.status")}</TableHead>
              <TableHead className="text-right">{t("list.columns.income")}</TableHead>
              <TableHead className="text-right">{t("list.columns.expense")}</TableHead>
              <TableHead className="text-right">{t("list.columns.net")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <EmptyRow colSpan={6} message={t("list.empty")} />
            ) : (
              rows.map((p) => (
                <RowDialog
                  key={p.id}
                  title={p.name}
                  description={t("list.rowDescription")}
                  cells={
                    <>
                      <TableCell className="font-medium">{p.name}</TableCell>
                      <TableCell className="text-muted-foreground">{p.clientName ?? "—"}</TableCell>
                      <TableCell>
                        <Badge variant={statusVariant[p.status] ?? "outline"}>
                          {statusLabels[p.status] ?? p.status}
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

import { getTranslations } from "next-intl/server";
import { RowDialog } from "@/components/row-dialog";
import { DeleteButton } from "@/components/delete-button";
import { deleteProject } from "@/db/mutations";
import { EditProjectForm } from "./edit-project-form";
import { PageHeader } from "@/components/page-header";
import { StatusTag } from "@/components/ds/status-dot";
import { TableCard } from "@/components/table-card";
import { EmptyRow } from "@/components/empty-state";
import { Amount } from "@/components/amount";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { listProjects, listParties } from "@/db/queries";
import { cn } from "@/lib/utils";
import { NewProjectDialog } from "./new-project-dialog";
import { requireOrg } from "@/lib/session";

export const dynamic = "force-dynamic";

const statusTone: Record<string, "neutral" | "primary"> = {
  active: "primary",
  archived: "neutral",
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
                  rowId={p.id}
                  title={p.name}
                  description={t("list.rowDescription")}
                  cells={
                    <>
                      <TableCell className="font-medium">{p.name}</TableCell>
                      <TableCell className="text-muted-foreground">{p.clientName ?? "—"}</TableCell>
                      <TableCell>
                        <StatusTag tone={statusTone[p.status] ?? "neutral"}>
                          {statusLabels[p.status] ?? p.status}
                        </StatusTag>
                      </TableCell>
                      <TableCell className="text-right">
                        <Amount value={p.income} kind="income" />
                      </TableCell>
                      <TableCell className="text-right">
                        <Amount value={p.expense} kind="expense" />
                      </TableCell>
                      <TableCell className="text-right">
                        {/* 淨額為負（虧損）是要人看的，用 destructive；正的照收入綠 */}
                        <Amount
                          value={p.net}
                          className={cn("font-medium", Number(p.net) < 0 && "text-destructive")}
                        />
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

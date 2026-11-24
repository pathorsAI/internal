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
import { listProjects, listParties, listUnassignedContracts } from "@/db/queries";
import type { DerivedProjectStatus } from "@/lib/linking/project-status";
import { cn } from "@/lib/utils";
import { NewProjectDialog } from "./new-project-dialog";
import { ArchiveProjectButton, AssignContractProjectForm } from "./project-actions";
import { requireOrg } from "@/lib/session";

export const dynamic = "force-dynamic";

// 顯示的是推導狀態（合約與訂閱決定），projects.status 只剩封存這個手動 override
const statusTone: Record<DerivedProjectStatus, "neutral" | "primary" | "income"> = {
  active: "primary",
  completed: "income",
  empty: "neutral",
  archived: "neutral",
};

const contractTone: Record<string, "neutral" | "primary" | "income"> = {
  draft: "neutral",
  active: "primary",
  completed: "income",
  cancelled: "neutral",
};

export default async function ProjectsPage() {
  const { orgId } = await requireOrg();
  const t = await getTranslations("projects");
  const tContracts = await getTranslations("contracts");
  const [rows, parties, unassigned] = await Promise.all([
    listProjects(orgId),
    listParties(orgId),
    listUnassignedContracts(orgId),
  ]);
  const partyOptions = parties.map((p) => ({ id: p.id, name: p.name }));
  const projectOptions = rows.map((p) => ({ id: p.id, name: p.name, status: p.derivedStatus }));
  const statusLabels: Record<DerivedProjectStatus, string> = {
    active: t("derivedStatus.active"),
    completed: t("derivedStatus.completed"),
    empty: t("derivedStatus.empty"),
    archived: t("derivedStatus.archived"),
  };
  const contractStatusLabels: Record<string, string> = {
    draft: tContracts("status.draft"),
    active: tContracts("status.active"),
    completed: tContracts("status.completed"),
    cancelled: tContracts("status.cancelled"),
  };

  return (
    <>
      <PageHeader title={t("list.title")}>
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
                      <TableCell>
                        <div className="font-medium">{p.name}</div>
                        {p.contractCount + p.subscriptionCount > 0 ? (
                          <div className="text-xs text-muted-foreground">
                            {t("list.children", {
                              contracts: p.contractCount,
                              subscriptions: p.subscriptionCount,
                            })}
                          </div>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{p.clientName ?? "—"}</TableCell>
                      <TableCell>
                        <div className="flex flex-col items-start gap-1.5">
                          <StatusTag tone={statusTone[p.derivedStatus]}>
                            {statusLabels[p.derivedStatus]}
                          </StatusTag>
                          {p.readyToClose ? (
                            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                              <span>{t("readyToClose.hint")}</span>
                              <ArchiveProjectButton id={p.id} name={p.name} />
                            </div>
                          ) : null}
                        </div>
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

      {/* 既有沒歸專案的合約不自動指派：列出來讓人逐筆決定 */}
      {unassigned.length > 0 ? (
        <TableCard
          title={t("unassigned.title")}
          action={t("unassigned.count", { count: unassigned.length })}
        >
          <p className="border-b px-4 py-2.5 text-xs text-muted-foreground">
            {t("unassigned.description")}
          </p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("unassigned.columns.contract")}</TableHead>
                <TableHead>{t("unassigned.columns.customer")}</TableHead>
                <TableHead>{t("unassigned.columns.status")}</TableHead>
                <TableHead className="text-right">{t("unassigned.columns.amount")}</TableHead>
                <TableHead>{t("unassigned.columns.project")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {unassigned.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.title}</TableCell>
                  <TableCell className="text-muted-foreground">{c.customerName ?? "—"}</TableCell>
                  <TableCell>
                    <StatusTag tone={contractTone[c.status] ?? "neutral"}>
                      {contractStatusLabels[c.status] ?? c.status}
                    </StatusTag>
                  </TableCell>
                  <TableCell className="text-right">
                    {c.amount == null ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <Amount value={c.amount} currency={c.currency} kind="neutral" />
                    )}
                  </TableCell>
                  <TableCell>
                    <AssignContractProjectForm contractId={c.id} projects={projectOptions} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableCard>
      ) : null}
    </>
  );
}

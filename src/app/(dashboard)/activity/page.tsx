import { getTranslations } from "next-intl/server";
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

const actionVariant: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  create: "secondary",
  update: "outline",
  delete: "destructive",
  read: "outline",
};

export default async function ActivityPage() {
  const t = await getTranslations("activity");
  const actionLabel: Record<string, string> = {
    create: t("action.create"),
    update: t("action.update"),
    delete: t("action.delete"),
    read: t("action.read"),
  };
  const entityLabel: Record<string, string> = {
    transaction: t("entity.transaction"),
    party: t("entity.party"),
    category: t("entity.category"),
    bank_account: t("entity.bank_account"),
    employee: t("entity.employee"),
    invoice: t("entity.invoice"),
    reconciliation: t("entity.reconciliation"),
    project: t("entity.project"),
    subscription: t("entity.subscription"),
    contract: t("entity.contract"),
    billing_item: t("entity.billing_item"),
    document: t("entity.document"),
    payroll_run: t("entity.payroll_run"),
    payslip: t("entity.payslip"),
  };
  const { orgId } = await requireOrg();
  const rows = await listActivity(orgId, { limit: 300 });

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("description")}
      />
      <TableCard>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("columns.time")}</TableHead>
              <TableHead>{t("columns.actor")}</TableHead>
              <TableHead>{t("columns.source")}</TableHead>
              <TableHead>{t("columns.action")}</TableHead>
              <TableHead>{t("columns.entity")}</TableHead>
              <TableHead>{t("columns.summary")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <EmptyRow colSpan={6} message={t("empty")} />
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
                      <Badge variant="secondary">{t("source.mcp")}</Badge>
                    ) : (
                      <span className="text-muted-foreground">{t("source.web")}</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge variant={actionVariant[r.action] ?? "outline"}>
                      {actionLabel[r.action] ?? r.action}
                    </Badge>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {entityLabel[r.entityType] ?? r.entityType}
                    {r.entityId == null ? "" : ` #${r.entityId}`}
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

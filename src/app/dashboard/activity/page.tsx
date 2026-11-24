import { getTranslations } from "next-intl/server";
import { EmptyRow } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { TableCard } from "@/components/table-card";
import { StatusTag } from "@/components/ds/status-dot";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { activityActorImages, listActivity } from "@/db/queries";
import { PartyAvatar } from "@/components/party-avatar";
import { formatDateTime } from "@/lib/format";
import { requireOrg } from "@/lib/session";

export const dynamic = "force-dynamic";

const actionTone: Record<string, "neutral" | "primary" | "income" | "risk"> = {
  create: "income",
  update: "primary",
  delete: "risk",
  read: "neutral",
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
    integration: t("entity.integration"),
    api_key: t("entity.api_key"),
    tool: t("entity.tool"),
    organization: t("entity.organization"),
  };
  const { orgId } = await requireOrg();
  const rows = await listActivity(orgId, { limit: 300 });
  const actorImages = await activityActorImages(
    orgId,
    rows.map((r) => r.id),
  );

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
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground tabular-nums">
                    {formatDateTime(r.createdAt)}
                  </TableCell>
                  <TableCell className="whitespace-nowrap font-medium">
                    <ActorCell
                      name={r.actorName ?? r.actorEmail}
                      image={actorImages.get(r.id) ?? null}
                      fallback={r.channel === "system" ? t("systemActor") : "—"}
                    />
                  </TableCell>
                  <TableCell>
                    {r.channel === "mcp" || r.channel === "ai" || r.channel === "system" || r.channel === "api" ? (
                      <StatusTag tone={r.channel === "system" ? "neutral" : "primary"}>
                        {t(`source.${r.channel}`)}
                      </StatusTag>
                    ) : (
                      <span className="text-xs text-muted-foreground">{t("source.web")}</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <StatusTag tone={actionTone[r.action] ?? "neutral"}>
                      {actionLabel[r.action] ?? r.action}
                    </StatusTag>
                  </TableCell>
                  <TableCell className="whitespace-nowrap">
                    {entityLabel[r.entityType] ?? r.entityType}
                    {r.entityId == null ? null : (
                      <span className="ml-1 text-xs text-muted-foreground tabular-nums">#{r.entityId}</span>
                    )}
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

/** 操作人：有名字就畫頭像（有上傳圖用圖，沒有用首字）＋名字；沒有就是系統或「—」。 */
function ActorCell({
  name,
  image,
  fallback,
}: Readonly<{ name: string | null; image: string | null; fallback: string }>) {
  if (!name) return fallback;
  return (
    <span className="inline-flex items-center gap-2">
      <PartyAvatar name={name} src={image} size="sm" className="rounded-full" />
      {name}
    </span>
  );
}

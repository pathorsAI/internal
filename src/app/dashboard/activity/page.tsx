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
import { activityUndoLinks } from "@/db/undo";
import { PartyAvatar } from "@/components/party-avatar";
import { formatDateTime } from "@/lib/format";
import { requireOrg } from "@/lib/session";
import { ActivityDetailProvider, ActivityRow, UndoOfLink } from "./activity-detail";

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
    employee_bank_account: t("entity.employee_bank_account"),
    subscription_period: t("entity.subscription_period"),
    vendor_billing_account: t("entity.vendor_billing_account"),
    payment_method: t("entity.payment_method"),
    vendor_invoice: t("entity.vendor_invoice"),
    recurring_expense: t("entity.recurring_expense"),
    ai_rule: t("entity.ai_rule"),
    calendar: t("entity.calendar"),
    member: t("entity.member"),
  };
  const { orgId } = await requireOrg();
  const rows = await listActivity(orgId, { limit: 300 });
  const ids = rows.map((r) => r.id);
  const [actorImages, undoLinks] = await Promise.all([activityActorImages(orgId, ids), activityUndoLinks(orgId, ids)]);

  return (
    <>
      <PageHeader title={t("title")} />
      <ActivityDetailProvider>
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
                <ActivityRow key={r.id} id={r.id}>
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
                    {r.channel === "mcp" ||
                    r.channel === "ai" ||
                    r.channel === "api" ||
                    r.channel === "line" ||
                    r.channel === "whatsapp" ||
                    r.channel === "system" ? (
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
                  <TableCell className="max-w-[36ch] text-muted-foreground">
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 truncate" title={r.summary ?? ""}>
                        {r.summary ?? "—"}
                      </span>
                      <UndoMarks links={undoLinks.get(r.id)} undoneLabel={t("undo.undoneBy")} />
                    </div>
                  </TableCell>
                </ActivityRow>
              ))
            )}
          </TableBody>
        </Table>
      </TableCard>
      </ActivityDetailProvider>
    </>
  );
}

/** 這筆是復原（「已復原 #id」，點了開原本那筆）／這筆被復原過（「已被復原」）。 */
function UndoMarks({
  links,
  undoneLabel,
}: Readonly<{ links: { undoOf: number | null; undoneBy: number | null } | undefined; undoneLabel: string }>) {
  if (!links) return null;
  return (
    <span className="flex shrink-0 items-center gap-2">
      {links.undoOf === null ? null : <UndoOfLink id={links.undoOf} />}
      {links.undoneBy === null ? null : <StatusTag tone="neutral">{undoneLabel}</StatusTag>}
    </span>
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

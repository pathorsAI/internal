import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { RowDialog } from "@/components/row-dialog";
import { DeleteButton } from "@/components/delete-button";
import { deleteSubscription } from "@/db/mutations";
import { EditSubscriptionForm } from "./edit-subscription-form";
import { PageHeader } from "@/components/page-header";
import { StatusTag } from "@/components/ds/status-dot";
import { Amount } from "@/components/amount";
import { TableCard } from "@/components/table-card";
import { EmptyRow } from "@/components/empty-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  listSubscriptions,
  listParties,
  listProjects,
  listContracts,
  getSubscriptionSchedule,
  type SubscriptionSchedule,
} from "@/db/queries";
import { formatCurrency } from "@/lib/format";
import { getOrgTaxSetting } from "@/db/org-tax";
import { TaxBreakdown } from "@/components/tax-breakdown";
import { NewSubscriptionDialog } from "./new-subscription-dialog";
import { requireOrg } from "@/lib/session";

export const dynamic = "force-dynamic";

type Tone = "neutral" | "primary" | "income" | "warning" | "risk";

const statusTone: Record<string, Tone> = {
  active: "primary",
  paused: "warning",
  ended: "neutral",
};

const periodStatusTone: Record<string, Tone> = {
  paid: "income",
  partial: "warning",
  overdue: "risk",
  upcoming: "neutral",
};

/**
 * next-intl 的 translator key 型別比 `string` 窄，當成參數傳遞時逆變過不了，而且
 * 整棵訊息樹展開會讓 TS 直接放棄（TS2589）。這裡縮成最小介面，傳入時明確轉型。
 */
type Translator = (key: string, values?: Record<string, string | number>) => string;

function PeriodScheduleTable({
  schedule,
  t,
  periodStatusLabels,
}: Readonly<{
  schedule: SubscriptionSchedule | null;
  t: Translator;
  periodStatusLabels: Record<string, string>;
}>) {
  if (!schedule || schedule.periods.length === 0) {
    return <p className="mt-6 text-sm text-muted-foreground">{t("schedule.empty")}</p>;
  }
  return (
    <div className="mt-6">
      <div className="mb-2 text-sm font-medium text-muted-foreground">{t("schedule.heading")}</div>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("schedule.columns.period")}</TableHead>
              <TableHead className="text-right">{t("schedule.columns.expected")}</TableHead>
              <TableHead className="text-right">{t("schedule.columns.paid")}</TableHead>
              <TableHead>{t("schedule.columns.status")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {schedule.periods.map((p) => (
              <TableRow key={p.periodStart}>
                <TableCell className="tabular-nums">
                  {p.periodLabel}
                  {p.isOverride && p.note ? (
                    <span className="mt-0.5 block text-xs text-muted-foreground">{p.note}</span>
                  ) : null}
                </TableCell>
                <TableCell className="text-right">
                  {/* 應收是含稅 gross；有稅額才多一行拆解 */}
                  <Amount value={p.expected} currency={schedule.currency} kind="neutral" />
                  <TaxBreakdown net={p.net} tax={p.tax} />
                </TableCell>
                <TableCell className="text-right">
                  <Amount value={p.paid} currency={schedule.currency} kind="neutral" />
                </TableCell>
                <TableCell>
                  <StatusTag
                    tone={periodStatusTone[p.status] ?? "neutral"}
                    pulse={p.status === "overdue"}
                  >
                    {periodStatusLabels[p.status] ?? p.status}
                  </StatusTag>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <p className="mt-2 text-right text-sm text-muted-foreground">
        {t("schedule.outstandingTotal")}
        <span className="font-medium text-foreground tabular-nums">
          {formatCurrency(schedule.totalOutstanding, schedule.currency)}
        </span>
      </p>
    </div>
  );
}

function intervalLabel(t: Translator, months: number) {
  if (months === 1) return t("interval.monthly");
  if (months === 12) return t("interval.yearly");
  if (months === 3) return t("interval.quarterly");
  return t("interval.everyNMonths", { months });
}

export default async function SubscriptionsPage() {
  const { orgId } = await requireOrg();
  const t = await getTranslations("subscriptions");
  const [rows, parties, projects, contracts, orgTax] = await Promise.all([
    listSubscriptions(orgId),
    listParties(orgId),
    listProjects(orgId),
    listContracts(orgId),
    getOrgTaxSetting(orgId),
  ]);
  const partyOptions = parties.map((p) => ({ id: p.id, name: p.name }));
  const projectOptions = projects.map((p) => ({ id: p.id, name: p.name }));
  // 合約標題常常重複（同一客戶多張約），帶上客戶名才分得出是誰的合約。
  const contractOptions = contracts.map((c) => ({
    id: c.id,
    name: c.customerName ? `${c.title} — ${c.customerName}` : c.title,
  }));
  // 訂閱不多，逐筆抓各期收款狀態即可（一次平行抓完）。
  const schedules = await Promise.all(rows.map((s) => getSubscriptionSchedule(orgId, s.id)));
  const scheduleById = new Map(schedules.filter((s) => s != null).map((s) => [s.id, s]));
  const statusLabels: Record<string, string> = {
    active: t("status.active"),
    paused: t("status.paused"),
    ended: t("status.ended"),
  };
  const periodStatusLabels: Record<string, string> = {
    paid: t("periodStatus.paid"),
    partial: t("periodStatus.partial"),
    overdue: t("periodStatus.overdue"),
    upcoming: t("periodStatus.upcoming"),
  };

  return (
    <>
      <PageHeader title={t("list.title")} description={t("list.description")}>
        <NewSubscriptionDialog
          parties={partyOptions}
          projects={projectOptions}
          contracts={contractOptions}
          orgTax={orgTax}
        />
      </PageHeader>

      <TableCard>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("list.columns.plan")}</TableHead>
              <TableHead>{t("list.columns.customer")}</TableHead>
              <TableHead>{t("list.columns.project")}</TableHead>
              <TableHead>{t("list.columns.contract")}</TableHead>
              <TableHead className="text-right">{t("list.columns.amount")}</TableHead>
              <TableHead className="pl-6">{t("list.columns.status")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <EmptyRow colSpan={6} message={t("list.empty")} />
            ) : (
              rows.map((s) => (
                <RowDialog
                  key={s.id}
                  rowId={s.id}
                  title={s.name}
                  description={t("list.rowDescription")}
                  cells={
                    <>
                      <TableCell className="font-medium">{s.name}</TableCell>
                      <TableCell>{s.customerName ?? "—"}</TableCell>
                      <TableCell className="text-muted-foreground">{s.projectName ?? "—"}</TableCell>
                      <TableCell className="max-w-[22ch] text-muted-foreground">
                        {s.contractId != null && s.contractTitle ? (
                          <Link
                            href={`/dashboard/contracts?open=${s.contractId}`}
                            title={s.contractTitle}
                            className="block truncate text-primary hover:underline"
                          >
                            {s.contractTitle}
                          </Link>
                        ) : (
                          <span className="block truncate">{s.contractTitle ?? "—"}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {/* 金額與頻率是同一件事（每月 NT$X），疊在同一格、靠右對齊。
                            主行是客戶每期實際要付的含稅金額，有稅額才多一行未稅＋稅。 */}
                        <Amount
                          value={s.gross}
                          currency={s.currency}
                          kind="neutral"
                          className="block font-medium"
                        />
                        <span className="block text-xs text-muted-foreground">
                          {intervalLabel(t as Translator, s.intervalMonths)}
                        </span>
                        <TaxBreakdown net={s.net} tax={s.tax} />
                      </TableCell>
                      <TableCell className="pl-6">
                        <StatusTag tone={statusTone[s.status] ?? "neutral"}>
                          {statusLabels[s.status] ?? s.status}
                        </StatusTag>
                      </TableCell>
                    </>
                  }
                >
                  {s.contractId != null && s.contractTitle ? (
                    <p className="mb-3 text-sm">
                      <span className="text-muted-foreground">{t("list.contractLinkLabel")}</span>
                      <Link
                        href={`/dashboard/contracts?open=${s.contractId}`}
                        className="text-primary hover:underline"
                      >
                        {s.contractTitle} →
                      </Link>
                    </p>
                  ) : null}
                  <EditSubscriptionForm
                    subscription={{
                      id: s.id,
                      customerPartyId: s.customerPartyId,
                      customerName: s.customerName,
                      projectId: s.projectId,
                      contractId: s.contractId,
                      name: s.name,
                      amount: s.amount,
                      currency: s.currency,
                      intervalMonths: s.intervalMonths,
                      startDate: s.startDate,
                      endDate: s.endDate,
                      status: s.status,
                      note: s.note,
                      taxTreatment: s.ownTaxTreatment,
                      amountBasis: s.ownAmountBasis,
                    }}
                    parties={partyOptions}
                    projects={projectOptions}
                    contracts={contractOptions}
                    orgTax={orgTax}
                    footer={<DeleteButton action={deleteSubscription} id={s.id} />}
                  />
                  <PeriodScheduleTable
                    schedule={scheduleById.get(s.id) ?? null}
                    t={t as Translator}
                    periodStatusLabels={periodStatusLabels}
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

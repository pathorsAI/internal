import { RowDialog } from "@/components/row-dialog";
import { DeleteButton } from "@/components/delete-button";
import { deleteSubscription } from "@/db/mutations";
import { EditSubscriptionForm } from "./edit-subscription-form";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
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
  getSubscriptionSchedule,
  type SubscriptionSchedule,
} from "@/db/queries";
import { formatCurrency } from "@/lib/format";
import { NewSubscriptionDialog } from "./new-subscription-dialog";
import { requireOrg } from "@/lib/session";

export const dynamic = "force-dynamic";

const statusMap: Record<string, string> = { active: "進行中", paused: "暫停", ended: "結束" };
const statusVariant: Record<string, "default" | "secondary" | "outline"> = {
  active: "default",
  paused: "secondary",
  ended: "outline",
};

// 各期收款狀態 → 繁中標籤 + badge 樣式
const periodStatusMap: Record<string, string> = {
  paid: "已收",
  partial: "部分",
  overdue: "逾期",
  upcoming: "未到期",
};
const periodStatusVariant: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  paid: "default",
  partial: "secondary",
  overdue: "destructive",
  upcoming: "outline",
};

function PeriodScheduleTable({ schedule }: { schedule: SubscriptionSchedule | null }) {
  if (!schedule || schedule.periods.length === 0) {
    return <p className="mt-6 text-sm text-muted-foreground">尚無收款期別</p>;
  }
  return (
    <div className="mt-6">
      <div className="mb-2 text-sm font-medium">各期收款</div>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>期別</TableHead>
              <TableHead className="text-right">應收</TableHead>
              <TableHead className="text-right">已收</TableHead>
              <TableHead>狀態</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {schedule.periods.map((p) => (
              <TableRow key={p.periodStart}>
                <TableCell className="tabular-nums">{p.periodLabel}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatCurrency(p.expected, schedule.currency)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatCurrency(p.paid, schedule.currency)}
                </TableCell>
                <TableCell>
                  <Badge variant={periodStatusVariant[p.status] ?? "outline"}>
                    {periodStatusMap[p.status] ?? p.status}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <p className="mt-2 text-right text-sm text-muted-foreground">
        未收合計：
        <span className="font-medium text-foreground tabular-nums">
          {formatCurrency(schedule.totalOutstanding, schedule.currency)}
        </span>
      </p>
    </div>
  );
}

function intervalLabel(months: number) {
  if (months === 1) return "每月";
  if (months === 12) return "每年";
  if (months === 3) return "每季";
  return `每 ${months} 個月`;
}

export default async function SubscriptionsPage() {
  const { orgId } = await requireOrg();
  const [rows, parties, projects] = await Promise.all([
    listSubscriptions(orgId),
    listParties(orgId),
    listProjects(orgId),
  ]);
  const partyOptions = parties.map((p) => ({ id: p.id, name: p.name }));
  const projectOptions = projects.map((p) => ({ id: p.id, name: p.name }));
  // 訂閱不多，逐筆抓各期收款狀態即可（一次平行抓完）。
  const schedules = await Promise.all(rows.map((s) => getSubscriptionSchedule(orgId, s.id)));
  const scheduleById = new Map(schedules.filter((s) => s != null).map((s) => [s.id, s]));

  return (
    <>
      <PageHeader title="訂閱 / 月費" description="客戶定期收費的方案，點列可編輯">
        <NewSubscriptionDialog parties={partyOptions} projects={projectOptions} />
      </PageHeader>

      <TableCard>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>方案</TableHead>
              <TableHead>客戶</TableHead>
              <TableHead>專案</TableHead>
              <TableHead className="text-right">金額</TableHead>
              <TableHead>頻率</TableHead>
              <TableHead>狀態</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <EmptyRow colSpan={6} message="尚無訂閱，點右上角新增" />
            ) : (
              rows.map((s) => (
                <RowDialog
                  key={s.id}
                  title={s.name}
                  description="訂閱 / 月費"
                  cells={
                    <>
                      <TableCell className="font-medium">{s.name}</TableCell>
                      <TableCell>{s.customerName ?? "—"}</TableCell>
                      <TableCell className="text-muted-foreground">{s.projectName ?? "—"}</TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {formatCurrency(s.amount, s.currency)}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{intervalLabel(s.intervalMonths)}</TableCell>
                      <TableCell>
                        <Badge variant={statusVariant[s.status] ?? "outline"}>
                          {statusMap[s.status] ?? s.status}
                        </Badge>
                      </TableCell>
                    </>
                  }
                >
                  <EditSubscriptionForm
                    subscription={{
                      id: s.id,
                      customerPartyId: s.customerPartyId,
                      projectId: s.projectId,
                      name: s.name,
                      amount: s.amount,
                      currency: s.currency,
                      intervalMonths: s.intervalMonths,
                      startDate: s.startDate,
                      endDate: s.endDate,
                      status: s.status,
                      note: s.note,
                    }}
                    parties={partyOptions}
                    projects={projectOptions}
                    footer={<DeleteButton action={deleteSubscription} id={s.id} />}
                  />
                  <PeriodScheduleTable schedule={scheduleById.get(s.id) ?? null} />
                </RowDialog>
              ))
            )}
          </TableBody>
        </Table>
      </TableCard>
    </>
  );
}

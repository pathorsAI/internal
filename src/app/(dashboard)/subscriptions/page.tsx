import { RowDialog } from "@/components/row-dialog";
import { DeleteButton } from "@/components/delete-button";
import { deleteSubscription } from "@/db/mutations";
import { EditSubscriptionForm } from "./edit-subscription-form";
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
import { listSubscriptions, listParties, listProjects } from "@/db/queries";
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

  return (
    <>
      <PageHeader title="訂閱 / 月費" description="客戶定期收費的方案，點列可編輯">
        <NewSubscriptionDialog parties={partyOptions} projects={projectOptions} />
      </PageHeader>

      <Card>
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
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground">
                  尚無訂閱，點右上角新增
                </TableCell>
              </TableRow>
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
                </RowDialog>
              ))
            )}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}

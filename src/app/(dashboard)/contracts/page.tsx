import { RowDialog } from "@/components/row-dialog";
import { DeleteButton } from "@/components/delete-button";
import { deleteContract } from "@/db/mutations";
import { EditContractForm } from "./edit-contract-form";
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
  isLockedScheduleRow,
  listBillingBoard,
  listContracts,
  listParties,
  listProjects,
} from "@/db/queries";
import { formatCurrency, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { NewContractDialog } from "./new-contract-dialog";
import { ContractFileLink } from "./contract-file-link";
import { requireOrg } from "@/lib/session";
import { ContractBillingItems } from "./contract-billing-items";

export const dynamic = "force-dynamic";

const statusMap: Record<string, string> = {
  draft: "草稿",
  active: "進行中",
  completed: "已完成",
  cancelled: "已取消",
};
const statusVariant: Record<string, "default" | "secondary" | "outline"> = {
  draft: "outline",
  active: "default",
  completed: "secondary",
  cancelled: "outline",
};

// 收款進度欄：已收 / 合約金額 + 進度條，下方顯示未收與累計成本（成本不從合約金額扣）。
function CollectionCell({
  amount,
  currency,
  received,
  cost,
}: Readonly<{
  amount: string | null;
  currency: string;
  received: number;
  cost: number;
}>) {
  const total = amount == null ? null : Number(amount);
  const pct = total && total > 0 ? Math.min(100, Math.round((received / total) * 100)) : null;
  const remaining = total == null ? null : total - received;
  // 進度條填色依收款狀態:溢收→支出色,已收齊→收入色,進行中→主色;無金額時留一條空軌維持等高。
  const overCollected = total != null && received > total;
  const fullyCollected = total != null && received >= total;
  return (
    <div className="min-w-[170px] space-y-1">
      <div className="flex items-baseline justify-between gap-2 text-sm tabular-nums">
        <span className="font-medium">{formatCurrency(received, currency)}</span>
        <span className="text-xs text-muted-foreground">
          {total == null ? "未設金額" : `/ ${formatCurrency(total, currency)}`}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        {pct != null && (
          <div
            className={cn(
              "h-full rounded-full",
              overCollected
                ? "bg-expense"
                : fullyCollected
                  ? "bg-income"
                  : "bg-primary",
            )}
            style={{ width: `${pct}%` }}
          />
        )}
      </div>
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground tabular-nums">
        <span>
          {remaining == null
            ? "—"
            : remaining > 0
              ? `未收 ${formatCurrency(remaining, currency)}`
              : remaining < 0
                ? `溢收 ${formatCurrency(-remaining, currency)}`
                : "已收齊"}
        </span>
        {cost > 0 && <span>成本 {formatCurrency(cost, currency)}</span>}
      </div>
    </div>
  );
}

export default async function ContractsPage() {
  const { orgId } = await requireOrg();
  const [rows, parties, projects, board] = await Promise.all([
    listContracts(orgId),
    listParties(orgId),
    listProjects(orgId),
    listBillingBoard(orgId, { includeAllHistory: true }),
  ]);
  const partyOptions = parties.map((p) => ({ id: p.id, name: p.name }));
  const projectOptions = projects.map((p) => ({ id: p.id, name: p.name }));

  // 一次抓完整個看板再依合約分組，避免每張合約各查一次（N+1）。
  const billingByContract = new Map<number, typeof board>();
  for (const r of board) {
    if (r.source !== "billing_item" || r.contractId == null) continue;
    const list = billingByContract.get(r.contractId) ?? [];
    list.push(r);
    billingByContract.set(r.contractId, list);
  }

  return (
    <>
      <PageHeader title="合約" description="客戶合約，點列可編輯">
        <NewContractDialog parties={partyOptions} projects={projectOptions} />
      </PageHeader>

      <TableCard>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>合約</TableHead>
              <TableHead>客戶</TableHead>
              <TableHead>專案</TableHead>
              <TableHead>收款進度</TableHead>
              <TableHead>期間</TableHead>
              <TableHead>狀態</TableHead>
              <TableHead>檔案</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <EmptyRow colSpan={7} message="尚無合約">
                點右上角新增
              </EmptyRow>
            ) : (
              rows.map((c) => (
                <RowDialog
                  key={c.id}
                  title={c.title}
                  description="合約"
                  cells={
                    <>
                      <TableCell className="max-w-[26ch] truncate font-medium" title={c.title}>
                        {c.title}
                      </TableCell>
                      <TableCell>{c.customerName ?? "—"}</TableCell>
                      <TableCell className="text-muted-foreground">{c.projectName ?? "—"}</TableCell>
                      <TableCell>
                        <CollectionCell
                          amount={c.amount}
                          currency={c.currency}
                          received={c.received}
                          cost={c.cost}
                        />
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {c.startDate ? formatDate(c.startDate) : "—"}
                        {c.endDate ? ` ~ ${formatDate(c.endDate)}` : ""}
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusVariant[c.status] ?? "outline"}>
                          {statusMap[c.status] ?? c.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {c.fileUrl ? (
                          <ContractFileLink url={c.fileUrl} />
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </TableCell>
                    </>
                  }
                >
                  <EditContractForm
                    contract={{
                      id: c.id,
                      customerPartyId: c.customerPartyId,
                      projectId: c.projectId,
                      title: c.title,
                      amount: c.amount,
                      currency: c.currency,
                      startDate: c.startDate,
                      endDate: c.endDate,
                      signedDate: c.signedDate,
                      paymentTermsDays: c.paymentTermsDays,
                      status: c.status,
                      note: c.note,
                      fileUrl: c.fileUrl,
                      billingPlan: c.billingPlan,
                      installmentCount: c.installmentCount,
                      installmentSplit: c.installmentSplit,
                      billingIntervalMonths: c.billingIntervalMonths,
                      dueRule: c.dueRule,
                      dueDay: c.dueDay,
                    }}
                    parties={partyOptions}
                    projects={projectOptions}
                    summary={{ received: c.received, cost: c.cost, remaining: c.remaining }}
                    scheduleCount={(billingByContract.get(c.id) ?? []).length}
                    lockedScheduleCount={
                      (billingByContract.get(c.id) ?? []).filter(isLockedScheduleRow).length
                    }
                    extra={
                      <ContractBillingItems
                        contractId={c.id}
                        rows={billingByContract.get(c.id) ?? []}
                        parties={partyOptions}
                        projects={projectOptions}
                      />
                    }
                    footer={<DeleteButton action={deleteContract} id={c.id} />}
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

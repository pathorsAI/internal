import { getTranslations } from "next-intl/server";
import { RowDialog } from "@/components/row-dialog";
import { DeleteButton } from "@/components/delete-button";
import { deleteContract } from "@/db/mutations";
import { EditContractForm } from "./edit-contract-form";
import { PageHeader } from "@/components/page-header";
import { StatusTag } from "@/components/ds/status-dot";
import { Progress } from "@/components/ds/progress";
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
  listSubscriptionsByContract,
} from "@/db/queries";
import { formatCurrency, formatDate } from "@/lib/format";
import { getOrgTaxSetting } from "@/db/org-tax";
import { TaxBreakdown } from "@/components/tax-breakdown";
import { NewContractDialog } from "./new-contract-dialog";
import { ContractFileLink } from "./contract-file-link";
import { requireOrg } from "@/lib/session";
import { ContractBillingItems } from "./contract-billing-items";
import { ContractSubscriptions } from "./contract-subscriptions";

export const dynamic = "force-dynamic";

const statusTone: Record<string, "neutral" | "primary" | "income"> = {
  draft: "neutral",
  active: "primary",
  completed: "income",
  cancelled: "neutral",
};

// 收款進度欄：已收 / 合約金額 + 進度條，下方顯示未收與累計成本（成本不從合約金額扣）。
// 欄寬固定，各列的進度條與數字上下對齊。
// 應收一律是含稅 gross（客戶實際要付的錢），入帳拿它比；有稅額才在最下面多一行未稅＋稅。
function CollectionCell({
  gross,
  net,
  tax,
  remaining,
  currency,
  received,
  cost,
  t,
}: Readonly<{
  gross: number | null;
  net: number | null;
  tax: number | null;
  remaining: number | null;
  currency: string;
  received: number;
  cost: number;
  t: Awaited<ReturnType<typeof getTranslations<"contracts">>>;
}>) {
  const total = gross;
  const pct = total && total > 0 ? Math.round((received / total) * 100) : null;
  let remainingLabel: React.ReactNode;
  if (remaining == null) remainingLabel = "—";
  else if (remaining > 0)
    remainingLabel = t("list.collection.unpaid", {
      amount: formatCurrency(remaining, currency),
    });
  else if (remaining < 0)
    // 溢收是要人處理的異常，用 destructive；其餘維持灰字。
    remainingLabel = (
      <span className="text-destructive">
        {t("list.collection.overCollected", {
          amount: formatCurrency(-remaining, currency),
        })}
      </span>
    );
  else remainingLabel = <span className="text-income">{t("list.collection.fullyPaid")}</span>;
  return (
    <div className="w-72 space-y-1.5">
      <div className="flex items-baseline justify-between gap-2 text-sm tabular-nums">
        <span className="font-medium">{formatCurrency(received, currency)}</span>
        <span className="truncate text-xs text-muted-foreground">
          {total == null ? t("list.collection.unsetAmount") : `/ ${formatCurrency(total, currency)}`}
        </span>
      </div>
      <div className="flex items-center gap-2">
        {/* 無金額時留一條空軌維持等高 */}
        <Progress value={received} max={total ?? 0} className="flex-1" />
        <span className="w-9 shrink-0 text-right text-xs text-muted-foreground tabular-nums">
          {pct == null ? "—" : `${pct}%`}
        </span>
      </div>
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground tabular-nums">
        <span className="truncate">{remainingLabel}</span>
        {cost > 0 && (
          <span className="shrink-0">
            {t("list.collection.cost", { amount: formatCurrency(cost, currency) })}
          </span>
        )}
      </div>
      <TaxBreakdown net={net} tax={tax} />
    </div>
  );
}

export default async function ContractsPage() {
  const { orgId } = await requireOrg();
  const t = await getTranslations("contracts");
  const [rows, parties, projects, board, subsByContract, orgTax] = await Promise.all([
    listContracts(orgId),
    listParties(orgId),
    listProjects(orgId),
    listBillingBoard(orgId, { includeAllHistory: true }),
    listSubscriptionsByContract(orgId),
    getOrgTaxSetting(orgId),
  ]);
  const partyOptions = parties.map((p) => ({ id: p.id, name: p.name }));
  const projectOptions = projects.map((p) => ({ id: p.id, name: p.name }));
  const statusLabels: Record<string, string> = {
    draft: t("status.draft"),
    active: t("status.active"),
    completed: t("status.completed"),
    cancelled: t("status.cancelled"),
  };

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
      <PageHeader title={t("list.title")} description={t("list.description")}>
        <NewContractDialog parties={partyOptions} projects={projectOptions} orgTax={orgTax} />
      </PageHeader>

      <TableCard>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("list.columns.title")}</TableHead>
              <TableHead>{t("list.columns.customer")}</TableHead>
              <TableHead>{t("list.columns.project")}</TableHead>
              <TableHead>{t("list.columns.collectionProgress")}</TableHead>
              <TableHead>{t("list.columns.period")}</TableHead>
              <TableHead>{t("list.columns.status")}</TableHead>
              <TableHead>{t("list.columns.file")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <EmptyRow colSpan={7} message={t("list.empty.message")}>
                {t("list.empty.cta")}
              </EmptyRow>
            ) : (
              rows.map((c) => (
                <RowDialog
                  key={c.id}
                  rowId={c.id}
                  title={c.title}
                  description={t("list.rowDescription")}
                  cells={
                    <>
                      <TableCell className="max-w-[26ch] truncate font-medium" title={c.title}>
                        {c.title}
                      </TableCell>
                      <TableCell>{c.customerName ?? "—"}</TableCell>
                      <TableCell className="text-muted-foreground">{c.projectName ?? "—"}</TableCell>
                      <TableCell>
                        <CollectionCell
                          gross={c.gross}
                          net={c.net}
                          tax={c.tax}
                          remaining={c.remaining}
                          currency={c.currency}
                          received={c.received}
                          cost={c.cost}
                          t={t}
                        />
                      </TableCell>
                      <TableCell className="text-xs whitespace-nowrap text-muted-foreground tabular-nums">
                        {c.startDate ? formatDate(c.startDate) : "—"}
                        {c.endDate ? ` ~ ${formatDate(c.endDate)}` : ""}
                      </TableCell>
                      <TableCell>
                        <StatusTag tone={statusTone[c.status] ?? "neutral"}>
                          {statusLabels[c.status] ?? c.status}
                        </StatusTag>
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
                      customerName: c.customerName,
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
                      taxTreatment: c.ownTaxTreatment,
                      amountBasis: c.ownAmountBasis,
                    }}
                    orgTax={orgTax}
                    parties={partyOptions}
                    projects={projectOptions}
                    summary={{ received: c.received, cost: c.cost, remaining: c.remaining }}
                    scheduleCount={(billingByContract.get(c.id) ?? []).length}
                    lockedScheduleCount={
                      (billingByContract.get(c.id) ?? []).filter(isLockedScheduleRow).length
                    }
                    extra={
                      <>
                        <ContractBillingItems
                          contractId={c.id}
                          rows={billingByContract.get(c.id) ?? []}
                          parties={partyOptions}
                          projects={projectOptions}
                          orgTax={orgTax}
                        />
                        <ContractSubscriptions rows={subsByContract.get(c.id) ?? []} />
                      </>
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

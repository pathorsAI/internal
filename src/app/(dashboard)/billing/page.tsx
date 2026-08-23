import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { CalendarClock } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { TableCard } from "@/components/table-card";
import { EmptyRow } from "@/components/empty-state";
import { RowDialog } from "@/components/row-dialog";
import { DeleteButton } from "@/components/delete-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  listBillingBoard,
  listContracts,
  listParties,
  listProjects,
  summarizeBilling,
  type BillingRow,
} from "@/db/queries";
import { deleteBillingItem } from "@/db/mutations";
import { formatCurrency, formatDate } from "@/lib/format";
import { requireOrg } from "@/lib/session";
import { getCalendarSettings } from "@/lib/google-calendar";
import { cn } from "@/lib/utils";
import { BillingStatusBadge } from "./billing-status";
import { SummaryCards, type BoardFilter } from "./summary-cards";
import { NewBillingItemDialog } from "./new-billing-item-dialog";
import { EditBillingItemForm } from "./edit-billing-item-form";
import { QuickMark } from "./quick-actions";
import { IssueInvoiceDialog } from "./issue-invoice-dialog";
import { RecordPaymentDialog } from "./record-payment-dialog";
import { SyncCalendarButton } from "./sync-calendar-button";

export const dynamic = "force-dynamic";

type T = Awaited<ReturnType<typeof getTranslations<"billing">>>;

const FILTERS = new Set<BoardFilter>(["due", "awaiting", "overdue", "invoice"]);

function matchesFilter(row: BillingRow, filter: BoardFilter) {
  switch (filter) {
    case "due":
      return row.status === "due";
    case "awaiting":
      return row.status === "billed" || row.status === "partial";
    case "overdue":
      return row.status === "overdue";
    case "invoice":
      return row.needsInvoice;
  }
}

/** 未收 / 溢收 / 已收齊 的說明文字。 */
function outstandingLabel(t: T, expected: number, paid: number, currency: string) {
  const outstanding = expected - paid;
  if (outstanding > 0) return t("amount.outstanding", { amount: formatCurrency(outstanding, currency) });
  if (outstanding < 0) return t("amount.overpaid", { amount: formatCurrency(-outstanding, currency) });
  return t("amount.settled");
}

/** 已收 / 應收 + 未收差額，沿用合約頁「收款進度」的資訊密度。 */
function AmountCell({ row, t }: Readonly<{ row: BillingRow; t: T }>) {
  return (
    <div className="min-w-[150px] space-y-0.5 text-sm tabular-nums">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-medium">{formatCurrency(row.paid, row.currency)}</span>
        <span className="text-xs text-muted-foreground">
          / {formatCurrency(row.expected, row.currency)}
        </span>
      </div>
      <div className="text-xs text-muted-foreground">
        {outstandingLabel(t, row.expected, row.paid, row.currency)}
      </div>
    </div>
  );
}

/** 發票欄：已開就顯示日期，該開沒開就標紅，不需要開就留白。 */
function InvoiceCell({ row, t }: Readonly<{ row: BillingRow; t: T }>) {
  if (row.invoicedOn) {
    return (
      <span className="text-xs tabular-nums text-muted-foreground">
        {formatDate(row.invoicedOn)}
      </span>
    );
  }
  if (row.needsInvoice) {
    return (
      <Badge variant="outline" className="border-expense/40 text-expense">
        {t("table.pendingInvoice")}
      </Badge>
    );
  }
  return <span className="text-xs text-muted-foreground">—</span>;
}

/**
 * 就地推進：一列一次只提示「下一步該做什麼」，做完才換下一顆按鈕。
 *
 *   還沒請款 → 標記已請款
 *   已請款   → 登記收款（有缺口時）＋ 開發票（該開未開時）
 *
 * 開發票走預填草稿，只有 billing_items 有實體列可綁；訂閱期別沒有 id 可綁，
 * 退回單純的日期標記，發票本身到發票頁建立。
 */
function RowActions({ row }: Readonly<{ row: BillingRow }>) {
  const itemId = row.source === "billing_item" ? row.billingItemId : null;
  const outstanding = row.expected - row.paid;

  if (!row.billedOn) {
    return <QuickMark rowKey={row.key} field="billedOn" value={null} />;
  }

  return (
    <>
      {outstanding > 0 && (
        <RecordPaymentDialog
          rowKey={row.key}
          expected={row.expected}
          paid={row.paid}
          currency={row.currency}
          customerPartyId={row.customerPartyId}
          customerName={row.customerName}
        />
      )}
      {row.needsInvoice &&
        (itemId == null ? (
          <QuickMark rowKey={row.key} field="invoicedOn" value={row.invoicedOn} />
        ) : (
          <IssueInvoiceDialog
            billingItemId={itemId}
            contractId={row.contractId}
            customerName={row.customerName}
            customerTaxId={row.customerTaxId}
            title={row.title}
            expected={row.expected}
            currency={row.currency}
          />
        ))}
      <QuickMark rowKey={row.key} field="billedOn" value={row.billedOn} />
    </>
  );
}

export default async function BillingPage({
  searchParams,
}: Readonly<{ searchParams: Promise<{ filter?: string }> }>) {
  const { orgId } = await requireOrg();
  const t = await getTranslations("billing");
  const { filter: rawFilter } = await searchParams;
  const filter =
    rawFilter && FILTERS.has(rawFilter as BoardFilter) ? (rawFilter as BoardFilter) : null;

  const [rows, parties, projects, contracts, calendar] = await Promise.all([
    listBillingBoard(orgId),
    listParties(orgId),
    listProjects(orgId),
    listContracts(orgId),
    getCalendarSettings(orgId),
  ]);

  // 摘要一律用全部資料算，篩選只影響下方表格 —— 否則點了卡片其他數字會跟著歸零。
  const summary = summarizeBilling(rows);
  const visible = filter ? rows.filter((r) => matchesFilter(r, filter)) : rows;

  const partyOptions = parties.map((p) => ({ id: p.id, name: p.name }));
  const projectOptions = projects.map((p) => ({ id: p.id, name: p.name }));
  const contractOptions = contracts.map((c) => ({ id: c.id, name: c.title }));

  return (
    <>
      <PageHeader
        title={t("page.title")}
        description={t("page.description")}
      >
        <SyncCalendarButton
          connected={Boolean(calendar?.ownerUserId && calendar?.googleCalendarId)}
        />
        <NewBillingItemDialog
          parties={partyOptions}
          contracts={contractOptions}
          projects={projectOptions}
        />
      </PageHeader>

      <SummaryCards summary={summary} active={filter} />

      <TableCard
        title={filter ? t("table.filtered") : t("table.all")}
        action={
          <span className="flex items-center gap-2">
            {t("table.count", { count: visible.length })}
            {filter && (
              <Button asChild size="sm" variant="ghost">
                <Link href="/billing">{t("table.clearFilter")}</Link>
              </Button>
            )}
          </span>
        }
      >
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("table.columns.customer")}</TableHead>
              <TableHead>{t("table.columns.item")}</TableHead>
              <TableHead>{t("table.columns.dueDate")}</TableHead>
              <TableHead>{t("table.columns.amount")}</TableHead>
              <TableHead>{t("table.columns.status")}</TableHead>
              <TableHead>{t("table.columns.invoice")}</TableHead>
              <TableHead>{t("table.columns.nextAction")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.length === 0 ? (
              <EmptyRow colSpan={7} message={filter ? t("table.emptyFiltered") : t("table.emptyAll")}>
                {filter ? t("table.emptyFilteredHint") : t("table.emptyAllHint")}
              </EmptyRow>
            ) : (
              visible.map((row) => {
                // 訂閱期別是算出來的、沒有實體列，所以沒有 id 可編輯。先取出來讓
                // 型別自己收斂成 number，下面就不需要 non-null assertion。
                const itemId = row.source === "billing_item" ? row.billingItemId : null;
                const cells = (
                  <>
                    <TableCell className="font-medium">{row.customerName ?? "—"}</TableCell>
                    <TableCell className="max-w-[24ch]">
                      <div className="truncate" title={row.title}>
                        {row.title}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">
                        {row.source === "subscription"
                          ? t("table.subscriptionSource")
                          : (row.contractTitle ?? row.projectName ?? t("table.oneTimeSource"))}
                      </div>
                    </TableCell>
                    <TableCell
                      className={cn(
                        "text-sm tabular-nums",
                        row.status === "overdue" && "text-expense",
                      )}
                    >
                      {row.dueDate ? formatDate(row.dueDate) : "—"}
                      {row.billedOn && (
                        <div className="text-xs text-muted-foreground">
                          {t("table.billedPrefix", { date: formatDate(row.billedOn) })}
                          {/* 有月結條件時期限會晚於應請款日，直接寫出來免得自己推算 */}
                          {row.deadline && row.deadline !== row.dueDate && (
                            <> · {t("table.deadline", { date: formatDate(row.deadline) })}</>
                          )}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>
                      <AmountCell row={row} t={t} />
                    </TableCell>
                    <TableCell>
                      <BillingStatusBadge status={row.status} />
                    </TableCell>
                    <TableCell>
                      <InvoiceCell row={row} t={t} />
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        <RowActions row={row} />
                      </div>
                    </TableCell>
                  </>
                );

                // 只有 billing_items 能開編輯表單；訂閱期別在「訂閱 / 月費」頁維護。
                if (itemId == null) {
                  return <TableRow key={row.key}>{cells}</TableRow>;
                }

                return (
                  <RowDialog
                    key={row.key}
                    title={row.title}
                    description={t("table.rowDialogDescription")}
                    cells={cells}
                  >
                    <EditBillingItemForm
                      id={itemId}
                      values={{
                        customerPartyId: row.customerPartyId,
                        customerName: row.customerName,
                        contractId: row.contractId,
                        projectId: row.projectId,
                        title: row.title,
                        amount: String(row.expected),
                        currency: row.currency,
                        dueDate: row.dueDate,
                        billedOn: row.billedOn,
                        paidOn: row.paidOn,
                        invoicedOn: row.invoicedOn,
                        needsInvoice: row.needsInvoice || row.invoicedOn != null,
                        status: row.rawStatus ?? "scheduled",
                        note: row.note,
                      }}
                      parties={partyOptions}
                      contracts={contractOptions}
                      projects={projectOptions}
                      footer={
                        <DeleteButton action={deleteBillingItem} id={itemId} />
                      }
                    />
                  </RowDialog>
                );
              })
            )}
          </TableBody>
        </Table>
      </TableCard>

      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <CalendarClock className="size-3.5" />
        {t("page.footerHint")}
      </p>
    </>
  );
}

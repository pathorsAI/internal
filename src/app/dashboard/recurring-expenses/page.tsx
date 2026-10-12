import { getTranslations } from "next-intl/server";
import { RowDialog } from "@/components/row-dialog";
import { DeleteButton } from "@/components/delete-button";
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
import { deleteRecurringExpense } from "@/db/mutations";
import { listParties, listRecurringExpenses, type RecurringExpenseRow } from "@/db/queries";
import { formatCurrency } from "@/lib/format";
import { nextChargeDate, toRecurringExpense } from "@/lib/recurring-expenses";
import { canManageOrg, requireOrgWithRole } from "@/lib/session";
import { taipeiDate } from "@/lib/simpany-sync";
import { listPaymentMethods } from "@/lib/vendor-billing/service";
import { EditRecurringExpenseForm } from "./edit-recurring-expense-form";
import { NewRecurringExpenseDialog } from "./new-recurring-expense-dialog";

export const dynamic = "force-dynamic";

/** 同 subscriptions 頁：next-intl 的 key 型別當參數傳會逆變失敗，縮成最小介面。 */
type Translator = (key: string, values?: Record<string, string | number>) => string;

function intervalLabel(t: Translator, months: number) {
  if (months === 1) return t("interval.monthly");
  if (months === 12) return t("interval.yearly");
  if (months === 3) return t("interval.quarterly");
  return t("interval.everyNMonths", { months });
}

function ScheduleCell({ row, today, t }: Readonly<{ row: RecurringExpenseRow; today: string; t: Translator }>) {
  const expense = toRecurringExpense(row);
  if (expense.schedule === "usage") return <span className="text-muted-foreground">{t("schedule.usage")}</span>;
  const next = nextChargeDate(expense, today);
  return (
    <>
      {intervalLabel(t, expense.intervalMonths)}
      {next ? (
        <span className="mt-0.5 block text-xs tabular-nums text-muted-foreground">
          {t("list.nextCharge", { date: next })}
        </span>
      ) : null}
    </>
  );
}

function RowCells({ row, today, t }: Readonly<{ row: RecurringExpenseRow; today: string; t: Translator }>) {
  return (
    <>
      <TableCell className="font-medium">
        {row.name}
        {row.partyName ? (
          <span className="mt-0.5 block text-xs font-normal text-muted-foreground">{row.partyName}</span>
        ) : null}
      </TableCell>
      <TableCell>
        <ScheduleCell row={row} today={today} t={t} />
      </TableCell>
      <TableCell className="text-muted-foreground">
        {row.paymentMethodLabel ?? "—"}
        {row.expectedAccountName ? <span className="mt-0.5 block text-xs">{row.expectedAccountName}</span> : null}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {row.expectedAmount !== null && row.currency ? formatCurrency(row.expectedAmount, row.currency) : "—"}
      </TableCell>
      <TableCell>
        <Badge variant={row.isActive ? "default" : "outline"}>
          {row.isActive ? t("status.active") : t("status.inactive")}
        </Badge>
      </TableCell>
    </>
  );
}

export default async function RecurringExpensesPage() {
  const { orgId, role } = await requireOrgWithRole();
  const canManage = canManageOrg(role);
  const t = (await getTranslations("recurringExpenses")) as Translator;
  const [rows, parties, paymentMethods] = await Promise.all([
    listRecurringExpenses(orgId),
    listParties(orgId),
    listPaymentMethods(orgId),
  ]);
  const partyOptions = parties.map((p) => ({ id: p.id, name: p.name }));
  const paymentMethodOptions = paymentMethods.map((m) => ({
    id: m.id,
    label: m.label,
    accountName: m.settlesFromAccountName,
    isActive: m.isActive,
  }));
  // 扣款日以台北日曆為準（與 Discord 提醒一致），不受伺服器時區影響。
  const today = taipeiDate();

  return (
    <>
      <PageHeader title={t("list.title")} description={t("list.description")}>
        {canManage ? <NewRecurringExpenseDialog parties={partyOptions} paymentMethods={paymentMethodOptions} /> : null}
      </PageHeader>
      {canManage ? null : <p className="mb-4 text-sm text-muted-foreground">{t("list.readOnlyNote")}</p>}

      <TableCard>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("list.columns.name")}</TableHead>
              <TableHead>{t("list.columns.schedule")}</TableHead>
              <TableHead>{t("list.columns.paymentMethod")}</TableHead>
              <TableHead className="text-right">{t("list.columns.expected")}</TableHead>
              <TableHead>{t("list.columns.status")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <EmptyRow colSpan={5} message={t("list.empty")} />
            ) : (
              rows.map((r) =>
                canManage ? (
                  <RowDialog
                    key={r.id}
                    rowId={r.id}
                    title={r.name}
                    description={t("list.rowDescription")}
                    cells={<RowCells row={r} today={today} t={t} />}
                  >
                    <EditRecurringExpenseForm
                      expense={{
                        id: r.id,
                        name: r.name,
                        partyName: r.partyName,
                        matchPattern: r.matchPattern,
                        paymentMethodId: r.paymentMethodId,
                        schedule: r.schedule,
                        anchorDate: r.anchorDate,
                        intervalMonths: r.intervalMonths,
                        expectedAmount: r.expectedAmount,
                        currency: r.currency,
                        billingUrl: r.billingUrl,
                        isActive: r.isActive,
                        note: r.note,
                      }}
                      parties={partyOptions}
                      paymentMethods={paymentMethodOptions}
                      footer={<DeleteButton action={deleteRecurringExpense} id={r.id} />}
                    />
                  </RowDialog>
                ) : (
                  <TableRow key={r.id}>
                    <RowCells row={r} today={today} t={t} />
                  </TableRow>
                ),
              )
            )}
          </TableBody>
        </Table>
      </TableCard>
    </>
  );
}

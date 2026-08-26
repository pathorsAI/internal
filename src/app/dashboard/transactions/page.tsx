import { Fragment } from "react";
import { PageHeader } from "@/components/page-header";
import { BookBadge } from "@/components/book-badge";
import { Badge } from "@/components/ui/badge";
import { TableCard } from "@/components/table-card";
import { EmptyState } from "@/components/empty-state";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  listTransactions,
  countTransactions,
  getAuditMeta,
  listDocumentsForTransactions,
  listBankAccounts,
  listCategories,
  listParties,
  listEmployees,
  listProjects,
  listContractOptions,
  listTransactionMonths,
  type Book,
  type TxnDocument,
  type AuditMeta,
} from "@/db/queries";
import { PaginationNav } from "@/components/pagination-nav";
import type { ContractOption } from "./contract-combobox";
import { formatCurrency, formatDate, formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { NewTransactionDialog } from "./new-transaction-dialog";
import { DeleteButton } from "@/components/delete-button";
import { deleteTransaction } from "@/db/mutations";
import { RowDialog } from "@/components/row-dialog";
import { EditTransactionForm } from "./edit-transaction-form";
import { TransactionFilters } from "./transaction-filters";
import { txnTypeColor } from "@/components/amount";
import { requireOrg } from "@/lib/session";
import { getTranslations } from "next-intl/server";

export const dynamic = "force-dynamic";

type TxnRow = Awaited<ReturnType<typeof listTransactions>>[number];
type Opt = { id: number; name: string };
type AccountOpt = { id: number; name: string; currency: string };

// 依年月分組（rows 已照日期新到舊排序，保留順序）
function groupByMonth(rows: TxnRow[]) {
  const map = new Map<string, TxnRow[]>();
  for (const t of rows) {
    const ym = t.txnDate.slice(0, 7);
    const arr = map.get(ym) ?? [];
    arr.push(t);
    map.set(ym, arr);
  }
  return [...map.entries()].map(([ym, items]) => {
    const [y, m] = ym.split("-");
    return { ym, year: y, month: m, rows: items };
  });
}

function TransactionRow({
  t,
  typeLabel,
  editDialogTitle,
  editDialogDescription,
  uncategorizedLabel,
  categories,
  parties,
  employees,
  accounts,
  projects,
  contracts,
  docs,
  audit,
}: Readonly<{
  t: TxnRow;
  typeLabel: Record<string, string>;
  editDialogTitle: string;
  editDialogDescription: string;
  uncategorizedLabel: string;
  categories: Opt[];
  parties: Opt[];
  employees: Opt[];
  accounts: AccountOpt[];
  projects: Opt[];
  contracts: ContractOption[];
  docs: TxnDocument[];
  audit?: AuditMeta;
}>) {
  // 表格上「最後更新」的操作人：改過就顯示最後修改人，沒改過就顯示建立人
  const updater = audit?.updatedBy ?? audit?.createdBy ?? null;
  return (
    <RowDialog
      variant="sheet"
      title={editDialogTitle}
      description={editDialogDescription}
      cells={
        <>
          <TableCell className="whitespace-nowrap text-muted-foreground">
            {formatDate(t.txnDate)}
          </TableCell>
          <TableCell>
            <div className="flex min-w-0 flex-col gap-1">
              <span className="truncate">{t.partyName ?? t.settleName ?? "—"}</span>
              <Badge variant="secondary" className="w-fit font-normal">
                {typeLabel[t.type] ?? t.type}
              </Badge>
            </div>
          </TableCell>
          <TableCell className="truncate text-muted-foreground">
            {t.description ?? "—"}
          </TableCell>
          <TableCell className="truncate">{t.categoryName ?? uncategorizedLabel}</TableCell>
          <TableCell>
            <BookBadge book={t.book} />
          </TableCell>
          <TableCell className="truncate text-xs text-muted-foreground">
            {[t.fromAccount, t.toAccount].filter(Boolean).join(" → ") || "—"}
          </TableCell>
          <TableCell className="text-xs text-muted-foreground">
            <div className="flex min-w-0 flex-col">
              <span className="truncate">{formatDateTime(t.updatedAt)}</span>
              {updater ? <span className="truncate">{updater}</span> : null}
            </div>
          </TableCell>
          <TableCell className={cn("text-right font-medium tabular-nums", txnTypeColor(t.type))}>
            {formatCurrency(t.amount, t.currency)}
          </TableCell>
        </>
      }
    >
      <EditTransactionForm
        txn={{
          id: t.id,
          type: t.type,
          txnDate: t.txnDate,
          createdAt: t.createdAt,
          updatedAt: t.updatedAt,
          description: t.description,
          amount: t.amount,
          currency: t.currency,
          categoryId: t.categoryId,
          book: t.book,
          billedToCompanyTaxId: t.billedToCompanyTaxId,
          partyName: t.partyName,
          settleName: t.settleName,
          fromAccountId: t.fromAccountId,
          toAccountId: t.toAccountId,
          projectId: t.projectId,
          contractId: t.contractId,
        }}
        categories={categories}
        parties={parties}
        employees={employees}
        accounts={accounts}
        projects={projects}
        contracts={contracts}
        docs={docs}
        audit={audit}
        footer={<DeleteButton action={deleteTransaction} id={t.id} />}
      />
    </RowDialog>
  );
}

const PAGE_SIZE = 50;

export default async function TransactionsPage({
  searchParams,
}: Readonly<{
  searchParams: Promise<{
    book?: string;
    category?: string;
    account?: string;
    period?: string;
    page?: string;
  }>;
}>) {
  const { orgId } = await requireOrg();
  const tr = await getTranslations("transactions");
  const typeLabel: Record<string, string> = {
    expense: tr("type.expense"),
    income: tr("type.income"),
    advance: tr("type.advance"),
    reimbursement: tr("type.reimbursement"),
    transfer: tr("type.transfer"),
  };
  // table-fixed 下，欄寬由表頭決定，各月份共用同一組欄寬 → 金額欄永遠對齊
  const COLUMNS: { label: string; width: string; align?: "right" }[] = [
    { label: tr("columns.date"), width: "w-24" },
    { label: tr("columns.counterparty"), width: "w-44" },
    { label: tr("columns.description"), width: "" },
    { label: tr("columns.category"), width: "w-28" },
    { label: tr("columns.book"), width: "w-20" },
    { label: tr("columns.account"), width: "w-40" },
    { label: tr("columns.lastUpdated"), width: "w-36" },
    { label: tr("columns.amount"), width: "w-32", align: "right" },
  ];
  const { book, category, account, period, page: pageParam } = await searchParams;
  const active = (["internal", "external", "both"].includes(book ?? "") ? book : undefined) as
    | Book
    | undefined;
  const categoryId = category && Number.isFinite(Number(category)) ? Number(category) : undefined;
  const accountId = account && Number.isFinite(Number(account)) ? Number(account) : undefined;
  const page = Math.max(1, Math.trunc(Number(pageParam)) || 1);
  const filters = { book: active, categoryId, accountId, period };
  const [rows, total, accounts, categories, parties, employees, projects, contracts, months] =
    await Promise.all([
      listTransactions(orgId, filters, PAGE_SIZE, (page - 1) * PAGE_SIZE),
      countTransactions(orgId, filters),
      listBankAccounts(orgId),
      listCategories(orgId),
      listParties(orgId),
      listEmployees(orgId),
      listProjects(orgId),
      listContractOptions(orgId),
      listTransactionMonths(orgId),
    ]);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const [docsMap, auditMap] = await Promise.all([
    listDocumentsForTransactions(orgId, rows.map((r) => r.id)),
    getAuditMeta(orgId, "transaction", rows.map((r) => r.id)),
  ]);
  const partyOpts = parties.map((s) => ({ id: s.id, name: s.name }));
  const employeeOpts = employees.map((e) => ({ id: e.id, name: e.name }));
  const accountOpts = accounts.map((a) => ({ id: a.id, name: a.name, currency: a.currency }));
  const projectOpts = projects.map((p) => ({ id: p.id, name: p.name }));
  // 合約下拉的顯示字串：標題（客戶），避免同名合約難以分辨
  const contractOpts: ContractOption[] = contracts.map((c) => ({
    id: c.id,
    label: c.customerName ? `${c.title} (${c.customerName})` : c.title,
  }));
  const groups = groupByMonth(rows);

  return (
    <>
      <PageHeader title={tr("page.title")} description={tr("page.description")}>
        <NewTransactionDialog
          accounts={accounts.map((a) => ({ id: a.id, name: a.name, currency: a.currency }))}
          categories={categories}
          parties={parties.map((s) => ({ id: s.id, name: s.name }))}
          employees={employees.map((e) => ({ id: e.id, name: e.name }))}
          projects={projectOpts}
          contracts={contractOpts}
        />
      </PageHeader>

      <TransactionFilters
        categories={categories.map((c) => ({ id: c.id, name: c.name }))}
        accounts={accountOpts}
        months={months}
        book={active}
        category={category}
        account={account}
        period={period}
      />

      {groups.length === 0 ? (
        <TableCard>
          <EmptyState message={total === 0 ? tr("empty.noData") : tr("empty.noPageData")} />
        </TableCard>
      ) : (
        <TableCard>
          <Table className="table-fixed">
            <TableHeader>
              <TableRow>
                {COLUMNS.map((c) => (
                  <TableHead
                    key={c.label}
                    className={cn(c.width, c.align === "right" && "text-right")}
                  >
                    {c.label}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.map((g) => (
                <Fragment key={g.ym}>
                  <TableRow className="hover:bg-transparent">
                    <TableCell
                      colSpan={COLUMNS.length}
                      className="bg-muted/50 py-1.5 text-xs"
                    >
                      <span className="font-medium text-foreground">
                        {tr("table.monthLabel", { year: g.year, month: g.month })}
                      </span>
                      <span className="ml-2 text-muted-foreground">
                        {tr("table.rowsCount", { count: g.rows.length })}
                      </span>
                    </TableCell>
                  </TableRow>
                  {g.rows.map((t) => (
                    <TransactionRow
                      key={t.id}
                      t={t}
                      typeLabel={typeLabel}
                      editDialogTitle={tr("editDialog.title")}
                      editDialogDescription={tr("editDialog.description")}
                      uncategorizedLabel={tr("table.uncategorized")}
                      categories={categories}
                      parties={partyOpts}
                      employees={employeeOpts}
                      accounts={accountOpts}
                      projects={projectOpts}
                      contracts={contractOpts}
                      docs={docsMap.get(t.id) ?? []}
                      audit={auditMap.get(t.id)}
                    />
                  ))}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        </TableCard>
      )}

      <PaginationNav
        page={page}
        totalPages={totalPages}
        total={total}
        basePath="/dashboard/transactions"
        params={{ book, category, account, period }}
      />
    </>
  );
}

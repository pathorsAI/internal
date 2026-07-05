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
import { formatCurrency, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { NewTransactionDialog } from "./new-transaction-dialog";
import { DeleteButton } from "@/components/delete-button";
import { deleteTransaction } from "@/db/mutations";
import { RowDialog } from "@/components/row-dialog";
import { EditTransactionForm } from "./edit-transaction-form";
import { TransactionFilters } from "./transaction-filters";
import { txnTypeColor } from "@/components/amount";
import { requireOrg } from "@/lib/session";

export const dynamic = "force-dynamic";

const typeLabel: Record<string, string> = {
  expense: "一般支出",
  income: "收入",
  advance: "員工代墊",
  reimbursement: "撥款",
  transfer: "轉帳",
};

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
    return { ym, label: `${y} 年 ${m} 月`, rows: items };
  });
}

// table-fixed 下，欄寬由表頭決定，各月份共用同一組欄寬 → 金額欄永遠對齊
const COLUMNS: { label: string; width: string; align?: "right" }[] = [
  { label: "日期", width: "w-24" },
  { label: "對象", width: "w-44" },
  { label: "說明", width: "" },
  { label: "分類", width: "w-28" },
  { label: "帳別", width: "w-20" },
  { label: "帳戶", width: "w-40" },
  { label: "金額", width: "w-32", align: "right" },
];

function TransactionRow({
  t,
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
  categories: Opt[];
  parties: Opt[];
  employees: Opt[];
  accounts: AccountOpt[];
  projects: Opt[];
  contracts: ContractOption[];
  docs: TxnDocument[];
  audit?: AuditMeta;
}>) {
  return (
    <RowDialog
      variant="sheet"
      title="編輯交易"
      description="類型不可改，其餘欄位皆可編輯"
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
          <TableCell className="truncate">{t.categoryName ?? "未分類"}</TableCell>
          <TableCell>
            <BookBadge book={t.book} />
          </TableCell>
          <TableCell className="truncate text-xs text-muted-foreground">
            {[t.fromAccount, t.toAccount].filter(Boolean).join(" → ") || "—"}
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
}: {
  searchParams: Promise<{
    book?: string;
    category?: string;
    account?: string;
    period?: string;
    page?: string;
  }>;
}) {
  const { orgId } = await requireOrg();
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
    label: c.customerName ? `${c.title}（${c.customerName}）` : c.title,
  }));
  const groups = groupByMonth(rows);

  return (
    <>
      <PageHeader title="內外帳" description="所有交易紀錄，可依帳別、分類篩選">
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
          <EmptyState message={total === 0 ? "尚無交易" : "此頁沒有資料"} />
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
                      <span className="font-medium text-foreground">{g.label}</span>
                      <span className="ml-2 text-muted-foreground">{g.rows.length} 筆</span>
                    </TableCell>
                  </TableRow>
                  {g.rows.map((t) => (
                    <TransactionRow
                      key={t.id}
                      t={t}
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
        basePath="/transactions"
        params={{ book, category, account, period }}
      />
    </>
  );
}

import { PageHeader } from "@/components/page-header";
import { BookBadge } from "@/components/book-badge";
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
import {
  listTransactions,
  listDocumentsForTransactions,
  listBankAccounts,
  listCategories,
  listParties,
  listEmployees,
  listTransactionMonths,
  type Book,
  type TxnDocument,
} from "@/db/queries";
import { formatCurrency, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { NewTransactionDialog } from "./new-transaction-dialog";
import { DeleteButton } from "@/components/delete-button";
import { deleteTransaction } from "@/db/mutations";
import { RowDialog } from "@/components/row-dialog";
import { EditTransactionForm } from "./edit-transaction-form";
import { TransactionFilters } from "./transaction-filters";

export const dynamic = "force-dynamic";

function txnAmountColor(type: string) {
  if (type === "income") return "text-green-600";
  if (type === "expense" || type === "advance") return "text-red-600";
  return "";
}

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

const COLUMNS = ["日期", "對象", "說明", "分類", "帳別", "帳戶", "金額", "動作"];

function TransactionRow({
  t,
  categories,
  parties,
  employees,
  accounts,
  docs,
}: Readonly<{
  t: TxnRow;
  categories: Opt[];
  parties: Opt[];
  employees: Opt[];
  accounts: AccountOpt[];
  docs: TxnDocument[];
}>) {
  return (
    <RowDialog
      title="編輯交易"
      description="類型不可改，其餘欄位皆可編輯"
      cells={
        <>
          <TableCell className="whitespace-nowrap text-muted-foreground">
            {formatDate(t.txnDate)}
          </TableCell>
          <TableCell>
            <div className="flex flex-col gap-1">
              <span>{t.partyName ?? t.settleName ?? "—"}</span>
              <Badge variant="secondary" className="w-fit font-normal">
                {typeLabel[t.type] ?? t.type}
              </Badge>
            </div>
          </TableCell>
          <TableCell className="max-w-[20ch] truncate text-muted-foreground">
            {t.description ?? "—"}
          </TableCell>
          <TableCell>{t.categoryName ?? "未分類"}</TableCell>
          <TableCell>
            <BookBadge book={t.book} />
          </TableCell>
          <TableCell className="text-xs text-muted-foreground">
            {[t.fromAccount, t.toAccount].filter(Boolean).join(" → ") || "—"}
          </TableCell>
          <TableCell className={cn("text-right font-medium tabular-nums", txnAmountColor(t.type))}>
            {formatCurrency(t.amount, t.currency)}
          </TableCell>
          <TableCell className="text-right">
            <DeleteButton action={deleteTransaction} id={t.id} />
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
        }}
        categories={categories}
        parties={parties}
        employees={employees}
        accounts={accounts}
        docs={docs}
      />
    </RowDialog>
  );
}

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<{ book?: string; category?: string; account?: string; period?: string }>;
}) {
  const { book, category, account, period } = await searchParams;
  const active = (["internal", "external", "both"].includes(book ?? "") ? book : undefined) as
    | Book
    | undefined;
  const categoryId = category && Number.isFinite(Number(category)) ? Number(category) : undefined;
  const accountId = account && Number.isFinite(Number(account)) ? Number(account) : undefined;
  const [rows, accounts, categories, parties, employees, months] = await Promise.all([
    listTransactions({ book: active, categoryId, accountId, period }),
    listBankAccounts(),
    listCategories(),
    listParties(),
    listEmployees(),
    listTransactionMonths(),
  ]);
  const docsMap = await listDocumentsForTransactions(rows.map((r) => r.id));
  const partyOpts = parties.map((s) => ({ id: s.id, name: s.name }));
  const employeeOpts = employees.map((e) => ({ id: e.id, name: e.name }));
  const accountOpts = accounts.map((a) => ({ id: a.id, name: a.name, currency: a.currency }));
  const groups = groupByMonth(rows);

  return (
    <>
      <PageHeader title="內外帳" description="所有交易紀錄，可依帳別、分類篩選">
        <NewTransactionDialog
          accounts={accounts.map((a) => ({ id: a.id, name: a.name, currency: a.currency }))}
          categories={categories}
          parties={parties.map((s) => ({ id: s.id, name: s.name }))}
          employees={employees.map((e) => ({ id: e.id, name: e.name }))}
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
        <Card>
          <div className="p-8 text-center text-sm text-muted-foreground">尚無交易</div>
        </Card>
      ) : (
        <div className="space-y-4">
          {groups.map((g) => (
            <Card key={g.ym}>
              <div className="flex items-center justify-between border-b px-4 py-2.5">
                <span className="font-medium">{g.label}</span>
                <span className="text-xs text-muted-foreground">{g.rows.length} 筆</span>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    {COLUMNS.map((c) => (
                      <TableHead key={c} className={c === "金額" || c === "動作" ? "text-right" : ""}>
                        {c}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {g.rows.map((t) => (
                    <TransactionRow
                      key={t.id}
                      t={t}
                      categories={categories}
                      parties={partyOpts}
                      employees={employeeOpts}
                      accounts={accountOpts}
                      docs={docsMap.get(t.id) ?? []}
                    />
                  ))}
                </TableBody>
              </Table>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

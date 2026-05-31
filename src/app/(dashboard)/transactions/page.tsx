import Link from "next/link";
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
  type Book,
} from "@/db/queries";
import { formatCurrency, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { NewTransactionDialog } from "./new-transaction-dialog";
import { DeleteButton } from "@/components/delete-button";
import { deleteTransaction } from "@/db/mutations";
import { RowDialog } from "@/components/row-dialog";
import { EditTransactionForm } from "./edit-transaction-form";

export const dynamic = "force-dynamic";

const tabs: { label: string; book?: Book }[] = [
  { label: "全部" },
  { label: "內帳", book: "internal" },
  { label: "外帳", book: "external" },
  { label: "內外", book: "both" },
];

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

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<{ book?: string }>;
}) {
  const { book } = await searchParams;
  const active = (["internal", "external", "both"].includes(book ?? "") ? book : undefined) as
    | Book
    | undefined;
  const [rows, accounts, categories, parties, employees] = await Promise.all([
    listTransactions(active),
    listBankAccounts(),
    listCategories(),
    listParties(),
    listEmployees(),
  ]);
  const docsMap = await listDocumentsForTransactions(rows.map((r) => r.id));

  return (
    <>
      <PageHeader title="內外帳" description="所有交易紀錄，可依內帳 / 外帳檢視">
        <NewTransactionDialog
          accounts={accounts.map((a) => ({ id: a.id, name: a.name, currency: a.currency }))}
          categories={categories}
          parties={parties.map((s) => ({ id: s.id, name: s.name }))}
          employees={employees.map((e) => ({ id: e.id, name: e.name }))}
        />
      </PageHeader>

      <div className="flex gap-1">
        {tabs.map((t) => {
          const isActive = t.book === active;
          return (
            <Link
              key={t.label}
              href={t.book ? `/transactions?book=${t.book}` : "/transactions"}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted",
              )}
            >
              {t.label}
            </Link>
          );
        })}
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>日期</TableHead>
              <TableHead>對象</TableHead>
              <TableHead>說明</TableHead>
              <TableHead>分類</TableHead>
              <TableHead>帳別</TableHead>
              <TableHead>帳戶</TableHead>
              <TableHead className="text-right">金額</TableHead>
              <TableHead className="text-right">動作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center text-muted-foreground">
                  尚無交易
                </TableCell>
              </TableRow>
            ) : (
              rows.map((t) => {
                const amountColor = txnAmountColor(t.type); // reimbursement / transfer → 黑
                return (
                  <RowDialog
                    key={t.id}
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
                        <TableCell className={cn("text-right font-medium tabular-nums", amountColor)}>
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
                      parties={parties.map((s) => ({ id: s.id, name: s.name }))}
                      employees={employees.map((e) => ({ id: e.id, name: e.name }))}
                      accounts={accounts.map((a) => ({ id: a.id, name: a.name, currency: a.currency }))}
                      docs={docsMap.get(t.id) ?? []}
                    />
                  </RowDialog>
                );
              })
            )}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}

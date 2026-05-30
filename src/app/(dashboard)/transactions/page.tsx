import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { BookBadge } from "@/components/book-badge";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { listTransactions, type Book } from "@/db/queries";
import { formatCurrency, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const tabs: { label: string; book?: Book }[] = [
  { label: "全部" },
  { label: "內帳", book: "internal" },
  { label: "外帳", book: "external" },
  { label: "內外", book: "both" },
];

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<{ book?: string }>;
}) {
  const { book } = await searchParams;
  const active = (["internal", "external", "both"].includes(book ?? "") ? book : undefined) as
    | Book
    | undefined;
  const rows = await listTransactions(active);

  return (
    <>
      <PageHeader title="內外帳" description="所有交易紀錄，可依內帳 / 外帳檢視" />

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
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center text-muted-foreground">
                  尚無交易
                </TableCell>
              </TableRow>
            ) : (
              rows.map((t) => {
                const isExpense = ["expense", "cogs", "non_operating"].includes(
                  t.categoryKind ?? "",
                );
                return (
                  <TableRow key={t.id}>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {formatDate(t.txnDate)}
                    </TableCell>
                    <TableCell>{t.party ?? "—"}</TableCell>
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
                    <TableCell
                      className={cn(
                        "text-right font-medium tabular-nums",
                        isExpense ? "text-red-600" : "",
                      )}
                    >
                      {formatCurrency(t.amountTwd ?? t.amount, t.currency)}
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}

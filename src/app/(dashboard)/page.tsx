import Link from "next/link";
import {
  ArrowLeftRight,
  FileText,
  Users,
  Landmark,
  TrendingUp,
  TrendingDown,
  Wallet,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { getOverview, listTransactions } from "@/db/queries";
import { formatCurrency, formatDate } from "@/lib/format";
import { BookBadge } from "@/components/book-badge";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const overview = await getOverview();
  const recent = await listTransactions(undefined, 6);

  const counts = [
    { label: "交易筆數", value: overview.counts.txns, icon: ArrowLeftRight, href: "/transactions" },
    { label: "發票", value: overview.counts.invoices, icon: FileText, href: "/invoices" },
    { label: "在職員工", value: overview.counts.employees, icon: Users, href: "/employees" },
    { label: "銀行帳戶", value: overview.counts.accounts, icon: Landmark, href: "/bank-accounts" },
  ];

  const money = [
    { label: "收入", value: overview.income, icon: TrendingUp, tone: "text-emerald-600" },
    { label: "支出", value: overview.expense, icon: TrendingDown, tone: "text-red-600" },
    { label: "淨額", value: overview.net, icon: Wallet, tone: overview.net >= 0 ? "text-emerald-600" : "text-red-600" },
  ];

  return (
    <>
      <PageHeader title="總覽" description="派斯科技內外帳與財務概況" />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {counts.map((c) => (
          <Link key={c.label} href={c.href}>
            <Card className="transition-colors hover:bg-muted/40">
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {c.label}
                </CardTitle>
                <c.icon className="size-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-semibold">{c.value}</div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {money.map((m) => (
          <Card key={m.label}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {m.label}
              </CardTitle>
              <m.icon className="size-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className={"text-2xl font-semibold tabular-nums " + m.tone}>
                {formatCurrency(m.value)}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">最近交易</CardTitle>
          <CardDescription>來自 Neon 即時資料</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {recent.length === 0 ? (
            <p className="text-sm text-muted-foreground">尚無交易</p>
          ) : (
            recent.map((t) => (
              <div
                key={t.id}
                className="flex items-center justify-between gap-4 border-b pb-2 last:border-0 last:pb-0"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {t.description ?? t.party ?? t.categoryName ?? "—"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t.categoryName ?? "未分類"} · {formatDate(t.txnDate)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <BookBadge book={t.book} />
                  <span className="text-sm font-medium tabular-nums">
                    {formatCurrency(t.amountTwd ?? t.amount, t.currency)}
                  </span>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </>
  );
}

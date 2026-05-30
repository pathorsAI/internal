import { Users, TrendingUp, TrendingDown, Wallet } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/page-header";
import { WireframeNotice } from "@/components/wireframe-notice";
import { formatCurrency, formatDate } from "@/lib/format";
import { sampleStats, sampleTransactions } from "@/lib/wireframe-data";

export default function DashboardPage() {
  const net = sampleStats.income - sampleStats.expense;
  const recent = sampleTransactions.slice(0, 5);

  const cards = [
    { label: "帳戶總數", value: sampleStats.accounts, icon: Users },
    {
      label: "總收入",
      value: formatCurrency(sampleStats.income),
      icon: TrendingUp,
    },
    {
      label: "總支出",
      value: formatCurrency(sampleStats.expense),
      icon: TrendingDown,
    },
    { label: "淨額", value: formatCurrency(net), icon: Wallet },
  ];

  return (
    <>
      <PageHeader title="總覽" description="派斯科技內部營運與財務概況" />
      <WireframeNotice />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map((c) => (
          <Card key={c.label}>
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
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">最近交易</CardTitle>
          <CardDescription>
            接上 DBA 設計的資料表後，這裡會顯示即時紀錄
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {recent.map((t) => (
            <div
              key={t.id}
              className="flex items-center justify-between gap-4 border-b pb-2 last:border-0 last:pb-0"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">
                  {t.description}
                </p>
                <p className="text-xs text-muted-foreground">
                  {t.category} · {formatDate(t.occurredAt)}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={t.type === "income" ? "default" : "secondary"}>
                  {t.type === "income" ? "收入" : "支出"}
                </Badge>
                <span className="text-sm font-medium tabular-nums">
                  {formatCurrency(t.amount, t.currency)}
                </span>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </>
  );
}

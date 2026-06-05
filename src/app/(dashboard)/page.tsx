import { TrendingUp, TrendingDown, Wallet } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { getOverview, listTransactions } from "@/db/queries";
import { formatCurrency, formatDate } from "@/lib/format";
import { BookBadge } from "@/components/book-badge";
import { requireOrg } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const { orgId } = await requireOrg();
  const overview = await getOverview(orgId);
  const recent = await listTransactions(orgId, undefined, 6);

  const currencyLabel: Record<string, string> = { TWD: "台幣", USD: "美金" };
  const stats = [
    { label: "收入", key: "income" as const, icon: TrendingUp },
    { label: "支出", key: "expense" as const, icon: TrendingDown },
    { label: "淨額", key: "net" as const, icon: Wallet },
  ];

  return (
    <>
      <PageHeader title="總覽" description="派斯科技內外帳與財務概況" />

      <Card className="divide-y gap-0 p-0">
        {overview.length === 0 ? (
          <div className="p-6 text-sm text-muted-foreground">尚無收支資料</div>
        ) : (
          overview.map((c) => (
            <div key={c.currency} className="flex items-center gap-4 px-4 py-3">
              <span className="w-8 shrink-0 text-xs font-medium text-muted-foreground">
                {currencyLabel[c.currency] ?? c.currency}
              </span>
              <div className="grid flex-1 grid-cols-3 gap-4">
                {stats.map((m) => {
                  const value = c[m.key];
                  const tone =
                    m.key === "expense" || value < 0 ? "text-red-600" : "text-emerald-600";
                  return (
                    <div key={m.label} className="space-y-0.5">
                      <div className="text-xs text-muted-foreground">{m.label}</div>
                      <div className={"text-base font-semibold tabular-nums " + tone}>
                        {formatCurrency(value, c.currency)}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">最近交易</CardTitle>
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
                    {t.description ?? t.partyName ?? t.categoryName ?? "—"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t.categoryName ?? "未分類"} · {formatDate(t.txnDate)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <BookBadge book={t.book} />
                  <span className="text-sm font-medium tabular-nums">
                    {formatCurrency(t.amount, t.currency)}
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

import { TrendingUp, TrendingDown, Wallet, Landmark } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { getOverview, listTransactions, listAccountBalances } from "@/db/queries";
import { formatCurrency, formatDate } from "@/lib/format";
import { BookBadge } from "@/components/book-badge";
import { requireOrg } from "@/lib/session";

export const dynamic = "force-dynamic";

const currencyLabel: Record<string, string> = { TWD: "台幣", USD: "美金" };
const kindLabel: Record<string, string> = { bank: "銀行", wise: "Wise / 虛擬", cash: "現金" };

export default async function DashboardPage() {
  const { orgId } = await requireOrg();
  const [overview, balances, recent] = await Promise.all([
    getOverview(orgId),
    listAccountBalances(orgId),
    listTransactions(orgId, undefined, 6),
  ]);

  // 依幣別彙整各帳戶餘額（含期初餘額），不同幣別不混加
  const byCurrency = new Map<
    string,
    { currency: string; total: number; accounts: typeof balances }
  >();
  for (const a of balances) {
    const g = byCurrency.get(a.currency) ?? {
      currency: a.currency,
      total: 0,
      accounts: [] as typeof balances,
    };
    g.total += Number(a.bookBalance);
    g.accounts.push(a);
    byCurrency.set(a.currency, g);
  }
  const assetGroups = [...byCurrency.values()].sort((a, b) =>
    a.currency.localeCompare(b.currency),
  );

  const stats = [
    { label: "收入", key: "income" as const, icon: TrendingUp },
    { label: "支出", key: "expense" as const, icon: TrendingDown },
    { label: "淨額", key: "net" as const, icon: Wallet },
  ];

  return (
    <>
      <PageHeader title="總覽" description="派斯科技內外帳與財務概況" />

      {/* 資產總覽：每種幣別一張卡，顯示總資產（含期初餘額）與各帳戶餘額 */}
      <section className="space-y-2">
        <h2 className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
          <Landmark className="size-4" /> 資產總覽
        </h2>
        {assetGroups.length === 0 ? (
          <Card>
            <CardContent className="p-6 text-sm text-muted-foreground">尚無帳戶</CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {assetGroups.map((g) => (
              <Card key={g.currency} className="gap-0 p-0">
                <CardHeader className="border-b p-4">
                  <CardTitle className="flex items-baseline justify-between gap-2 text-base">
                    <span className="text-xs font-medium text-muted-foreground">
                      {currencyLabel[g.currency] ?? g.currency} 總資產
                    </span>
                    <span
                      className={
                        "text-xl font-semibold tabular-nums " +
                        (g.total < 0 ? "text-red-600" : "text-emerald-600")
                      }
                    >
                      {formatCurrency(g.total, g.currency)}
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="divide-y p-0">
                  {g.accounts.map((a) => (
                    <div
                      key={a.id}
                      className="flex items-center justify-between gap-3 px-4 py-2.5"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{a.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {kindLabel[a.kind] ?? a.kind}
                        </p>
                      </div>
                      <span className="shrink-0 text-sm font-medium tabular-nums">
                        {formatCurrency(a.bookBalance, a.currency)}
                      </span>
                    </div>
                  ))}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      {/* 收支概況：依幣別分組的收入 / 支出 / 淨額（流量，不含期初餘額） */}
      <section className="space-y-2">
        <h2 className="text-sm font-medium text-muted-foreground">收支概況</h2>
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
      </section>

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

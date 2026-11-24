import { Suspense } from "react";
import { headers } from "next/headers";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import {
  TrendingUp,
  TrendingDown,
  Wallet,
  Landmark,
  ArrowLeftRight,
  Receipt,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import {
  getOverview,
  listTransactions,
  listAccountBalances,
  getMonthlyTrends,
  listMyOrgs,
} from "@/db/queries";
import { AgentConnectRow } from "@/components/ai/agent-connect-row";
import { AiPromptForm } from "@/components/ai/prompt-form";
import { internalConnectorName, orgMcpUrl } from "@/lib/claude-connector";
import { requestOrigin } from "@/lib/request-origin";
import { TrendCharts } from "./trend-charts";
import { SpendSection } from "./spend-section";
import { SpendSkeleton } from "./spend-chart";
import { formatDate } from "@/lib/format";
import { Amount, amountKind } from "@/components/amount";
import { EmptyState } from "@/components/empty-state";
import { BookBadge } from "@/components/book-badge";
import { StatCard } from "@/components/ds/stat-card";
import { Sparkline } from "@/components/ds/sparkline";
import { requireOrg } from "@/lib/session";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const t = await getTranslations("dashboard");
  const tAi = await getTranslations("ai.prompt");
  const { orgId, userId } = await requireOrg();
  const [overview, balances, recent, trends, myOrgs, h] = await Promise.all([
    getOverview(orgId),
    listAccountBalances(orgId),
    listTransactions(orgId, undefined, 6),
    getMonthlyTrends(orgId, 12),
    listMyOrgs(userId),
    headers(),
  ]);

  // 外部 agent 列用目前組織的固定 MCP 網址；找不到目前組織就只留 MCP 設定頁的連結。
  const activeOrg = myOrgs.find((o) => o.id === orgId);
  const claudeConnector = activeOrg
    ? {
        name: internalConnectorName(activeOrg.name),
        url: orgMcpUrl(`${requestOrigin(h)}/mcp`, activeOrg),
      }
    : null;

  const currencyLabel: Record<string, string> = {
    TWD: t("currency.TWD"),
    USD: t("currency.USD"),
  };
  const kindLabel: Record<string, string> = {
    bank: t("kind.bank"),
    wise: t("kind.wise"),
    cash: t("kind.cash"),
  };

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

  // 資產卡的走勢線：用已經抓好的 trends（視窗起點餘額 + 逐月淨流量）推出各幣別每月月底餘額，
  // 算法同 TrendCharts 的「帳戶餘額走勢」，不另外查資料庫。
  const accountCurrency = new Map(balances.map((a) => [a.id, a.currency]));
  const balanceSeries = (currency: string): number[] => {
    let running = trends.startBalances
      .filter((b) => accountCurrency.get(b.accountId) === currency)
      .reduce((sum, b) => sum + b.balance, 0);
    const netByMonth = new Map<string, number>();
    for (const f of trends.accountFlows) {
      if (accountCurrency.get(f.accountId) !== currency) continue;
      netByMonth.set(f.month, (netByMonth.get(f.month) ?? 0) + f.net);
    }
    return trends.months.map((m) => (running += netByMonth.get(m) ?? 0));
  };

  const stats = [
    { label: t("stats.income"), key: "income" as const, icon: TrendingUp },
    { label: t("stats.expense"), key: "expense" as const, icon: TrendingDown },
    { label: t("stats.net"), key: "net" as const, icon: Wallet },
  ];

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />

      {/* 問 AI 的入口放最上面：送出後帶著問題到 /dashboard/ai；下方 logo 列接外部 agent。 */}
      <section className="mx-auto w-full max-w-3xl space-y-4 py-2">
        <h2 className="text-lg font-semibold tracking-tight">{tAi("heading")}</h2>
        <AiPromptForm />
        <AgentConnectRow connector={claudeConnector} />
      </section>

      {/* 資產總覽：每種幣別一張卡，顯示總資產（含期初餘額）與各帳戶餘額 */}
      <section className="space-y-2">
        <h2 className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
          <Landmark className="size-4" /> {t("assets.title")}
        </h2>
        {assetGroups.length === 0 ? (
          <Card>
            <EmptyState icon={Landmark} message={t("assets.empty")} />
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {assetGroups.map((g) => {
              const spark = balanceSeries(g.currency);
              return (
                <StatCard
                  key={g.currency}
                  label={t("assets.totalAssets", {
                    currency: currencyLabel[g.currency] ?? g.currency,
                  })}
                  value={g.total}
                  currency={g.currency}
                  tone={g.total < 0 ? "risk" : "default"}
                  icon={<Landmark />}
                >
                  {spark.some((v) => v !== 0) ? (
                    <Sparkline data={spark} className="mt-2" />
                  ) : null}
                  <dl className="mt-3 divide-y divide-border-soft border-t border-border-soft">
                    {g.accounts.map((a) => (
                      <div
                        key={a.id}
                        className="flex items-center justify-between gap-3 py-2 last:pb-0"
                      >
                        <dt className="min-w-0">
                          <p className="truncate text-sm">{a.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {kindLabel[a.kind] ?? a.kind}
                          </p>
                        </dt>
                        <dd className="shrink-0 text-sm tabular-nums">
                          <Amount value={a.bookBalance} currency={a.currency} kind="neutral" />
                        </dd>
                      </div>
                    ))}
                  </dl>
                </StatCard>
              );
            })}
          </div>
        )}
      </section>

      {/* 收支趨勢：每月收支長條圖 + 帳戶餘額走勢，可篩選帳戶與 6/12 個月 */}
      <TrendCharts
        accounts={balances.map((a) => ({ id: a.id, name: a.name, currency: a.currency }))}
        trends={trends}
      />

      {/* 支出去向：前 8 名廠商（或分類）+ 其他，可切本月 / 3 / 12 個月；點一列看該對象的交易 */}
      <Suspense fallback={<SpendSkeleton />}>
        <SpendSection orgId={orgId} />
      </Suspense>

      {/* 收支概況：依幣別分組的收入 / 支出 / 淨額（流量，不含期初餘額） */}
      <section className="space-y-2">
        <h2 className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
          <ArrowLeftRight className="size-4" /> {t("flow.title")}
        </h2>
        <Card className="divide-y gap-0 p-0">
          {overview.length === 0 ? (
            <EmptyState icon={ArrowLeftRight} message={t("flow.empty")} />
          ) : (
            overview.map((c) => (
              <div key={c.currency} className="flex items-center gap-4 px-4 py-3">
                <span className="w-8 shrink-0 text-xs font-medium text-muted-foreground">
                  {currencyLabel[c.currency] ?? c.currency}
                </span>
                <div className="grid flex-1 grid-cols-3 gap-4">
                  {stats.map((m) => (
                    <div key={m.label} className="space-y-0.5">
                      <div className="text-xs text-muted-foreground">{m.label}</div>
                      {/* 支出欄位金額為正，語意為支出（墨色帶 −）；淨額依正負決定 */}
                      <Amount
                        value={c[m.key]}
                        currency={c.currency}
                        kind={m.key === "net" ? undefined : m.key}
                        className="text-base font-semibold"
                      />
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </Card>
      </section>

      {/* 最近交易：僅顯示 6 筆，提供「查看全部」前往完整帳本 */}
      <section className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground">
            <Receipt className="size-4" /> {t("recent.title")}
          </h2>
          <Link
            href="/dashboard/transactions"
            className="text-xs text-primary hover:underline"
          >
            {t("recent.viewAll")}
          </Link>
        </div>
        <Card>
          <CardContent className="space-y-3">
            {recent.length === 0 ? (
              <EmptyState icon={Receipt} message={t("recent.empty")} />
            ) : (
              recent.map((txn) => (
                <div
                  key={txn.id}
                  className="flex items-center justify-between gap-4 border-b pb-2 last:border-0 last:pb-0"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {txn.description ?? txn.partyName ?? txn.categoryName ?? "—"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {txn.categoryName ?? t("recent.uncategorized")} · {formatDate(txn.txnDate)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <BookBadge book={txn.book} />
                    <Amount
                      value={txn.amount}
                      currency={txn.currency}
                      kind={amountKind(txn.type)}
                      className="inline-block min-w-24 text-right text-sm font-medium"
                    />
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </section>
    </>
  );
}

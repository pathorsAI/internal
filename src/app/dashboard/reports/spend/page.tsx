import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/page-header";
import { getMonthlySpendBreakdown } from "@/db/queries";
import { requireOrg } from "@/lib/session";
import { ReportsNav } from "../reports-nav";
import { SpendTrendSkeleton, SpendTrendView } from "./spend-trend-view";

export const dynamic = "force-dynamic";

/** 資料載入獨立成 async component，讓標題與頁籤先畫出來，圖表區塊顯示骨架。 */
async function SpendTrendSection({ orgId }: Readonly<{ orgId: string }>) {
  const { months, rows } = await getMonthlySpendBreakdown(orgId, 12);
  return <SpendTrendView months={months} rows={rows} />;
}

export default async function SpendAnalysisPage() {
  const t = await getTranslations("reports.spendTrend");
  const { orgId } = await requireOrg();
  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <ReportsNav active="spend" />
      <Suspense fallback={<SpendTrendSkeleton />}>
        <SpendTrendSection orgId={orgId} />
      </Suspense>
    </>
  );
}

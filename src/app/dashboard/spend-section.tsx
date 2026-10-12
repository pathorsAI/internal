import { getSpendBreakdown } from "@/db/queries";
import { SpendChart } from "./spend-chart";

/**
 * 「支出去向」的資料載入。獨立成 async server component，讓總覽頁用 Suspense 包起來：
 * 其他區塊先畫出來，這塊載入中顯示同版型的骨架（SpendSkeleton）。
 */
export async function SpendSection({ orgId }: Readonly<{ orgId: string }>) {
  const { months, rows } = await getSpendBreakdown(orgId, 12);
  return <SpendChart months={months} rows={rows} />;
}

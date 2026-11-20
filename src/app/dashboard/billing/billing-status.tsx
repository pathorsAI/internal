import { getTranslations } from "next-intl/server";
import { StatusTag } from "@/components/ds/status-dot";
import type { BillingItemStatus } from "@/db/queries";

type Tone = React.ComponentProps<typeof StatusTag>["tone"];

// 待請款是「該動手」的藍、已請款 / 部分收款是等待中的琥珀、已收款用收入色；
// 紅色與脈衝只給逾期 —— 那是唯一要有人去追的狀態。
const tone: Record<BillingItemStatus, Tone> = {
  upcoming: "neutral",
  due: "primary",
  billed: "warning",
  partial: "warning",
  paid: "income",
  overdue: "risk",
};

/** 看板與合約頁共用的狀態顯示，確保同一個狀態在哪裡看都長一樣。 */
export async function BillingStatusBadge({ status }: Readonly<{ status: BillingItemStatus }>) {
  const t = await getTranslations("billing.status");
  return (
    <StatusTag tone={tone[status]} pulse={status === "overdue"}>
      {t(status)}
    </StatusTag>
  );
}

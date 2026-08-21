import { getTranslations } from "next-intl/server";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { BillingItemStatus } from "@/db/queries";

const variant: Record<BillingItemStatus, "default" | "secondary" | "outline" | "destructive"> = {
  upcoming: "outline",
  due: "default",
  billed: "secondary",
  partial: "secondary",
  paid: "outline",
  overdue: "destructive",
};

// 已收款用收入色、逾期用支出色，與內外帳/合約頁的金額配色一致。
const extraClass: Partial<Record<BillingItemStatus, string>> = {
  paid: "border-income/40 text-income",
};

/** 看板與合約頁共用的狀態顯示，確保同一個狀態在哪裡看都長一樣。 */
export async function BillingStatusBadge({ status }: Readonly<{ status: BillingItemStatus }>) {
  const t = await getTranslations("billing.status");
  return (
    <Badge variant={variant[status]} className={cn(extraClass[status])}>
      {t(status)}
    </Badge>
  );
}

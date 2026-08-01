import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { BillingItemStatus } from "@/db/queries";

/** 看板與合約頁共用的狀態顯示，確保同一個狀態在哪裡看都長一樣。 */
export const billingStatusLabel: Record<BillingItemStatus, string> = {
  upcoming: "未到期",
  due: "該請款",
  billed: "已請款待收",
  partial: "部分收款",
  paid: "已收款",
  overdue: "逾期未收",
};

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

export function BillingStatusBadge({ status }: Readonly<{ status: BillingItemStatus }>) {
  return (
    <Badge variant={variant[status]} className={cn(extraClass[status])}>
      {billingStatusLabel[status]}
    </Badge>
  );
}

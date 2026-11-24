import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

const nf = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

/**
 * 金額主行（含稅應收）底下那行小字：「未稅 17,400＋稅 870」。沒有稅額就不顯示 ——
 * 零稅率／免稅／不加收的列只有一個數字，多一行等於重複。
 */
export function TaxBreakdown({
  net,
  tax,
  className,
}: Readonly<{ net: number | null; tax: number | null; className?: string }>) {
  const t = useTranslations("common.tax");
  if (net == null || tax == null || tax <= 0) return null;
  return (
    <div className={cn("text-xs text-muted-foreground tabular-nums", className)}>
      {t("breakdown", { net: nf.format(net), tax: nf.format(tax) })}
    </div>
  );
}

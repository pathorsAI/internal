import { Globe } from "lucide-react";
import { cn } from "@/lib/utils";
import { currencyFlag } from "@/lib/currency";

/**
 * 幣別國旗小圖示。國旗檔在 public/flags/<國家>.svg（沿用 main-app 的那套）。
 * 對應關係定義在 @/lib/currency 的 CURRENCIES；查不到就退回地球圖示。
 */
export function CurrencyFlag({
  currency,
  className,
}: Readonly<{ currency: string; className?: string }>) {
  const flag = currencyFlag(currency);
  if (!flag) {
    return <Globe className={cn("size-4 shrink-0 text-muted-foreground", className)} />;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`/flags/${encodeURIComponent(flag)}.svg`}
      alt={currency}
      className={cn("h-4 w-auto shrink-0 rounded-[3px] ring-1 ring-black/5", className)}
    />
  );
}

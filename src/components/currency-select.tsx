"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CurrencyFlag } from "@/components/currency-flag";
import { CURRENCIES, DEFAULT_CURRENCY, currencyLabel } from "@/lib/currency";

/**
 * 共用幣別下拉選單。選項來自 @/lib/currency 的 CURRENCIES，
 * 新增幣別只要改那份清單，這裡與所有用到的表單都會自動跟上。
 */
export function CurrencySelect({
  name = "currency",
  defaultValue = DEFAULT_CURRENCY,
  id,
}: Readonly<{ name?: string; defaultValue?: string; id?: string }>) {
  return (
    <Select name={name} defaultValue={defaultValue}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {CURRENCIES.map((c) => (
          <SelectItem key={c.code} value={c.code}>
            <span className="flex items-center gap-2">
              <CurrencyFlag currency={c.code} />
              {currencyLabel(c.code)}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

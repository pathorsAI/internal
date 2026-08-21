"use client";

import { useTranslations } from "next-intl";
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
  onValueChange,
}: Readonly<{
  name?: string;
  defaultValue?: string;
  id?: string;
  /** 選到幣別時通知外層（連動預覽用） */
  onValueChange?: (code: string) => void;
}>) {
  const t = useTranslations("common");
  // 幣別名稱固定登記在 common.currency.<CODE>；用明確的 key 逐一取值，
  // 避免對 CURRENCIES（型別是 string）做動態組 key 查表。
  const currencyNames: Record<string, string> = {
    TWD: t("currency.TWD"),
    USD: t("currency.USD"),
    EUR: t("currency.EUR"),
    JPY: t("currency.JPY"),
    CNY: t("currency.CNY"),
  };
  return (
    <Select name={name} defaultValue={defaultValue} onValueChange={onValueChange}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {CURRENCIES.map((c) => (
          <SelectItem key={c.code} value={c.code}>
            <span className="flex items-center gap-2">
              <CurrencyFlag currency={c.code} />
              {currencyLabel(c.code, currencyNames[c.code])}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

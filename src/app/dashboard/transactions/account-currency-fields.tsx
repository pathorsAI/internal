"use client";

import { useTranslations } from "next-intl";
import { Field } from "@/components/form-field";
import { CurrencyFlag } from "@/components/currency-flag";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type AccountOption = { id: number; name: string; currency: string };

/** 依 id 找出帳戶幣別；沒選或找不到就回 null。 */
export function accountCurrency(
  accounts: readonly AccountOption[],
  id: string | number | null | undefined,
): string | null {
  if (id === null || id === undefined || id === "") return null;
  return accounts.find((a) => String(a.id) === String(id))?.currency ?? null;
}

/**
 * 帳戶下拉，跟 SelectField 一樣的排版，但把選到的值回報給外層 ——
 * 幣別欄位要跟著帳戶連動，所以這裡必須是受控的。
 */
export function AccountSelectField({
  name,
  label,
  accounts,
  value,
  onChange,
  wide,
}: Readonly<{
  name: string;
  label: string;
  accounts: readonly AccountOption[];
  value: string;
  onChange: (v: string) => void;
  wide?: boolean;
}>) {
  const t = useTranslations("transactions");
  return (
    <Field label={label} required wide={wide}>
      <Select name={name} required value={value} onValueChange={onChange}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder={t("form.accountPlaceholder")} />
        </SelectTrigger>
        <SelectContent>
          {accounts.map((a) => (
            <SelectItem key={a.id} value={String(a.id)}>
              {a.name} ({a.currency})
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

/**
 * 唯讀的幣別欄位：值由所選帳戶決定，使用者不能自己挑。
 *
 * 交易的幣別必須等於它所屬帳戶的幣別（後端 src/lib/account-currency.ts 會再擋一次，
 * 這裡只是讓人一開始就選不錯）。還沒選帳戶時不送出 currency，讓後端照既有規則
 * 先回報「請選擇帳戶」。
 */
export function LockedCurrencyField({
  currency,
  original,
  name = "currency",
}: Readonly<{
  currency: string | null;
  /** 編輯既有交易時的原幣別；跟帳戶幣別不符（舊髒資料）就明講會被改掉。 */
  original?: string;
  name?: string;
}>) {
  const t = useTranslations("transactions");
  // 有值就代表「原幣別跟帳戶對不起來」，同時把兩個已收窄的字串一起帶出去 ——
  // 這樣下面不需要 `original!` 這種斷言（Sonar S4325 會把它標成多餘）。
  const drift = currency && original && original !== currency ? { original, currency } : null;
  return (
    <Field label={t("form.currency")}>
      <div className="flex h-9 items-center gap-2 rounded-md border bg-muted px-3 text-sm">
        {currency ? (
          <>
            <CurrencyFlag currency={currency} />
            <span className="tabular-nums">{currency}</span>
          </>
        ) : (
          <span className="text-muted-foreground">{t("form.currencyPickAccount")}</span>
        )}
      </div>
      {currency ? <input type="hidden" name={name} value={currency} /> : null}
      <p className={drift ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>
        {drift
          ? t("form.currencyWasMismatched", drift)
          : t("form.currencyFollowsAccount")}
      </p>
    </Field>
  );
}

/** 轉帳兩腳幣別不同時的提示（後端會擋，這裡先講清楚為什麼）。 */
export function TransferCurrencyWarning({
  from,
  to,
}: Readonly<{ from: string | null; to: string | null }>) {
  const t = useTranslations("transactions");
  if (!from || !to || from === to) return null;
  return (
    <p className="text-xs text-destructive sm:col-span-2">
      {t("form.transferCurrencyMismatch", { from, to })}
    </p>
  );
}

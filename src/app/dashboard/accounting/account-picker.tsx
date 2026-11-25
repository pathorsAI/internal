"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { SearchSelect, type PickerOption } from "@/app/dashboard/vendor-billing/pickers";

/** 選科目要的最少欄位（server 傳過來的 GlAccount 子集）。 */
export type AccountOption = {
  id: number;
  code: string;
  name: string;
  type: string;
  isActive: boolean;
};

/**
 * 會計科目選擇器：可搜尋代碼或名稱。科目表通常六、七十個，用下拉清單找不到，一律用這支。
 * 停用的科目不出現在清單裡，但已經選著的照樣顯示。
 * noneLabel 給了就有「預設」那一項（值為 null），例如「預設：1113 銀行存款」。
 */
export function AccountPicker({
  id,
  accounts,
  value,
  onChange,
  types,
  noneLabel,
  disabled,
}: Readonly<{
  id?: string;
  accounts: AccountOption[];
  value: number | null;
  onChange: (value: number | null) => void;
  /** 只列這幾類科目 */
  types?: readonly string[];
  noneLabel?: string;
  disabled?: boolean;
}>) {
  const t = useTranslations("accounting");
  const options = React.useMemo<PickerOption[]>(
    () =>
      accounts
        .filter((a) => (a.isActive || a.id === value) && (!types || types.includes(a.type)))
        .map((a) => ({
          value: String(a.id),
          label: `${a.code} ${a.name}`,
          keywords: a.code,
        })),
    [accounts, types, value],
  );
  return (
    <SearchSelect
      id={id}
      options={options}
      value={value === null ? null : String(value)}
      onChange={(v) => onChange(v === null ? null : Number(v))}
      noneLabel={noneLabel}
      placeholder={t("common.pickAccount")}
      disabled={disabled}
    />
  );
}

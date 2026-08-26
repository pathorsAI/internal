"use client";

import * as React from "react";
import { useTranslations } from "next-intl";

import { Combobox } from "@/components/combobox";

export type ContractOption = { id: number; label: string };

// 合約選擇器：可搜尋的下拉（合約之後會累積，select 不夠用）。
// 用 Combobox（Radix Popover portal）—— popup 掛在 document root，不會被 Sheet 的 modal 蓋住。
export function ContractCombobox({
  contracts,
  defaultId = null,
}: Readonly<{
  contracts: ContractOption[];
  defaultId?: number | null;
}>) {
  const t = useTranslations("transactions");
  const defaultLabel = contracts.find((c) => c.id === defaultId)?.label ?? "";
  const [value, setValue] = React.useState(defaultLabel);
  const labels = React.useMemo(() => contracts.map((c) => c.label), [contracts]);
  const matched = contracts.find((c) => c.label === value.trim());

  return (
    <>
      {/* 解析到的合約 id；選清單裡的項目才會有值 */}
      <input type="hidden" name="contractId" value={matched?.id ?? ""} />
      <Combobox
        items={labels}
        value={value}
        onValueChange={setValue}
        placeholder={t("combobox.contract.placeholder")}
        emptyText={t("combobox.contract.empty")}
      />
    </>
  );
}

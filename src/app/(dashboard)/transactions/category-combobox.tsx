"use client";

import * as React from "react";
import { useTranslations } from "next-intl";

import { Combobox } from "@/components/combobox";

export function CategoryCombobox({
  categories,
  defaultName = "",
}: Readonly<{
  categories: { id: number; name: string }[];
  defaultName?: string;
}>) {
  const t = useTranslations("transactions");
  const [value, setValue] = React.useState(defaultName);
  const names = React.useMemo(() => categories.map((c) => c.name), [categories]);
  const matched = categories.find((c) => c.name === value.trim());

  return (
    <>
      {/* 解析到的分類 id；選清單裡的項目才會有值 */}
      <input type="hidden" name="categoryId" value={matched?.id ?? ""} />
      <Combobox
        items={names}
        value={value}
        onValueChange={setValue}
        placeholder={t("combobox.category.placeholder")}
        emptyText={t("combobox.category.empty")}
      />
    </>
  );
}

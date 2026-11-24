"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Combobox } from "@/components/combobox";
import type { DerivedProjectStatus } from "@/lib/linking/project-status";

export type ProjectChoiceOption = { id: number; name: string; status?: DerivedProjectStatus };

/** 表單送出的值："new" | "none" | 專案 id；打了字沒選到清單項目送 "invalid"（伺服器會擋）。 */
export type ProjectChoiceValue = "new" | "none" | number;

/**
 * 合約的「歸屬專案」選擇器：可搜尋的下拉，選項是既有專案（附推導狀態），
 * 加上「新專案（同合約名）」與「不歸屬專案」兩個固定選項。
 * 解析到的值放在 hidden input `projectChoice`，由 createContract / updateContract /
 * 專案頁的指派動作解讀（src/db/project-choice.ts）。
 */
export function ProjectChoiceField({
  projects,
  defaultChoice,
  includeNone = true,
  newLabel,
  name = "projectChoice",
  id,
  className,
  onChoiceChange,
}: Readonly<{
  projects: ProjectChoiceOption[];
  defaultChoice: ProjectChoiceValue | null;
  includeNone?: boolean;
  /** 「新專案」那一項的文字；預設「新專案（同合約名）」 */
  newLabel?: string;
  name?: string;
  id?: string;
  className?: string;
  /** 解析後的值變動時通知（給「沒選好就不能送出」的按鈕用） */
  onChoiceChange?: (submitted: string) => void;
}>) {
  const t = useTranslations("projects");

  const options = React.useMemo(() => {
    const counts = new Map<string, number>();
    for (const p of projects) counts.set(p.name, (counts.get(p.name) ?? 0) + 1);
    const list: { value: ProjectChoiceValue; label: string }[] = [
      { value: "new", label: newLabel ?? t("choice.new") },
    ];
    if (includeNone) list.push({ value: "none", label: t("choice.none") });
    for (const p of projects) {
      // 同名專案加上 #id 區分，不然選了也對不回唯一一筆
      const base = (counts.get(p.name) ?? 0) > 1 ? `${p.name} #${p.id}` : p.name;
      const statusKey = p.status ? (`derivedStatus.${p.status}` as const) : null;
      const label = statusKey ? `${base}（${t(statusKey)}）` : base;
      list.push({ value: p.id, label });
    }
    return list;
  }, [projects, includeNone, newLabel, t]);

  const defaultLabel =
    defaultChoice === null ? "" : (options.find((o) => o.value === defaultChoice)?.label ?? "");
  const [text, setText] = React.useState(defaultLabel);
  const labels = React.useMemo(() => options.map((o) => o.label), [options]);
  const matched = options.find((o) => o.label === text.trim());
  let submitted = "";
  if (matched) submitted = String(matched.value);
  else if (text.trim() !== "") submitted = "invalid";

  React.useEffect(() => {
    onChoiceChange?.(submitted);
  }, [submitted, onChoiceChange]);

  return (
    <>
      <input type="hidden" name={name} value={submitted} />
      <Combobox
        id={id}
        className={className}
        items={labels}
        value={text}
        onValueChange={setText}
        placeholder={t("choice.placeholder")}
        emptyText={t("choice.empty")}
      />
    </>
  );
}

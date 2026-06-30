"use client";

import * as React from "react";
import { Check, Plus } from "lucide-react";

import { Combobox } from "@/components/combobox";

export function PartyCombobox({
  parties,
  name = "partyName",
  placeholder = "輸入或選擇…",
  defaultName = "",
}: Readonly<{
  parties: { id: number; name: string }[];
  name?: string;
  placeholder?: string;
  defaultName?: string;
}>) {
  const [value, setValue] = React.useState(defaultName);
  const names = React.useMemo(() => parties.map((p) => p.name), [parties]);
  const trimmed = value.trim();
  const exists = names.some((n) => n.toLowerCase() === trimmed.toLowerCase());

  return (
    <div className="space-y-1">
      {/* inputName=name：打的文字直接以該 name 送出，查無對象時於儲存時新建 */}
      <Combobox
        items={names}
        value={value}
        onValueChange={setValue}
        inputName={name}
        placeholder={placeholder}
        emptyText="查無此對象，儲存後會自動新增"
      />

      {trimmed &&
        (exists ? (
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            <Check className="size-3" /> 已存在，將連結到既有的「{trimmed}」
          </p>
        ) : (
          <p className="flex items-center gap-1 text-xs text-amber-600">
            <Plus className="size-3" /> 系統中沒有，儲存時會新增「{trimmed}」
          </p>
        ))}
    </div>
  );
}

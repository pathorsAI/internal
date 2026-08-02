"use client";

import * as React from "react";
import { Check, Plus } from "lucide-react";

import { Combobox } from "@/components/combobox";
import { Label } from "@/components/ui/label";
import { Req } from "@/components/req";

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

/**
 * 「客戶 / 對象」欄的完整一格：標籤 + 可自由輸入的對象選擇器。
 *
 * 合約、訂閱、專案、請款項目、發票的新增與編輯共 8 張表單都長一模一樣，
 * 各自複製一份的話，日後要調整提示文案或版面就得改八個地方。
 */
export function PartyField({
  parties,
  name,
  label = "客戶",
  required = false,
  defaultName = "",
  placeholder,
}: Readonly<{
  parties: { id: number; name: string }[];
  name: string;
  label?: string;
  required?: boolean;
  defaultName?: string;
  /** 不給就依 label 與是否必填自動組出來 */
  placeholder?: string;
}>) {
  return (
    <div className="space-y-1.5">
      <Label>
        {label}
        {required && <Req />}
      </Label>
      <PartyCombobox
        parties={parties}
        name={name}
        defaultName={defaultName}
        placeholder={placeholder ?? `輸入或選擇${label}${required ? "" : "（選填）"}…`}
      />
    </div>
  );
}

"use client";

import * as React from "react";
import { Check, Plus } from "lucide-react";
import { Autocomplete } from "@base-ui/react/autocomplete";

const inputCls =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

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
      <Autocomplete.Root items={names} value={value} onValueChange={setValue} openOnInputClick>
        <Autocomplete.Input
          name={name}
          placeholder={placeholder}
          className={inputCls}
          autoComplete="off"
        />
        <Autocomplete.Portal>
          <Autocomplete.Positioner className="z-50 outline-none" sideOffset={4}>
            <Autocomplete.Popup className="max-h-64 w-(--anchor-width) overflow-y-auto rounded-md bg-popover p-1 text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10">
              <Autocomplete.Empty className="px-2 py-1.5 text-muted-foreground">
                查無此對象，儲存後會自動新增
              </Autocomplete.Empty>
              <Autocomplete.List>
                {(item: string) => (
                  <Autocomplete.Item
                    key={item}
                    value={item}
                    className="cursor-default rounded-sm px-2 py-1.5 outline-none data-highlighted:bg-accent data-highlighted:text-accent-foreground"
                  >
                    {item}
                  </Autocomplete.Item>
                )}
              </Autocomplete.List>
            </Autocomplete.Popup>
          </Autocomplete.Positioner>
        </Autocomplete.Portal>
      </Autocomplete.Root>

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

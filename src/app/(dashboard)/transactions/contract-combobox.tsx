"use client";

import * as React from "react";
import { Autocomplete } from "@base-ui/react/autocomplete";

const inputCls =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

export type ContractOption = { id: number; label: string };

// 合約選擇器：可搜尋的下拉（合約之後會累積，select 不夠用）。沿用 category-combobox
// 的 Autocomplete.Portal 寫法 —— popup 掛在 document root，不會被 Sheet 的 modal 蓋住。
export function ContractCombobox({
  contracts,
  defaultId = null,
}: Readonly<{
  contracts: ContractOption[];
  defaultId?: number | null;
}>) {
  const defaultLabel = contracts.find((c) => c.id === defaultId)?.label ?? "";
  const [value, setValue] = React.useState(defaultLabel);
  const labels = React.useMemo(() => contracts.map((c) => c.label), [contracts]);
  const matched = contracts.find((c) => c.label === value.trim());

  return (
    <>
      {/* 解析到的合約 id；選清單裡的項目才會有值 */}
      <input type="hidden" name="contractId" value={matched?.id ?? ""} />
      <Autocomplete.Root items={labels} value={value} onValueChange={setValue} openOnInputClick>
        <Autocomplete.Input
          placeholder="搜尋或選擇合約（選填）…"
          className={inputCls}
          autoComplete="off"
        />
        <Autocomplete.Portal>
          <Autocomplete.Positioner className="z-50 outline-none" sideOffset={4}>
            <Autocomplete.Popup className="max-h-64 w-(--anchor-width) overflow-y-auto rounded-md bg-popover p-1 text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10">
              <Autocomplete.Empty className="px-2 py-1.5 text-muted-foreground">
                查無合約
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
    </>
  );
}

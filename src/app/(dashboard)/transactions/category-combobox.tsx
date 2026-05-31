"use client";

import * as React from "react";
import { Autocomplete } from "@base-ui/react/autocomplete";

const inputCls =
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

export function CategoryCombobox({
  categories,
  defaultName = "",
}: Readonly<{
  categories: { id: number; name: string }[];
  defaultName?: string;
}>) {
  const [value, setValue] = React.useState(defaultName);
  const names = React.useMemo(() => categories.map((c) => c.name), [categories]);
  const matched = categories.find((c) => c.name === value.trim());

  return (
    <>
      {/* 解析到的分類 id；選清單裡的項目才會有值 */}
      <input type="hidden" name="categoryId" value={matched?.id ?? ""} />
      <Autocomplete.Root items={names} value={value} onValueChange={setValue} openOnInputClick>
        <Autocomplete.Input
          placeholder="搜尋或選擇分類（選填）…"
          className={inputCls}
          autoComplete="off"
        />
        <Autocomplete.Portal>
          <Autocomplete.Positioner className="z-50 outline-none" sideOffset={4}>
            <Autocomplete.Popup className="max-h-64 w-(--anchor-width) overflow-y-auto rounded-md bg-popover p-1 text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10">
              <Autocomplete.Empty className="px-2 py-1.5 text-muted-foreground">
                查無分類
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

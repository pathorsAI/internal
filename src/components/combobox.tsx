"use client";

import * as React from "react";
import { Popover as PopoverPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";

/**
 * 可自由輸入的下拉選擇器（free-text combobox）。
 *
 * 取代原本的 Base UI `Autocomplete`：Radix 沒有 autocomplete primitive，這裡用
 * Radix Popover 做 portal 定位（不會被 Sheet / Dialog 的 modal 蓋住），純 <input>
 * 當 anchor，焦點全程留在輸入框、清單用 onMouseDown 選取以避免 blur 先關閉。
 *
 * 放在 `components/ui` 之外，讓 `components/ui` 維持原廠 shadcn、可持續用 CLI 更新。
 *
 * - 使用者可以打任意文字（value 為來源）；選清單項目只是把 value 設成該項目。
 * - 傳 `inputName` 時，輸入框本身會以該 name 送出打的文字（給「查無就新建」的情境）。
 */
export function Combobox({
  items,
  value,
  onValueChange,
  placeholder,
  emptyText = "查無項目",
  inputName,
  className,
  id,
}: Readonly<{
  items: string[];
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  emptyText?: string;
  inputName?: string;
  className?: string;
  id?: string;
}>) {
  const [open, setOpen] = React.useState(false);
  const [activeIndex, setActiveIndex] = React.useState(-1);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const listboxId = React.useId();

  const filtered = React.useMemo(() => {
    const q = value.trim().toLowerCase();
    if (!q) return items;
    return items.filter((item) => item.toLowerCase().includes(q));
  }, [items, value]);

  function commit(item: string) {
    onValueChange(item);
    setActiveIndex(-1);
    setOpen(false);
    inputRef.current?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      setActiveIndex((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      if (open && activeIndex >= 0 && activeIndex < filtered.length) {
        // 有高亮項目才攔截 Enter 去選取；否則交給表單預設行為（送出）
        e.preventDefault();
        commit(filtered[activeIndex]);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Anchor asChild>
        <input
          ref={inputRef}
          id={id}
          name={inputName}
          value={value}
          placeholder={placeholder}
          autoComplete="off"
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
          className={cn(
            "flex h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30",
            className,
          )}
          onChange={(e) => {
            onValueChange(e.target.value);
            setActiveIndex(-1);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onKeyDown={handleKeyDown}
        />
      </PopoverPrimitive.Anchor>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          id={listboxId}
          align="start"
          sideOffset={4}
          role="listbox"
          // 焦點留在輸入框，不讓 popup 搶 focus
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
          className="z-50 max-h-64 w-[var(--radix-popover-trigger-width)] overflow-y-auto rounded-md border bg-popover p-1 text-sm text-popover-foreground shadow-md outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0"
        >
          {filtered.length === 0 ? (
            <div className="px-2 py-1.5 text-muted-foreground">{emptyText}</div>
          ) : (
            filtered.map((item, idx) => (
              <div
                key={item}
                role="option"
                aria-selected={idx === activeIndex}
                className={cn(
                  "cursor-default rounded-sm px-2 py-1.5 outline-none",
                  idx === activeIndex && "bg-accent text-accent-foreground",
                )}
                onMouseEnter={() => setActiveIndex(idx)}
                onMouseDown={(e) => {
                  // 避免 input blur 先關閉 popup
                  e.preventDefault();
                  commit(item);
                }}
              >
                {item}
              </div>
            ))
          )}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}

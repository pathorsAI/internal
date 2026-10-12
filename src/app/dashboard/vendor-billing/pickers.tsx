"use client";

import * as React from "react";
import { Check, ChevronsUpDown, Plus, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// 可搜尋的「從既有項目挑」選擇器（單選 / 多選）。跟 components/combobox.tsx 不同：
// 這裡不能自由輸入新值，只能挑清單裡已有的（交易對象、付款方式都要對到 id）。

export type PickerOption = {
  value: string;
  label: string;
  /** 清單裡顯示在 label 右邊的小字（例如卡的到期） */
  hint?: React.ReactNode;
  /** 額外可搜尋的文字 */
  keywords?: string;
};

function OptionList({
  options,
  selected,
  onPick,
  noneLabel,
}: Readonly<{
  options: PickerOption[];
  selected: ReadonlySet<string>;
  onPick: (value: string | null) => void;
  /** 給了就在最上面多一個「未設定」 */
  noneLabel?: string;
}>) {
  const t = useTranslations("vendorBilling");
  const [q, setQ] = React.useState("");
  const [active, setActive] = React.useState(0);
  const listId = React.useId();

  const filtered = React.useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = needle
      ? options.filter((o) => `${o.label} ${o.keywords ?? ""}`.toLowerCase().includes(needle))
      : options;
    // 「未設定」只在沒打字時出現，打字就是在找某一項
    return noneLabel && !needle ? [{ value: "", label: noneLabel } as PickerOption, ...list] : list;
  }, [options, q, noneLabel]);

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const o = filtered[active];
      if (o) onPick(o.value === "" ? null : o.value);
    }
  }

  return (
    <div className="flex flex-col">
      <input
        autoFocus
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setActive(0);
        }}
        onKeyDown={onKeyDown}
        placeholder={t("picker.search")}
        role="combobox"
        aria-expanded
        aria-controls={listId}
        className="h-9 border-b bg-transparent px-3 text-sm outline-none placeholder:text-muted-foreground"
      />
      <div id={listId} role="listbox" className="max-h-64 overflow-y-auto p-1">
        {filtered.length === 0 ? (
          <div className="px-2 py-1.5 text-sm text-muted-foreground">{t("picker.noResults")}</div>
        ) : (
          filtered.map((o, idx) => (
            <div
              key={o.value || "__none"}
              role="option"
              tabIndex={-1}
              aria-selected={selected.has(o.value)}
              className={cn(
                "flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none",
                idx === active && "bg-accent text-accent-foreground",
                o.value === "" && "text-muted-foreground",
              )}
              onMouseEnter={() => setActive(idx)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onPick(o.value === "" ? null : o.value)}
            >
              <Check className={cn("size-4 shrink-0", selected.has(o.value) ? "opacity-100" : "opacity-0")} />
              <span className="min-w-0 flex-1 truncate">{o.label}</span>
              {o.hint ? <span className="shrink-0 text-xs text-muted-foreground">{o.hint}</span> : null}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

/** 單選：值是 option.value 或 null（未設定）。 */
export function SearchSelect({
  id,
  options,
  value,
  onChange,
  disabled,
  noneLabel,
  placeholder,
}: Readonly<{
  id?: string;
  options: PickerOption[];
  value: string | null;
  onChange: (value: string | null) => void;
  disabled?: boolean;
  noneLabel?: string;
  placeholder?: string;
}>) {
  const t = useTranslations("vendorBilling");
  const [open, setOpen] = React.useState(false);
  const current = value === null ? null : options.find((o) => o.value === value);
  const selected = React.useMemo(() => new Set([value ?? ""]), [value]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          disabled={disabled}
          className="flex h-9 w-full min-w-0 items-center justify-between gap-2 rounded-md border border-input bg-transparent px-3 py-2 text-left text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30"
        >
          {current ? (
            <span className="flex min-w-0 items-center gap-2">
              <span className="truncate">{current.label}</span>
              {current.hint ? <span className="shrink-0 text-xs text-muted-foreground">{current.hint}</span> : null}
            </span>
          ) : (
            <span className="truncate text-muted-foreground">
              {value === null && noneLabel ? noneLabel : (placeholder ?? t("picker.placeholder"))}
            </span>
          )}
          <ChevronsUpDown className="size-4 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] min-w-64 p-0">
        <OptionList
          options={options}
          selected={selected}
          noneLabel={noneLabel}
          onPick={(v) => {
            onChange(v);
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

/** 多選：已選的顯示成 chip（可移除），旁邊一顆「加入」打開清單。 */
export function MultiSearchSelect({
  options,
  values,
  onChange,
  disabled,
  addLabel,
  removeLabel,
}: Readonly<{
  options: PickerOption[];
  values: string[];
  onChange: (values: string[]) => void;
  disabled?: boolean;
  addLabel: string;
  removeLabel: (name: string) => string;
}>) {
  const [open, setOpen] = React.useState(false);
  const byValue = React.useMemo(() => new Map(options.map((o) => [o.value, o])), [options]);
  const remaining = React.useMemo(() => options.filter((o) => !values.includes(o.value)), [options, values]);
  const none = React.useMemo(() => new Set<string>(), []);

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {values.map((v) => {
        const name = byValue.get(v)?.label ?? v;
        return (
          <span
            key={v}
            className="inline-flex h-7 items-center gap-1 rounded-md border bg-muted/40 pr-1 pl-2 text-sm"
          >
            {name}
            {disabled ? null : (
              <button
                type="button"
                aria-label={removeLabel(name)}
                className="rounded-sm p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                onClick={() => onChange(values.filter((x) => x !== v))}
              >
                <X className="size-3.5" />
              </button>
            )}
          </span>
        );
      })}
      {disabled ? null : (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button type="button" variant="outline" size="sm" className="h-7">
              <Plus className="size-3.5" /> {addLabel}
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-72 p-0">
            <OptionList
              options={remaining}
              selected={none}
              onPick={(v) => {
                if (v) onChange([...values, v]);
                setOpen(false);
              }}
            />
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}

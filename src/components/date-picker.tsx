"use client";

import * as React from "react";
import { CalendarIcon } from "lucide-react";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function toISO(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function DatePicker({
  name,
  defaultValue,
  placeholder = "選擇日期",
  allowEmpty = false,
  onValueChange,
}: Readonly<{
  name: string;
  /** YYYY-MM-DD */
  defaultValue?: string;
  placeholder?: string;
  allowEmpty?: boolean;
  /** 選到日期時通知外層（hidden input 不會發 input 事件，要靠這個做連動預覽） */
  onValueChange?: (iso: string) => void;
}>) {
  const [date, setDate] = React.useState<Date | undefined>(() => {
    if (defaultValue) return new Date(`${defaultValue}T00:00:00`);
    return allowEmpty ? undefined : new Date();
  });
  const [open, setOpen] = React.useState(false);
  const iso = date ? toISO(date) : "";

  return (
    <>
      <input type="hidden" name={name} value={iso} />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            className={cn(
              "w-full justify-start text-left font-normal",
              !date && "text-muted-foreground",
            )}
          >
            <CalendarIcon className="mr-2 size-4" />
            {iso || placeholder}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={date}
            onSelect={(d) => {
              setDate(d);
              setOpen(false);
              onValueChange?.(d ? toISO(d) : "");
            }}
            autoFocus
          />
        </PopoverContent>
      </Popover>
    </>
  );
}

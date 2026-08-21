"use client";

import type { ComponentProps, ReactNode } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Req } from "@/components/req";
import {
  Select,
  SelectContent,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

/**
 * 表單裡「一個標籤配一個控制項」的固定排版。
 *
 * 這三行（外框 space-y-1.5、Label、控制項）在十幾張表單裡各抄一次，欄位一多就
 * 開始出現對不齊的變體。收成一個元件之後，要調間距或必填星號只要改一個地方。
 * `wide` 代表在兩欄格線裡橫跨整列。
 */
export function Field({
  label,
  htmlFor,
  required,
  wide,
  className,
  children,
}: Readonly<{
  label: ReactNode;
  htmlFor?: string;
  required?: boolean;
  wide?: boolean;
  className?: string;
  children: ReactNode;
}>) {
  return (
    <div className={cn("space-y-1.5", wide && "sm:col-span-2", className)}>
      <Label htmlFor={htmlFor}>
        {label}
        {required ? <Req /> : null}
      </Label>
      {children}
    </div>
  );
}

/** 文字／數字輸入格。其餘 props 直接透傳給底層的 Input。 */
export function TextField({
  name,
  label,
  required,
  wide,
  className,
  ...input
}: Readonly<
  {
    name: string;
    label: ReactNode;
    wide?: boolean;
    className?: string;
  } & Omit<ComponentProps<typeof Input>, "name" | "id">
>) {
  return (
    <Field label={label} htmlFor={name} required={required} wide={wide} className={className}>
      <Input id={name} name={name} required={required} {...input} />
    </Field>
  );
}

/** 下拉選單格。選項用 children 傳，因為每張表單的選項來源都不一樣。 */
export function SelectField({
  name,
  label,
  required,
  wide,
  className,
  defaultValue,
  placeholder,
  children,
}: Readonly<{
  name: string;
  label: ReactNode;
  required?: boolean;
  wide?: boolean;
  className?: string;
  defaultValue?: string;
  placeholder?: string;
  children: ReactNode;
}>) {
  return (
    <Field label={label} required={required} wide={wide} className={className}>
      <Select name={name} defaultValue={defaultValue} required={required}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>{children}</SelectContent>
      </Select>
    </Field>
  );
}

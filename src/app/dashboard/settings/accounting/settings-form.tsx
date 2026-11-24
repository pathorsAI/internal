"use client";

import * as React from "react";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Field } from "@/components/form-field";
import { DatePicker } from "@/components/date-picker";
import { SearchSelect } from "@/app/dashboard/vendor-billing/pickers";
import { AccountPicker, type AccountOption } from "@/app/dashboard/accounting/account-picker";
import { saveAccountingSettings } from "@/db/ledger-mutations";
import type { AccountingSettings, VatRegime } from "@/lib/ledger/types";

const VAT_REGIMES: VatRegime[] = ["general", "small_scale", "none"];
const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);
const EQUITY = ["equity"] as const;

export function AccountingSettingsForm({
  settings,
  canManage,
  jurisdictionLocked,
  jurisdictions,
  frameworks,
  accounts,
  capital,
}: Readonly<{
  settings: AccountingSettings;
  canManage: boolean;
  jurisdictionLocked: boolean;
  jurisdictions: string[];
  frameworks: { code: string; label: string }[];
  accounts: AccountOption[];
  capital: { code: string; name: string } | null;
}>) {
  const t = useTranslations("accounting");
  const router = useRouter();
  const [form, setForm] = React.useState(settings);
  const [pending, start] = useTransition();
  // DatePicker 自己記著選到的日期；按取消時換 key 讓它重新從 defaultValue 開始
  const [resetKey, setResetKey] = React.useState(0);
  const set = <K extends keyof AccountingSettings>(k: K, v: AccountingSettings[K]) =>
    setForm((prev) => ({ ...prev, [k]: v }));
  const dirty = (Object.keys(settings) as (keyof AccountingSettings)[]).some((k) => settings[k] !== form[k]);
  const jurisdictionLabel = (code: string) => (code === "TW" ? t("jurisdiction.TW") : code);

  function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    start(async () => {
      const res = await saveAccountingSettings({
        jurisdiction: form.jurisdiction,
        framework: form.framework,
        vatRegime: form.vatRegime,
        fiscalYearStartMonth: form.fiscalYearStartMonth,
        booksStartDate: form.booksStartDate || null,
        openingEquityAccountId: form.openingEquityAccountId,
      });
      if (res.ok) {
        toast.success(t("settings.form.saved"));
        router.refresh();
      } else {
        toast.error(res.error ?? t("errors.saveFailed"));
      }
    });
  }

  const disabled = !canManage || pending;
  return (
    <Card>
      <form onSubmit={save} className="flex flex-col gap-6">
        <CardHeader>
          <CardTitle>{t("settings.form.title")}</CardTitle>
          <CardDescription>
            {canManage ? t("settings.form.description") : t("common.readOnly")}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label={t("settings.form.jurisdiction")} htmlFor="gl-jurisdiction">
            <SearchSelect
              id="gl-jurisdiction"
              options={jurisdictions.map((c) => ({ value: c, label: jurisdictionLabel(c), keywords: c }))}
              value={form.jurisdiction}
              onChange={(v) => v && set("jurisdiction", v)}
              disabled={disabled || jurisdictionLocked}
            />
            {jurisdictionLocked ? (
              <p className="text-xs text-muted-foreground">{t("settings.form.jurisdictionLocked")}</p>
            ) : null}
          </Field>
          <Field label={t("settings.form.framework")}>
            <Select value={form.framework} onValueChange={(v) => set("framework", v)} disabled={disabled}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {frameworks.map((f) => (
                  <SelectItem key={f.code} value={f.code}>
                    {f.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t("settings.form.vatRegime")}>
            <Select value={form.vatRegime} onValueChange={(v) => set("vatRegime", v as VatRegime)} disabled={disabled}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {VAT_REGIMES.map((r) => (
                  <SelectItem key={r} value={r}>
                    {t(`vatRegime.${r}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t("settings.form.fiscalYearStart")}>
            <Select
              value={String(form.fiscalYearStartMonth)}
              onValueChange={(v) => set("fiscalYearStartMonth", Number(v))}
              disabled={disabled}
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MONTHS.map((m) => (
                  <SelectItem key={m} value={String(m)}>
                    {t("month", { month: m })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label={t("settings.form.functionalCurrency")} htmlFor="gl-functional-currency">
            <Input id="gl-functional-currency" value={form.functionalCurrency} readOnly disabled />
            <p className="text-xs text-muted-foreground">{t("settings.form.functionalCurrencyHint")}</p>
          </Field>
          <Field label={t("settings.form.booksStart")}>
            {disabled ? (
              <Input value={form.booksStartDate ?? t("settings.form.booksStartPlaceholder")} readOnly disabled />
            ) : (
              <DatePicker
                key={resetKey}
                name="booksStartDate"
                defaultValue={form.booksStartDate ?? undefined}
                allowEmpty
                placeholder={t("settings.form.booksStartPlaceholder")}
                onValueChange={(iso) => set("booksStartDate", iso || null)}
              />
            )}
            <p className="text-xs text-muted-foreground">{t("settings.form.booksStartHint")}</p>
          </Field>
          <Field label={t("settings.form.openingEquity")} htmlFor="gl-opening-equity" wide>
            <AccountPicker
              id="gl-opening-equity"
              accounts={accounts}
              types={EQUITY}
              value={form.openingEquityAccountId}
              onChange={(v) => set("openingEquityAccountId", v)}
              noneLabel={capital ? t("common.defaultAccount", capital) : undefined}
              disabled={disabled}
            />
            <p className="text-xs text-muted-foreground">{t("settings.form.openingEquityHint")}</p>
          </Field>
        </CardContent>
        {canManage ? (
          <CardFooter className="justify-end gap-2">
            {dirty ? (
              <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => {
                  setForm(settings);
                  setResetKey((k) => k + 1);
                }}>
                {t("common.cancel")}
              </Button>
            ) : null}
            <Button type="submit" size="sm" disabled={pending || !dirty}>
              {pending ? t("common.saving") : t("common.save")}
            </Button>
          </CardFooter>
        ) : null}
      </form>
    </Card>
  );
}

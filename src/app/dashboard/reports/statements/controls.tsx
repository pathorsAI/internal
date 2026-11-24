"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { FileSpreadsheet, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { LedgerKind, Period } from "@/lib/ledger/types";
import { COMPARES, REPORTS, statementQuery, type CompareKey, type Preset, type PresetKey, type ReportKey } from "./params";
import { periodText } from "./labels";

/** 這幾張報表看的是期間；資產負債表與附註看的是某一天（期間的最後一天）。 */
const AS_OF_REPORTS: ReadonlySet<ReportKey> = new Set(["bs", "notes", "review"]);
const NO_COMPARE: ReadonlySet<ReportKey> = new Set(["eq", "tb", "vat", "review", "notes"]);

/**
 * 控制列：報表、期間、比較、帳別、匯出。全部寫進網址參數（server page 照參數重算），
 * 跟交易頁的篩選列同一個做法，連結可以直接分享給會計師。
 */
export function StatementControls({
  report,
  ledger,
  periodKey,
  period,
  compare,
  year,
  years,
  presets,
}: Readonly<{
  report: ReportKey;
  ledger: LedgerKind;
  periodKey: PresetKey | "custom";
  period: Period;
  compare: CompareKey;
  year: number;
  years: number[];
  presets: Preset[];
}>) {
  const t = useTranslations("statements");
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [from, setFrom] = useState(period.from);
  const [to, setTo] = useState(period.to);

  function push(changes: Record<string, string | null>) {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(changes)) {
      if (v === null || v === "") next.delete(k);
      else next.set(k, v);
    }
    const qs = next.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  const asOf = AS_OF_REPORTS.has(report);
  const query = statementQuery({ ledger, periodKey, period, compare, year });

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="min-w-0 overflow-x-auto">
        <Tabs value={report} onValueChange={(v) => push({ report: v })}>
          <TabsList className="h-8">
            {REPORTS.map((r) => (
              <TabsTrigger key={r} value={r} className="px-2.5 text-xs">
                {t(`reports.${r}`)}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Tabs value={ledger} onValueChange={(v) => push({ ledger: v === "government" ? null : v })}>
          <TabsList className="h-8">
            <TabsTrigger value="government" className="px-2.5 text-xs">
              {t("ledger.government")}
            </TabsTrigger>
            <TabsTrigger value="management" className="px-2.5 text-xs">
              {t("ledger.management")}
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {report === "vat" ? (
          <Select value={String(year)} onValueChange={(v) => push({ year: v })}>
            <SelectTrigger size="sm" className="w-32" aria-label={t("controls.year")}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {years.map((y) => (
                <SelectItem key={y} value={String(y)}>
                  {t("controls.yearLabel", { year: y })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <>
            <Select
              value={periodKey}
              onValueChange={(v) =>
                v === "custom"
                  ? push({ period: "custom", from: period.from, to: period.to })
                  : push({ period: v, from: null, to: null })
              }
            >
              <SelectTrigger size="sm" className="w-56" aria-label={t("controls.period")}>
                <SelectValue>
                  {asOf ? t("controls.asOf", { date: period.to }) : periodText(period)}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {presets.map((p) => (
                  <SelectItem key={p.key} value={p.key}>
                    <span>{t(`presets.${p.key}`)}</span>
                    <span className="ml-2 text-xs text-muted-foreground tabular-nums">
                      {asOf ? p.period.to : periodText(p.period)}
                    </span>
                  </SelectItem>
                ))}
                <SelectSeparator />
                <SelectItem value="custom">{t("presets.custom")}</SelectItem>
              </SelectContent>
            </Select>

            {periodKey === "custom" ? (
              <CustomRangeForm
                asOf={asOf}
                from={from}
                to={to}
                onFromChange={setFrom}
                onToChange={setTo}
                onApply={() => push({ period: "custom", from: asOf ? null : from, to })}
              />
            ) : null}

            {NO_COMPARE.has(report) ? null : (
              <Select value={compare} onValueChange={(v) => push({ compare: v === "none" ? null : v })}>
                <SelectTrigger size="sm" className="w-36" aria-label={t("controls.compare")}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {COMPARES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {t(`compare.${c}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </>
        )}

        <div className="ml-auto flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <a href={`/api/reports/statements/export?${query}`} download>
              <FileSpreadsheet /> {t("controls.excel")}
            </a>
          </Button>
          <Button asChild variant="outline" size="sm">
            <a href={`/dashboard/reports/statements/print?${query}`} target="_blank" rel="noopener">
              <Printer /> {t("controls.print")}
            </a>
          </Button>
        </div>
      </div>
    </div>
  );
}

/** 自訂期間：期間型報表填起訖，時點型報表（資產負債表等）只填截止日。 */
function CustomRangeForm({
  asOf,
  from,
  to,
  onFromChange,
  onToChange,
  onApply,
}: Readonly<{
  asOf: boolean;
  from: string;
  to: string;
  onFromChange: (v: string) => void;
  onToChange: (v: string) => void;
  onApply: () => void;
}>) {
  const t = useTranslations("statements");
  return (
    <form
      className="flex items-center gap-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        onApply();
      }}
    >
      {asOf ? null : (
        <Input
          type="date"
          value={from}
          onChange={(e) => onFromChange(e.target.value)}
          className="h-8 w-36 tabular-nums"
          aria-label={t("controls.from")}
        />
      )}
      {asOf ? null : <span className="text-muted-foreground">–</span>}
      <Input
        type="date"
        value={to}
        onChange={(e) => onToChange(e.target.value)}
        className="h-8 w-36 tabular-nums"
        aria-label={asOf ? t("controls.asOfLabel") : t("controls.to")}
      />
      <Button type="submit" variant="outline" size="sm">
        {t("controls.apply")}
      </Button>
    </form>
  );
}

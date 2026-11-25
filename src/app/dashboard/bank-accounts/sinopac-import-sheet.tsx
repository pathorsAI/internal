"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { FileUp, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Amount } from "@/components/amount";
import { StatusTag } from "@/components/ds/status-dot";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { PlannedLine, PlanCounts, SinopacPlan } from "@/db/bank-import";
import type { ImportAccountOption } from "@/lib/bank-import/sinopac";
import { applySinopacImportAction, previewSinopacImport, type SinopacPreview } from "./sinopac-import-actions";

const NONE = "none";

/** 會寫入資料庫的行。 */
function writes(l: PlannedLine): boolean {
  if (l.decision === "duplicate" || l.decision === "near_match") return false;
  return !(l.decision === "skip" && l.skipReason !== "correction_unpaired");
}

/** 預覽預設列出的行：會寫入的，加上要人看的（金額差一點、配不上只列出）。 */
function worthShowing(l: PlannedLine): boolean {
  return writes(l) || l.decision === "near_match" || l.skipReason === "left_unmatched";
}

function decisionTone(l: PlannedLine): "income" | "primary" | "neutral" | "warning" {
  if (l.decision === "match" || l.decision === "recover") return "income";
  if (l.decision === "create") return "primary";
  if (l.decision === "skip" || l.decision === "near_match") return "warning";
  return "neutral";
}

function formData(file: File, map: Record<string, number> | null, skipUnmatched: boolean): FormData {
  const fd = new FormData();
  fd.set("file", file);
  if (map) fd.set("map", JSON.stringify(map));
  if (skipUnmatched) fd.set("skipUnmatched", "1");
  return fd;
}

/**
 * 帳戶頁「匯入永豐明細」：選檔 → 先試算（不寫入）→ 確認帳戶對應與每一行的處理 → 按「匯入」才寫。
 * 只給 owner / admin 看到（server action 會再檢查一次）。
 */
export function SinopacImportButton() {
  const t = useTranslations("bankImport");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<SinopacPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [skipUnmatched, setSkipUnmatched] = useState(false);
  const [loading, startLoading] = useTransition();
  const [applying, startApplying] = useTransition();

  function runPreview(f: File, map: Record<string, number> | null, skip = skipUnmatched) {
    setError(null);
    startLoading(async () => {
      const res = await previewSinopacImport(formData(f, map, skip));
      if (res.ok) setPreview(res.result);
      else {
        setPreview(null);
        setError(res.error);
      }
    });
  }

  function onFile(f: File | null) {
    setFile(f);
    setPreview(null);
    if (f) runPreview(f, null);
  }

  function onMap(last4: string, value: string) {
    if (!file || !preview) return;
    const next = { ...preview.accountMap };
    if (value === NONE) delete next[last4];
    else next[last4] = Number(value);
    runPreview(file, next);
  }

  function onSkipUnmatched(v: boolean) {
    setSkipUnmatched(v);
    if (file) runPreview(file, preview?.accountMap ?? null, v);
  }

  function apply() {
    if (!file || !preview) return;
    startApplying(async () => {
      const res = await applySinopacImportAction(formData(file, preview.accountMap, skipUnmatched));
      if (!res.ok) {
        setError(res.error);
        return;
      }
      const w = res.result.written;
      toast.success(t("applied", { matched: w.matched, created: w.created, pairs: w.correctionPair }));
      if (res.result.failures.length > 0) {
        toast.error(
          t("appliedWithFailures", {
            count: res.result.failures.length,
            list: res.result.failures
              .slice(0, 5)
              .map((f) => `#${f.lineNo} ${f.message}`)
              .join("；"),
          }),
        );
      }
      setOpen(false);
      setFile(null);
      setPreview(null);
      router.refresh();
    });
  }

  const busy = loading || applying;
  const plan = preview?.plan ?? null;
  const writeCount = plan ? plan.lines.filter(writes).length : 0;

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        <FileUp className="size-4" /> {t("button")}
      </Button>
      <Sheet open={open} onOpenChange={(o) => !applying && setOpen(o)}>
        <SheetContent className="sm:max-w-3xl">
          <SheetHeader className="shrink-0">
            <SheetTitle>{t("title")}</SheetTitle>
            <SheetDescription>{t("description")}</SheetDescription>
          </SheetHeader>
          <div className="flex-1 space-y-5 overflow-y-auto px-4 pb-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="sinopac-file">{t("file")}</Label>
              <Input
                id="sinopac-file"
                type="file"
                accept=".csv,.tsv,.txt,.xlsx,text/csv,text/tab-separated-values,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                disabled={busy}
                onChange={(e) => onFile(e.target.files?.[0] ?? null)}
                className="cursor-pointer file:mr-2 file:cursor-pointer file:rounded file:border-0 file:bg-muted file:px-2 file:py-0.5 file:text-xs"
              />
              <p className="text-xs text-muted-foreground">{t("fileHint")}</p>
            </div>

            <div className="flex items-start gap-3">
              <Switch
                id="sinopac-skip-unmatched"
                checked={skipUnmatched}
                onCheckedChange={onSkipUnmatched}
                disabled={busy}
              />
              <div className="flex flex-col gap-0.5">
                <Label htmlFor="sinopac-skip-unmatched">{t("skipUnmatched.label")}</Label>
                <p className="text-xs text-muted-foreground">{t("skipUnmatched.hint")}</p>
              </div>
            </div>

            {loading ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> {t("loading")}
              </p>
            ) : null}
            {error ? (
              <div role="alert" className="space-y-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                <p>{error}</p>
                {file ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => runPreview(file, preview?.accountMap ?? null)}
                    disabled={busy}
                  >
                    {t("retry")}
                  </Button>
                ) : null}
              </div>
            ) : null}

            {plan && preview ? (
              <>
                <AccountMapping plan={plan} options={preview.options} map={preview.accountMap} onChange={onMap} disabled={busy} />
                <Counts counts={plan.counts} />
                <ParseErrors plan={plan} />
                <PreviewLines lines={showAll ? plan.lines : plan.lines.filter(worthShowing)} />
                <div className="flex items-center gap-2 text-sm">
                  <Button type="button" size="sm" variant="ghost" onClick={() => setShowAll((v) => !v)}>
                    {showAll ? t("filter.actionable") : t("filter.all", { count: plan.lines.length })}
                  </Button>
                </div>
              </>
            ) : null}
          </div>
          <SheetFooter className="flex-row justify-end">
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={applying}>
              {t("cancel")}
            </Button>
            <Button type="button" onClick={apply} disabled={busy || !plan || writeCount === 0}>
              {applying ? t("applying") : t("apply")}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}

function AccountMapping({
  plan,
  options,
  map,
  onChange,
  disabled,
}: Readonly<{
  plan: SinopacPlan;
  options: ImportAccountOption[];
  map: Record<string, number>;
  onChange: (last4: string, value: string) => void;
  disabled: boolean;
}>) {
  const t = useTranslations("bankImport");
  return (
    <section className="space-y-2">
      <h3 className="text-sm font-medium text-muted-foreground">{t("mapping.title")}</h3>
      <p className="text-xs text-muted-foreground">{t("mapping.hint")}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {plan.accounts.map((a) => {
          const items: Record<string, string> = {
            [NONE]: t("mapping.none"),
            ...Object.fromEntries(
              options.filter((o) => o.currency.trim() === a.currency).map((o) => [String(o.id), o.name]),
            ),
          };
          const value = map[a.last4] === undefined ? NONE : String(map[a.last4]);
          return (
            <div key={`${a.last4}:${a.currency}`} className="flex flex-col gap-1.5">
              <Label>{t("mapping.account", { last4: a.last4, currency: a.currency, count: a.count })}</Label>
              <Select value={value} onValueChange={(v) => onChange(a.last4, v)} disabled={disabled}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={t("mapping.placeholder")} />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(items).map(([v, l]) => (
                    <SelectItem key={v} value={v}>
                      {l}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {a.problem === "not_found" || a.problem === "currency_mismatch" ? (
                <span className="text-xs text-warning">{t(`mapping.problem.${a.problem}`)}</span>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function Counts({ counts }: Readonly<{ counts: PlanCounts }>) {
  const t = useTranslations("bankImport");
  const items: [string, number][] = [
    [t("counts.matched"), counts.matched],
    [t("counts.created"), counts.created],
    [t("counts.correctionPair"), counts.correctionPair],
    [t("counts.duplicate"), counts.duplicate],
    [t("counts.nearMatch"), counts.nearMatch],
    [t("counts.skipped"), counts.skipped],
  ];
  return (
    <dl className="grid grid-cols-3 gap-x-6 gap-y-2 sm:grid-cols-6">
      {items.map(([label, n]) => (
        <div key={label} className="flex flex-col">
          <dt className="text-xs text-muted-foreground">{label}</dt>
          <dd className="text-xl font-semibold tabular-nums">{n}</dd>
        </div>
      ))}
    </dl>
  );
}

function ParseErrors({ plan }: Readonly<{ plan: SinopacPlan }>) {
  const t = useTranslations("bankImport");
  if (plan.parseErrors.length === 0) return null;
  const list = plan.parseErrors
    .slice(0, 10)
    .map((e) => t("parseItem", { lineNo: e.lineNo, what: t(`parseCode.${e.code}`) }))
    .join("、");
  return (
    <p className="text-xs text-warning">
      {t("parseErrors", { count: plan.parseErrors.length, list })}
    </p>
  );
}

function decisionLabel(t: ReturnType<typeof useTranslations<"bankImport">>, l: PlannedLine): string {
  switch (l.decision) {
    case "match":
      return l.transactionIds
        ? t("decision.matchMulti", { count: l.transactionIds.length })
        : t("decision.match", { id: l.transactionId ?? 0 });
    case "near_match":
      return t("decision.near_match", { id: l.transactionId ?? 0, amount: l.nearAmount ?? "" });
    case "recover":
      return t("decision.recover", { id: l.transactionId ?? 0 });
    case "create":
      return t("decision.create");
    case "correction_pair":
      return t("decision.correction_pair", { line: l.partnerLineNo ?? 0 });
    case "duplicate":
      return l.duplicateInFile ? t("decision.duplicateInFile") : t("decision.duplicate");
    default:
      return t(`decision.skip.${l.skipReason ?? "unmapped"}`);
  }
}

function fillText(t: ReturnType<typeof useTranslations<"bankImport">>, l: PlannedLine): string | null {
  if (l.decision !== "match") return null;
  const fields = [l.fillMemo ? t("fillMemo") : null, l.fillRef ? t("fillRef") : null].filter(Boolean);
  return fields.length ? t("fillNote", { fields: fields.join("、") }) : t("fillNothing");
}

function PreviewLines({ lines }: Readonly<{ lines: PlannedLine[] }>) {
  const t = useTranslations("bankImport");
  if (lines.length === 0) return <p className="text-sm text-muted-foreground">{t("nothing")}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            <th className="py-2 pr-3 font-medium">{t("columns.line")}</th>
            <th className="py-2 pr-3 font-medium">{t("columns.time")}</th>
            <th className="py-2 pr-3 font-medium">{t("columns.remarks")}</th>
            <th className="py-2 pr-3 text-right font-medium">{t("columns.amount")}</th>
            <th className="py-2 font-medium">{t("columns.decision")}</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => {
            const fill = fillText(t, l);
            return (
              <tr key={l.lineNo} className="border-b align-top last:border-0">
                <td className="py-2 pr-3 text-muted-foreground tabular-nums">{l.lineNo}</td>
                <td className="py-2 pr-3 whitespace-nowrap text-muted-foreground">
                  <div>{l.localDateTime.slice(0, 16)}</div>
                  <div className="text-xs">··{l.last4}</div>
                </td>
                <td className="max-w-64 py-2 pr-3">
                  <div className="truncate">{l.remarks ?? "—"}</div>
                  {l.ref ? <div className="truncate text-xs text-muted-foreground">{l.ref}</div> : null}
                  {l.transactionDescription ? (
                    <div className="truncate text-xs text-subtle-foreground">→ {l.transactionDescription}</div>
                  ) : null}
                </td>
                <td className="py-2 pr-3 text-right">
                  <Amount value={l.amount} currency={l.currency} kind={l.direction === "in" ? "income" : "expense"} />
                </td>
                <td className="py-2">
                  <div className="flex flex-col items-start gap-1">
                    <StatusTag tone={decisionTone(l)}>{decisionLabel(t, l)}</StatusTag>
                    {fill ? <span className="text-xs text-muted-foreground">{fill}</span> : null}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

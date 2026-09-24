"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/form-field";
import { DatePicker } from "@/components/date-picker";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { formatCurrency } from "@/lib/format";
import type { SyncResult } from "@/lib/simpany-sync";
import { syncSimpanyAction } from "./simpany-actions";

/**
 * 「從 Simpany 同步」：選日期區間 → 同步 → 就地顯示結果（數量、自動綁定、作廢清理、
 * 需要人工確認）。結果本身就是回饋，不另外跳 toast。
 */
export function SimpanySyncSheet({
  defaultStart,
  defaultEnd,
}: Readonly<{ defaultStart: string; defaultEnd: string }>) {
  const t = useTranslations("invoices.simpany.sync");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState(defaultStart);
  const [end, setEnd] = useState(defaultEnd);
  const [result, setResult] = useState<SyncResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, run] = useTransition();

  function submit() {
    setError(null);
    run(async () => {
      const res = await syncSimpanyAction({ startDate: start, endDate: end });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setResult(res.data);
      router.refresh();
    });
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        setOpen(next);
        if (!next) {
          setResult(null);
          setError(null);
        }
      }}
    >
      <SheetTrigger asChild>
        <Button size="sm" variant="outline">
          <RefreshCw className="size-4" /> {t("trigger")}
        </Button>
      </SheetTrigger>
      <SheetContent className="data-[side=right]:sm:max-w-lg">
        <SheetHeader className="shrink-0">
          <SheetTitle>{t("title")}</SheetTitle>
          <SheetDescription>{t("description")}</SheetDescription>
        </SheetHeader>
        <div className="flex-1 space-y-4 overflow-y-auto px-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t("startDate")}>
              <DatePicker name="startDate" defaultValue={defaultStart} onValueChange={setStart} />
            </Field>
            <Field label={t("endDate")}>
              <DatePicker name="endDate" defaultValue={defaultEnd} onValueChange={setEnd} />
            </Field>
          </div>
          {error ? (
            <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}
          {result ? <SyncResultView result={result} /> : null}
        </div>
        <SheetFooter className="flex-row justify-end">
          <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            {t("close")}
          </Button>
          <Button type="button" onClick={submit} disabled={pending || !start || !end}>
            <RefreshCw className={pending ? "size-4 animate-spin" : "size-4"} />
            {pending ? t("submitting") : t("submit")}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function SyncResultView({ result }: Readonly<{ result: SyncResult }>) {
  const t = useTranslations("invoices.simpany.sync");
  return (
    <section className="space-y-3 rounded-lg border p-3 text-sm">
      <h3 className="font-medium">{t("resultTitle")}</h3>
      <p className="text-muted-foreground">
        {t("counts", {
          seen: result.seen,
          created: result.created,
          updated: result.updated,
          unchanged: result.unchanged,
          voided: result.voided,
          linked: result.autoLinked.length,
        })}
      </p>
      {result.incomplete ? (
        <p className="rounded-md bg-amber-500/10 px-3 py-2 text-amber-700 dark:text-amber-400">
          {t("incomplete")}
        </p>
      ) : null}

      {result.autoLinked.length > 0 ? (
        <div className="space-y-1">
          <h4 className="text-xs font-medium text-muted-foreground">{t("linkedTitle")}</h4>
          <ul className="space-y-0.5">
            {result.autoLinked.map((l) => (
              <li key={l.invoiceId} className="tabular-nums">
                {l.invoiceNumber ?? t("noNumber")} → {l.linkedTo.join("、")}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {result.voidCleanups.length > 0 ? (
        <div className="space-y-1">
          <h4 className="text-xs font-medium text-muted-foreground">{t("voidTitle")}</h4>
          <ul className="space-y-0.5">
            {result.voidCleanups.map((v) => {
              const parts: string[] = [];
              if (v.clearedBillingItemId != null) parts.push(t("voidBilling", { id: v.clearedBillingItemId }));
              if (v.clearedSubscription) {
                parts.push(
                  t("voidSubscription", {
                    id: v.clearedSubscription.subscriptionId,
                    period: v.clearedSubscription.periodStart,
                  }),
                );
              }
              if (v.unlinkedTransactionIds.length) {
                parts.push(t("voidTxns", { count: v.unlinkedTransactionIds.length }));
              }
              return (
                <li key={v.invoiceId}>
                  {t("voidLine", { number: v.invoiceNumber ?? t("noNumber"), what: parts.join("、") || "—" })}
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      <div className="space-y-1">
        <h4 className="text-xs font-medium text-muted-foreground">{t("reviewTitle")}</h4>
        {result.needsReview.length === 0 ? (
          <p className="text-muted-foreground">{t("nothingToReview")}</p>
        ) : (
          <ul className="space-y-2">
            {result.needsReview.map((r, i) => (
              <li key={`${r.invoiceId}-${i}`} className="rounded-md border p-2">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium tabular-nums">
                    {r.invoiceNumber ?? t("noNumber")} · {r.buyer ?? "—"}
                  </span>
                  <span className="tabular-nums text-muted-foreground">
                    {formatCurrency(r.amount, "TWD")}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">{r.reason}</p>
                {r.candidates.length > 0 ? (
                  <ul className="mt-1 list-disc pl-4 text-xs">
                    {r.candidates.map((c) => (
                      <li key={`${c.kind}-${c.id}-${c.periodStart ?? ""}`}>{c.label}</li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { formatCurrency } from "@/lib/currency";
import type { SyncResult } from "@/lib/wise-sync";
import { applyWiseSync, previewWiseSync } from "./wise-sync-actions";

/** 樣本金額前的正負號：收入 +、支出 −、轉帳不加。 */
function amountSign(type: string): string {
  if (type === "income") return "+";
  if (type === "expense") return "−";
  return "";
}

/**
 * 帳戶頁「從 Wise 同步」：打開就先跑一次試算（dry run，不寫入），列出每個帳戶會新增
 * 幾筆與前 50 筆樣本；使用者按「寫入 N 筆」才真的寫。只給 owner / admin 看到。
 */
export function WiseSyncButton() {
  const t = useTranslations("wise");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<SyncResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, startLoading] = useTransition();
  const [applying, startApplying] = useTransition();

  function runPreview() {
    setError(null);
    setPreview(null);
    startLoading(async () => {
      const res = await previewWiseSync(null);
      if (res.ok) setPreview(res.result);
      else setError(res.error);
    });
  }

  function openSheet() {
    setOpen(true);
    runPreview();
  }

  function apply() {
    startApplying(async () => {
      const res = await applyWiseSync(null);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      toast.success(t("sync.applied", { count: res.result.totals.created }));
      setOpen(false);
      router.refresh();
    });
  }

  const busy = loading || applying;
  const count = preview?.totals.created ?? 0;
  const skipped = preview?.skippedBalances ?? [];

  return (
    <>
      <Button type="button" variant="outline" onClick={openSheet}>
        <RefreshCw className="size-4" /> {t("sync.button")}
      </Button>
      <Sheet open={open} onOpenChange={(o) => !applying && setOpen(o)}>
        <SheetContent className="data-[side=right]:sm:max-w-3xl">
          <SheetHeader className="shrink-0">
            <SheetTitle>{t("sync.title")}</SheetTitle>
            <SheetDescription>{t("sync.description")}</SheetDescription>
          </SheetHeader>
          <div className="flex-1 space-y-5 overflow-y-auto px-4 pb-4">
            {loading ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> {t("sync.loading")}
              </p>
            ) : null}
            {error ? (
              <div
                role="alert"
                className="space-y-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
              >
                <p>{error}</p>
                <Button type="button" size="sm" variant="outline" onClick={runPreview} disabled={busy}>
                  {t("sync.retry")}
                </Button>
              </div>
            ) : null}

            {preview ? (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[560px] text-sm">
                    <thead>
                      <tr className="border-b text-left text-xs text-muted-foreground">
                        <th className="py-2 pr-3 font-medium">{t("sync.columns.account")}</th>
                        <th className="py-2 pr-3 font-medium">{t("sync.columns.range")}</th>
                        <th className="py-2 pr-3 text-right font-medium">{t("sync.columns.fetched")}</th>
                        <th className="py-2 pr-3 text-right font-medium">{t("sync.columns.existing")}</th>
                        <th className="py-2 pr-3 text-right font-medium">{t("sync.columns.beforeCutover")}</th>
                        <th className="py-2 text-right font-medium">{t("sync.columns.toCreate")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.accounts.map((a) => (
                        <tr key={a.bankAccountId} className="border-b last:border-0">
                          <td className="py-2 pr-3">
                            <div className="font-medium">{a.bankAccountName}</div>
                            <div className="text-xs text-muted-foreground">
                              {a.profileName} · {a.currency}
                            </div>
                          </td>
                          <td className="py-2 pr-3 whitespace-nowrap text-muted-foreground">
                            {a.rangeStart} ～ {a.rangeEnd}
                          </td>
                          <td className="py-2 pr-3 text-right tabular-nums">{a.fetched}</td>
                          <td className="py-2 pr-3 text-right tabular-nums">{a.alreadySynced}</td>
                          <td className="py-2 pr-3 text-right tabular-nums">{a.beforeCutover}</td>
                          <td className="py-2 text-right font-semibold tabular-nums">{a.created}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {skipped.length > 0 ? (
                  <p className="text-xs text-muted-foreground">
                    {t("sync.skipped", {
                      list: skipped
                        .map((s) => {
                          const reason = t(`sync.reason.${s.reason}`);
                          return `${s.profileName} ${s.currency}（${reason}）`;
                        })
                        .join("、"),
                    })}
                  </p>
                ) : null}

                {count === 0 ? (
                  <p className="text-sm text-muted-foreground">{t("sync.nothing")}</p>
                ) : (
                  <div className="space-y-2">
                    <p className="text-sm font-medium">
                      {t("sync.sampleTitle", { count: preview.sample.length })}
                    </p>
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[560px] text-sm">
                        <thead>
                          <tr className="border-b text-left text-xs text-muted-foreground">
                            <th className="py-2 pr-3 font-medium">{t("sync.columns.date")}</th>
                            <th className="py-2 pr-3 font-medium">{t("sync.columns.party")}</th>
                            <th className="py-2 pr-3 font-medium">{t("sync.columns.description")}</th>
                            <th className="py-2 text-right font-medium">{t("sync.columns.amount")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {preview.sample.map((r) => (
                            <tr key={r.externalRef} className="border-b last:border-0 align-top">
                              <td className="py-2 pr-3 whitespace-nowrap text-muted-foreground">
                                {r.txnDate}
                              </td>
                              <td className="py-2 pr-3">
                                <div className="flex flex-col gap-1">
                                  <span>{r.partyName ?? "—"}</span>
                                  <Badge variant="secondary" className="w-fit font-normal">
                                    {t(`sync.type.${r.type as "income" | "expense" | "transfer"}`)}
                                  </Badge>
                                </div>
                              </td>
                              <td className="py-2 pr-3 text-muted-foreground">{r.description}</td>
                              <td className="py-2 text-right tabular-nums whitespace-nowrap">
                                {amountSign(r.type)}
                                {formatCurrency(r.amount, r.currency)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </>
            ) : null}
          </div>
          <SheetFooter className="flex-row justify-end">
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={applying}>
              {t("sync.cancel")}
            </Button>
            <Button type="button" onClick={apply} disabled={busy || !preview || count === 0}>
              {applying ? t("sync.applying") : t("sync.apply", { count })}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}

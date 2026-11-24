"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { ArrowUpRight, ListTree } from "lucide-react";
import { Amount } from "@/components/amount";
import { EmptyState } from "@/components/empty-state";
import { tableEdgePadding } from "@/components/table-card";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { LedgerKind, LedgerLine, Period } from "@/lib/ledger/types";
import { cn } from "@/lib/utils";
import { fetchAccountLedger } from "./actions";
import { periodText } from "./labels";
import { sourceHref } from "./params";

export type DrillTarget = { glAccountId: number; code: string | null; name: string };

/** 下鑽：點報表上的科目列，右側滑出這個科目在期間內的每一筆分錄。 */
export function AccountLedgerSheet({
  target,
  ledger,
  period,
  onClose,
}: Readonly<{
  target: DrillTarget | null;
  ledger: LedgerKind;
  period: Period;
  onClose: () => void;
}>) {
  const t = useTranslations("statements.drill");
  const tSource = useTranslations("statements.source");
  // 結果帶著它是哪一次請求的 key；key 對不上就是還在載入（effect 裡不同步 setState）。
  const requestKey = target ? `${target.glAccountId}:${ledger}:${period.from}:${period.to}` : null;
  const [result, setResult] = useState<{ key: string; lines: LedgerLine[] | null } | null>(null);

  useEffect(() => {
    if (!target || !requestKey) return;
    let cancelled = false;
    fetchAccountLedger({ glAccountId: target.glAccountId, ledger, from: period.from, to: period.to })
      .then((res) => {
        if (!cancelled) setResult({ key: requestKey, lines: res.ok ? res.lines : null });
      })
      .catch(() => {
        if (!cancelled) setResult({ key: requestKey, lines: null });
      });
    return () => {
      cancelled = true;
    };
  }, [target, requestKey, ledger, period.from, period.to]);

  const loaded = result !== null && result.key === requestKey;
  const lines = loaded ? result.lines : null;
  const error = loaded && result.lines === null;

  const totals = (lines ?? []).reduce(
    (s, l) => ({ debit: s.debit + l.debit, credit: s.credit + l.credit }),
    { debit: 0, credit: 0 },
  );

  let body: React.ReactNode;
  if (error) {
    body = <EmptyState icon={ListTree} message={t("error")} />;
  } else if (lines === null) {
    body = (
      <div className="grid gap-2 p-4">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-8 w-full" />
        ))}
      </div>
    );
  } else if (lines.length === 0) {
    body = <EmptyState icon={ListTree} message={t("empty")} />;
  } else {
    body = (
      <div className={cn("min-w-0 overflow-x-auto", tableEdgePadding)}>
        <Table className="min-w-[720px]">
          <TableHeader>
            <TableRow>
              <TableHead className="w-24">{t("columns.date")}</TableHead>
              <TableHead>{t("columns.memo")}</TableHead>
              <TableHead className="w-28">{t("columns.counter")}</TableHead>
              <TableHead className="w-28 text-right">{t("columns.debit")}</TableHead>
              <TableHead className="w-28 text-right">{t("columns.credit")}</TableHead>
              <TableHead className="w-32 text-right">{t("columns.balance")}</TableHead>
              <TableHead className="w-20">{t("columns.source")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {lines.map((l, i) => {
              const href = sourceHref(l.sourceType, l.sourceId);
              return (
                <TableRow key={`${l.postingKey}:${i}`}>
                  <TableCell className="tabular-nums text-muted-foreground">{l.date}</TableCell>
                  <TableCell className="max-w-64 truncate" title={l.memo}>
                    {l.memo || "—"}
                  </TableCell>
                  <TableCell className="tabular-nums text-muted-foreground">
                    {l.counterAccounts.length > 0 ? l.counterAccounts.join("、") : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    {l.debit ? <Amount value={l.debit} kind="neutral" /> : null}
                  </TableCell>
                  <TableCell className="text-right">
                    {l.credit ? <Amount value={l.credit} kind="neutral" /> : null}
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    <Amount value={l.balance} kind="neutral" />
                  </TableCell>
                  <TableCell>
                    {href ? (
                      <Link
                        href={href}
                        className="inline-flex items-center gap-0.5 text-xs text-primary hover:underline"
                      >
                        {tSource(l.sourceType)}
                        <ArrowUpRight className="size-3" />
                      </Link>
                    ) : (
                      <span className="text-xs text-muted-foreground">{tSource(l.sourceType)}</span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
            <TableRow className="bg-muted/40 font-medium hover:bg-muted/40">
              <TableCell colSpan={3}>{t("total", { count: lines.length })}</TableCell>
              <TableCell className="text-right">
                <Amount value={totals.debit} kind="neutral" />
              </TableCell>
              <TableCell className="text-right">
                <Amount value={totals.credit} kind="neutral" />
              </TableCell>
              <TableCell className="text-right">
                <Amount value={lines.at(-1)?.balance ?? 0} kind="neutral" />
              </TableCell>
              <TableCell />
            </TableRow>
          </TableBody>
        </Table>
      </div>
    );
  }

  return (
    <Sheet open={target !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-full gap-0 sm:max-w-3xl">
        <SheetHeader className="shrink-0 border-b">
          <SheetTitle>
            {target?.code ? <span className="mr-2 tabular-nums text-muted-foreground">{target.code}</span> : null}
            {target?.name}
          </SheetTitle>
          <SheetDescription>
            {t("description", { period: periodText(period), ledger: t(`ledger.${ledger}`) })}
          </SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto">{body}</div>
      </SheetContent>
    </Sheet>
  );
}

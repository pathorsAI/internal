"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCurrency } from "@/lib/format";
import type { ReconEmployee } from "@/lib/simpany-salary";
import { syncSalaryDeclarationsAction } from "./simpany-salary-actions";

/** owner / admin 才看得到：同步這一年的 Simpany 薪資申報（對 Simpany 只發 GET）。 */
export function SalarySyncButton({ year }: Readonly<{ year: number }>) {
  const t = useTranslations("payroll.simpany.sync");
  const router = useRouter();
  const [pending, run] = useTransition();
  const [unmatched, setUnmatched] = useState<string[]>([]);

  function submit() {
    run(async () => {
      const res = await syncSalaryDeclarationsAction(year);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(
        t("done", {
          year,
          filed: res.data.months.filter((m) => m.filedCount > 0).length,
          rows: res.data.declarationsUpserted,
        }),
      );
      setUnmatched(res.data.unmatchedNames);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button size="sm" variant="outline" onClick={submit} disabled={pending}>
        <RefreshCw className={pending ? "size-4 animate-spin" : "size-4"} />
        {pending ? t("pending") : t("button")}
      </Button>
      {unmatched.length > 0 ? (
        <p className="max-w-sm text-right text-xs text-amber-700 dark:text-amber-400">
          {t("unmatched", { names: unmatched.join("、") })}
        </p>
      ) : null}
    </div>
  );
}

/** 一位員工的逐月對帳與付款分配。 */
export function ArrearsDetailSheet({ employee }: Readonly<{ employee: ReconEmployee }>) {
  const t = useTranslations("payroll.simpany.detail");
  const [open, setOpen] = useState(false);
  const e = employee;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs">
          {t("button")}
        </Button>
      </SheetTrigger>
      <SheetContent className="data-[side=right]:sm:max-w-xl">
        <SheetHeader className="shrink-0">
          <SheetTitle>{t("title", { name: e.name })}</SheetTitle>
          <SheetDescription>{t("description")}</SheetDescription>
        </SheetHeader>
        <div className="flex-1 space-y-5 overflow-y-auto px-4 pb-4">
          {e.expectedMonthlyNet != null && e.expectedSource ? (
            <p className="text-sm text-muted-foreground">
              {t("expected", {
                amount: formatCurrency(e.expectedMonthlyNet),
                source: t(`expectedSource.${e.expectedSource}`),
              })}
            </p>
          ) : null}

          <section className="space-y-2">
            <h3 className="text-sm font-medium">{t("monthsTitle")}</h3>
            <div className="overflow-hidden rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-3">{t("columns.month")}</TableHead>
                    <TableHead className="text-right">{t("columns.declared")}</TableHead>
                    <TableHead className="text-right">{t("columns.allocated")}</TableHead>
                    <TableHead className="pr-3 text-right">{t("columns.outstanding")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {e.months.map((m) => (
                    <TableRow key={m.month}>
                      <TableCell className="pl-3 whitespace-nowrap">
                        <span className="tabular-nums">{t("monthShort", { month: m.month })}</span>
                        <span className="ml-2 inline-flex gap-1">
                          {m.filed ? null : (
                            <Badge variant="outline" className="text-muted-foreground">
                              {t("unfiled")}
                            </Badge>
                          )}
                          {m.estimated ? (
                            <Badge
                              variant="outline"
                              className="border-amber-500/40 text-amber-700 dark:text-amber-400"
                            >
                              {t("estimated")}
                            </Badge>
                          ) : null}
                          {m.due ? null : (
                            <Badge variant="outline" className="text-muted-foreground">
                              {t("notDue")}
                            </Badge>
                          )}
                        </span>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {m.owed > 0 ? formatCurrency(m.owed) : "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {m.allocatedPaid > 0 ? formatCurrency(m.allocatedPaid) : "—"}
                      </TableCell>
                      <TableCell
                        className={
                          m.outstanding > 0
                            ? "pr-3 text-right font-medium tabular-nums text-expense"
                            : "pr-3 text-right tabular-nums text-muted-foreground"
                        }
                      >
                        {m.outstanding > 0 ? formatCurrency(m.outstanding) : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </section>

          <section className="space-y-2">
            <h3 className="text-sm font-medium">{t("paymentsTitle")}</h3>
            {e.payments.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t("noPayments")}</p>
            ) : (
              <div className="overflow-hidden rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-3">{t("columns.date")}</TableHead>
                      <TableHead className="text-right">{t("columns.amount")}</TableHead>
                      <TableHead className="pr-3">{t("columns.appliedTo")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {e.payments.map((p) => (
                      <TableRow key={`${p.source}-${p.transactionId ?? p.payslipId}`}>
                        <TableCell className="pl-3 whitespace-nowrap tabular-nums">
                          <div>{p.date}</div>
                          <div className="max-w-[18ch] truncate text-xs text-muted-foreground">
                            {p.source === "payslip" ? t("payslip") : (p.accountName ?? p.description ?? "")}
                          </div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{formatCurrency(p.amount)}</TableCell>
                        <TableCell className="pr-3 text-xs">
                          {p.allocations.map((a) => (
                            <div key={a.month} className="tabular-nums">
                              {t("monthShort", { month: a.month })} {formatCurrency(a.amount)}
                            </div>
                          ))}
                          {p.unapplied > 0 ? (
                            <div className="text-amber-700 tabular-nums dark:text-amber-400">
                              {t("unapplied", { amount: formatCurrency(p.unapplied) })}
                            </div>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </section>
        </div>
        <SheetFooter className="flex-row justify-end">
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            {t("close")}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

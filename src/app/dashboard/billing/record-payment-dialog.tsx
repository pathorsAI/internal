"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Banknote, ExternalLink, Loader2, Split } from "lucide-react";
import {
  linkPaymentToBillingRow,
  suggestPaymentMatches,
  type PaymentCandidate,
} from "@/db/mutations";
import { Button } from "@/components/ui/button";
import { Amount } from "@/components/amount";
import { EmptyState } from "@/components/empty-state";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { PaymentAllocationSheet } from "@/components/payment-allocation-sheet";
import { formatCurrency, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * 看板上的「登記收款」：列出還沒綁走、金額相近的收入交易讓人一鍵配對。
 *
 * 只在打開對話框時才去查候選 —— 看板可能有上百列，預先幫每一列都算一份配對
 * 建議是白花的查詢。配對成功後「已收多少」由交易金額自動算，不另外寫金額。
 *
 * 一筆匯款付了好幾項、或被扣了手續費時，按「分配」改開「分配收款」Sheet（0042），
 * 預填這一列 min(那筆還沒分出去的, 這一列還沒收的)。已經拆分過的交易只能走分配。
 */
export function RecordPaymentDialog({
  rowKey,
  expected,
  paid,
  currency,
  customerPartyId,
  customerName,
}: Readonly<{
  rowKey: string;
  expected: number;
  paid: number;
  currency: string;
  customerPartyId: number | null;
  customerName: string | null;
}>) {
  const t = useTranslations("billing.recordPayment");
  const [open, setOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [candidates, setCandidates] = React.useState<PaymentCandidate[] | null>(null);
  const [linking, setLinking] = React.useState<number | null>(null);
  const [allocating, setAllocating] = React.useState<number | null>(null);
  const tAlloc = useTranslations("allocations");
  const router = useRouter();

  const outstanding = Math.max(0, expected - paid);

  // 開啟時才去查候選，而且只查一次 —— 查詢由「使用者按了開啟」這個事件觸發，
  // 不是由 open 這個 state 同步出來的，所以不用 effect（也避免串聯 render）。
  async function loadCandidates(next: boolean) {
    setOpen(next);
    if (!next || candidates !== null) return;
    setLoading(true);
    try {
      setCandidates(await suggestPaymentMatches({ expected: outstanding, currency, customerPartyId }));
    } catch {
      setCandidates([]);
    } finally {
      setLoading(false);
    }
  }

  async function link(id: number) {
    setLinking(id);
    const res = await linkPaymentToBillingRow(rowKey, id);
    setLinking(null);
    if (res.ok) {
      setOpen(false);
      toast.success(t("toast.linked"));
      router.refresh();
    } else {
      toast.error(res.error ?? t("toast.linkFailed"));
    }
  }

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          void loadCandidates(next);
        }}
      >
        <DialogTrigger asChild>
          <Button type="button" size="sm" variant="outline">
            <Banknote className="size-4" /> {t("trigger")}
          </Button>
        </DialogTrigger>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("dialog.title")}</DialogTitle>
            <DialogDescription>
              {t("dialog.description", {
                amount: formatCurrency(outstanding, currency),
                customer: customerName ? `　·　${customerName}` : "",
              })}
            </DialogDescription>
          </DialogHeader>

          {loading && (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> {t("loading")}
            </div>
          )}

          {!loading && candidates?.length === 0 && (
            <EmptyState icon={Banknote} message={t("empty")} className="rounded-md py-8" />
          )}

          {!loading && candidates && candidates.length > 0 && (
            <ul className="divide-y rounded-md border">
              {candidates.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 px-3 py-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">
                      {c.description ?? t("candidate.noDescription")}
                    </div>
                    <div className="text-xs text-muted-foreground tabular-nums">
                      {formatDate(c.txnDate)}
                      {c.partyName ? `　·　${c.partyName}` : ""}
                      {c.allocated > 0
                        ? `　·　${tAlloc("sheet.allocated")} ${formatCurrency(c.allocated, c.currency)}`
                        : ""}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <div className="text-right">
                      <Amount
                        value={c.amount}
                        currency={c.currency}
                        kind="income"
                        className="block text-sm"
                      />
                      <div
                        className={cn(
                          "text-xs tabular-nums",
                          c.gap === 0 ? "text-income" : "text-muted-foreground",
                        )}
                      >
                        {c.gap === 0
                          ? t("candidate.matchExact")
                          : t("candidate.gap", { amount: formatCurrency(c.gap, c.currency) })}
                      </div>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant={c.split ? "default" : "outline"}
                      disabled={linking != null}
                      onClick={() => {
                        setOpen(false);
                        setAllocating(c.id);
                      }}
                    >
                      <Split className="size-4" /> {tAlloc("triggerShort")}
                    </Button>
                    {c.split ? null : (
                      <Button
                        type="button"
                        size="sm"
                        disabled={linking != null}
                        onClick={() => {
                          void link(c.id);
                        }}
                      >
                        {linking === c.id ? t("candidate.linking") : t("candidate.pick")}
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}

          <Button asChild variant="ghost" size="sm" className="w-full">
            <Link href="/dashboard/transactions">
              <ExternalLink className="size-4" /> {t("goToTransactions")}
            </Link>
          </Button>
        </DialogContent>
      </Dialog>
      {allocating == null ? null : (
        <PaymentAllocationSheet
          transactionId={allocating}
          open
          onOpenChange={(next) => {
            if (!next) {
              setAllocating(null);
              // 候選清單的「已分配」可能變了，下次打開重查。
              setCandidates(null);
            }
          }}
          prefillKey={rowKey}
        />
      )}
    </>
  );
}

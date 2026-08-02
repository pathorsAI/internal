"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Banknote, ExternalLink, Loader2 } from "lucide-react";
import {
  linkPaymentToBillingRow,
  suggestPaymentMatches,
  type PaymentCandidate,
} from "@/db/mutations";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { formatCurrency, formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * 看板上的「登記收款」：列出還沒綁走、金額相近的收入交易讓人一鍵配對。
 *
 * 只在打開對話框時才去查候選 —— 看板可能有上百列，預先幫每一列都算一份配對
 * 建議是白花的查詢。配對成功後「已收多少」由交易金額自動算，不另外寫金額。
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
  const [open, setOpen] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [candidates, setCandidates] = React.useState<PaymentCandidate[] | null>(null);
  const [linking, setLinking] = React.useState<number | null>(null);
  const router = useRouter();

  const outstanding = Math.max(0, expected - paid);

  // 開啟時才去查候選，而且只查一次 —— 查詢由「使用者按了開啟」這個事件觸發，
  // 不是由 open 這個 state 同步出來的，所以不用 effect（也避免串聯 render）。
  async function onOpenChange(next: boolean) {
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
      toast.success("已認列這筆收款");
      router.refresh();
    } else {
      toast.error(res.error ?? "配對失敗");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant="outline">
          <Banknote className="size-4" /> 登記收款
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>登記收款</DialogTitle>
          <DialogDescription>
            尚未收 {formatCurrency(outstanding, currency)}
            {customerName ? `　·　${customerName}` : ""}。
            下面是還沒綁到任何請款項目的收入交易，金額最接近的排在前面。
          </DialogDescription>
        </DialogHeader>

        {loading && (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> 搜尋可配對的交易…
          </div>
        )}

        {!loading && candidates?.length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">
            沒有未綁定的收入交易可以配對。錢還沒入帳的話，先到內外帳建一筆收入。
          </p>
        )}

        {!loading && candidates && candidates.length > 0 && (
          <ul className="divide-y rounded-md border">
            {candidates.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 px-3 py-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">
                    {c.description ?? "（無說明）"}
                  </div>
                  <div className="text-xs text-muted-foreground tabular-nums">
                    {formatDate(c.txnDate)}
                    {c.partyName ? `　·　${c.partyName}` : ""}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <div className="text-right">
                    <div className="text-sm tabular-nums">
                      {formatCurrency(c.amount, c.currency)}
                    </div>
                    <div
                      className={cn(
                        "text-xs tabular-nums",
                        c.gap === 0 ? "text-income" : "text-muted-foreground",
                      )}
                    >
                      {c.gap === 0 ? "金額吻合" : `差 ${formatCurrency(c.gap, c.currency)}`}
                    </div>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    disabled={linking != null}
                    onClick={() => link(c.id)}
                  >
                    {linking === c.id ? "配對中…" : "就是這筆"}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}

        <Button asChild variant="ghost" size="sm" className="w-full">
          <Link href="/transactions">
            <ExternalLink className="size-4" /> 到內外帳建一筆收入
          </Link>
        </Button>
      </DialogContent>
    </Dialog>
  );
}

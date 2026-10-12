"use client";

import * as React from "react";
import { useTransition } from "react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import { isProviderOverdue } from "@/lib/vendor-billing/attention";
import type { InvoiceAction } from "@/lib/vendor-billing/inputs";
import type { InvoiceRow, TxnBrief } from "@/lib/vendor-billing/service";
import { linkCandidatesAction, resolveInvoiceAction } from "./actions";
import { MatchChip, day, period, txnText } from "./shared";

/** 平台上的帳單狀態原文；平台說逾期（或過了寬限還有欠款）就紅字。 */
export function ProviderStatus({
  invoice,
  today,
  empty,
}: Readonly<{
  invoice: InvoiceRow;
  today: string;
  /** 沒有狀態時顯示什麼；不給就是灰色的 — */
  empty?: React.ReactNode;
}>) {
  const t = useTranslations("vendorBilling");
  const overdue = isProviderOverdue(
    { providerStatus: invoice.status, amountDue: invoice.amountDue, invoiceDate: invoice.invoiceDate },
    today,
  );
  if (!invoice.status && !overdue) return empty === undefined ? <span className="text-muted-foreground">—</span> : empty;
  return (
    <span className={cn("text-xs", overdue ? "font-medium text-destructive" : "text-muted-foreground")}>
      {invoice.status ?? t("cell.overdue")}
    </span>
  );
}

/** 帳單綁到 / 建議的交易，一行截斷。 */
export function InvoiceTxn({ invoice }: Readonly<{ invoice: InvoiceRow }>) {
  const t = useTranslations("vendorBilling");
  if (invoice.matchedTransaction) {
    return <span className="block break-words">{txnText(invoice.matchedTransaction)}</span>;
  }
  if (invoice.suggestedTransaction) {
    return (
      <span className="block break-words text-sky-700 dark:text-sky-400">
        {t("cell.suggestedTxn", { txn: txnText(invoice.suggestedTransaction) })}
      </span>
    );
  }
  return <span className="text-muted-foreground">—</span>;
}

/** 候選交易清單：null = 還在載入。 */
function CandidateList({
  items,
  onPick,
}: Readonly<{ items: TxnBrief[] | null; onPick: (txnId: number) => void }>) {
  const t = useTranslations("vendorBilling");
  if (items === null) {
    return (
      <div className="flex items-center gap-2 px-2 py-1.5 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> {t("invoiceAction.loading")}
      </div>
    );
  }
  if (items.length === 0) {
    return <div className="px-2 py-1.5 text-sm text-muted-foreground">{t("invoiceAction.noCandidates")}</div>;
  }
  return items.map((x) => (
    <button
      key={x.id}
      type="button"
      className="flex w-full min-w-0 items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground"
      onClick={() => onPick(x.id)}
    >
      <span className="shrink-0 tabular-nums">{day(x.txnDate)}</span>
      <span className="shrink-0 font-medium tabular-nums">{formatCurrency(x.amount, x.currency)}</span>
      <span className="min-w-0 flex-1 truncate text-muted-foreground">
        {[x.partyName, x.description].filter(Boolean).join(" · ")}
      </span>
    </button>
  ));
}

/** 「綁定交易」：打開時才去拿候選交易，可用文字篩選，點一筆就綁。 */
function LinkPicker({
  invoiceId,
  label,
  disabled,
  onPick,
}: Readonly<{ invoiceId: number; label: string; disabled: boolean; onPick: (txnId: number) => void }>) {
  const t = useTranslations("vendorBilling");
  const [open, setOpen] = React.useState(false);
  const [items, setItems] = React.useState<TxnBrief[] | null>(null);
  const [q, setQ] = React.useState("");
  const [loading, startLoading] = useTransition();

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) return;
    setQ("");
    if (items) return;
    startLoading(async () => {
      const res = await linkCandidatesAction(invoiceId);
      if (res.ok) setItems(res.items);
      else {
        toast.error(res.error);
        setOpen(false);
      }
    });
  }

  const needle = q.trim().toLowerCase();
  const shown = items?.filter((x) => !needle || txnText(x).toLowerCase().includes(needle));

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button type="button" size="xs" variant="outline" disabled={disabled}>
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(28rem,calc(100vw-2rem))] p-0">
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("invoiceAction.search")}
          className="h-9 w-full border-b bg-transparent px-3 text-sm outline-none placeholder:text-muted-foreground"
        />
        <div className="max-h-72 overflow-y-auto p-1">
          <CandidateList
            items={loading ? null : (shown ?? null)}
            onPick={(txnId) => {
              setOpen(false);
              onPick(txnId);
            }}
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** 依對帳狀態給的動作：有建議 → 確認 / 改綁；未對帳 → 綁定 / 建立 / 不對帳；定案 → 解除。 */
function InvoiceActions({ invoice, onChanged }: Readonly<{ invoice: InvoiceRow; onChanged: () => void }>) {
  const t = useTranslations("vendorBilling");
  const [pending, start] = useTransition();

  function run(action: InvoiceAction, txnId?: number) {
    start(async () => {
      const res = await resolveInvoiceAction(invoice.id, action, txnId ?? null);
      if (!res.ok) {
        toast.error(res.error ?? t("toast.failed"));
        return;
      }
      onChanged();
    });
  }

  const btn = (action: InvoiceAction, label: string) => (
    <Button type="button" size="xs" variant="outline" disabled={pending} onClick={() => run(action)}>
      {label}
    </Button>
  );
  const link = (label: string) => (
    <LinkPicker invoiceId={invoice.id} label={label} disabled={pending} onPick={(id) => run("link", id)} />
  );

  let buttons: React.ReactNode;
  switch (invoice.matchStatus) {
    case "suggested":
      buttons = (
        <>
          {btn("confirm", t("invoiceAction.confirm"))}
          {link(t("invoiceAction.relink"))}
        </>
      );
      break;
    case "unmatched":
      buttons = (
        <>
          {link(t("invoiceAction.link"))}
          {btn("create", t("invoiceAction.create"))}
          {btn("ignore", t("invoiceAction.ignore"))}
        </>
      );
      break;
    case "ignored":
      buttons = btn("unlink", t("invoiceAction.unignore"));
      break;
    default:
      buttons = btn("unlink", t("invoiceAction.unlink"));
  }

  return (
    <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
      {pending ? <Loader2 className="size-3.5 animate-spin text-muted-foreground" /> : null}
      {buttons}
    </div>
  );
}

/** Sheet 裡的帳單清單：上行帳單號 / 日期 / 期間 / 金額，下行狀態、交易與動作。 */
export function InvoiceList({
  invoices,
  today,
  canManage,
  onChanged,
}: Readonly<{ invoices: InvoiceRow[]; today: string; canManage: boolean; onChanged: () => void }>) {
  const t = useTranslations("vendorBilling");
  if (invoices.length === 0) {
    return <p className="py-3 text-sm text-muted-foreground">{t("empty.accountInvoices")}</p>;
  }
  return (
    <ul className="divide-y">
      {invoices.map((inv) => (
        <li key={inv.id} className="space-y-1.5 py-2.5">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
            <span className="font-medium">{inv.externalRef}</span>
            <span className="min-w-0 flex-1 text-xs text-muted-foreground tabular-nums">
              {day(inv.invoiceDate)}
              {inv.periodStart || inv.periodEnd ? ` · ${period(inv.periodStart, inv.periodEnd)}` : ""}
            </span>
            <span className="shrink-0 font-medium tabular-nums">{formatCurrency(inv.amount, inv.currency)}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <ProviderStatus invoice={inv} today={today} empty={null} />
            <MatchChip status={inv.matchStatus} />
            {/* 交易說明至少 12rem，太窄時整段換到下一行而不是被截斷 */}
            <span className="min-w-48 flex-1 text-xs">
              <InvoiceTxn invoice={inv} />
            </span>
            {canManage ? <InvoiceActions invoice={inv} onChanged={onChanged} /> : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

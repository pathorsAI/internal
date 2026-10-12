"use client";

import * as React from "react";
import { useTransition } from "react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { formatCurrency } from "@/lib/format";
import type { AttentionItem } from "@/lib/vendor-billing/attention";
import { verifyBillingAccountAction } from "./actions";
import { asProvider, type VbT } from "./shared";

const COLLAPSED = 5;

function itemKey(item: AttentionItem): string {
  switch (item.kind) {
    case "card_expired":
    case "card_expiring":
      return `${item.kind}-${item.paymentMethodId}`;
    case "invoice_unmatched":
    case "invoice_overdue":
      return `${item.kind}-${item.invoiceId}`;
    case "resource_missing":
      return `${item.kind}-${item.resourceId}`;
    default:
      return `${item.kind}-${item.billingAccountId}`;
  }
}

function itemText(item: AttentionItem, t: VbT, providerOf: (accountId: number) => string): string {
  switch (item.kind) {
    case "card_expired":
      return t("attention.cardExpired", { label: item.label });
    case "card_expiring":
      return t("attention.cardExpiring", { label: item.label, days: item.daysLeft });
    case "no_payment_method":
      return t("attention.noPaymentMethod", { label: item.label });
    case "duplicate_cards":
      return t("attention.duplicateCards", { label: item.label, card: item.card });
    case "stale_verification":
      return item.days === null
        ? t("attention.neverVerified", { label: item.label })
        : t("attention.staleVerification", { label: item.label, days: item.days });
    case "invoice_unmatched":
      return t("attention.invoiceUnmatched", { label: item.label, days: item.days });
    case "invoice_overdue":
      return t("attention.invoiceOverdue", {
        provider: providerOf(item.billingAccountId),
        amount: formatCurrency(item.amount, item.currency),
        label: item.label,
      });
    case "account_missing":
    case "resource_missing":
      return t("attention.missing", { label: item.label });
  }
}

/** 頁面上方的「需要處理」：一個框、一行計數、條列；點了直接打開對應的 Sheet 或切到帳單對帳。 */
export function AttentionBanner({
  items,
  providers,
  canManage,
  onOpenAccount,
  onOpenMethod,
  onOpenPendingInvoices,
}: Readonly<{
  items: AttentionItem[];
  /** 帳號 id → provider（逾期那行要寫平台名） */
  providers: ReadonlyMap<number, string>;
  canManage: boolean;
  onOpenAccount: (id: number) => void;
  onOpenMethod: (id: number) => void;
  onOpenPendingInvoices: () => void;
}>) {
  const t = useTranslations("vendorBilling");
  const [expanded, setExpanded] = React.useState(false);
  const [verifying, startVerifying] = useTransition();
  if (items.length === 0) return null;

  const shown = expanded ? items : items.slice(0, COLLAPSED);
  const providerOf = (id: number) => t(`provider.${asProvider(providers.get(id) ?? "other")}`);

  function open(item: AttentionItem) {
    switch (item.kind) {
      case "card_expired":
      case "card_expiring":
        onOpenMethod(item.paymentMethodId);
        return;
      case "invoice_unmatched":
        onOpenPendingInvoices();
        return;
      default:
        onOpenAccount(item.billingAccountId);
    }
  }

  function verify(accountId: number) {
    startVerifying(async () => {
      const res = await verifyBillingAccountAction(accountId);
      if (!res.ok) toast.error(res.error ?? t("toast.failed"));
    });
  }

  return (
    <section className="rounded-lg border border-amber-500/40 bg-amber-500/5 px-4 py-3">
      <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
        {t("attention.count", { count: items.length })}
      </p>
      <ul className="mt-1.5 space-y-0.5">
        {shown.map((item) => (
          <li key={itemKey(item)} className="flex min-w-0 items-center gap-2 text-sm">
            <button
              type="button"
              onClick={() => open(item)}
              className="min-w-0 truncate rounded-sm text-left underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              {itemText(item, t, providerOf)}
            </button>
            {item.kind === "stale_verification" && canManage ? (
              <Button
                type="button"
                size="xs"
                variant="outline"
                className="shrink-0"
                disabled={verifying}
                onClick={() => verify(item.billingAccountId)}
              >
                {t("actions.verify")}
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      {items.length > COLLAPSED ? (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-1.5 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          {expanded ? t("attention.showLess") : t("attention.showAll", { count: items.length })}
        </button>
      ) : null}
    </section>
  );
}

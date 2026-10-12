"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TableRow } from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import { cardExpiry, parseTimestamp } from "@/lib/vendor-billing/attention";
import {
  LEDGER_MODES,
  PAYMENT_METHOD_KINDS,
  VENDOR_PROVIDERS,
  type LedgerModeValue,
  type PaymentMethodKind,
  type VendorProvider,
} from "@/lib/vendor-billing/inputs";
import { MATCH_STATUSES, type MatchStatus } from "@/lib/vendor-billing/match";
import type { TxnBrief } from "@/lib/vendor-billing/service";

// 廠商計費頁各元件共用的小零件：型別守衛、chip、日期字串、可點的表格列。

export type Option = { id: number; name: string };
export type MemberOption = { userId: string; name: string };
export type BankAccountOption = { id: number; name: string; currency: string };

export type VbT = ReturnType<typeof useTranslations<"vendorBilling">>;

// DB 的字串欄位不是 union；先收斂成已知值，next-intl 的 key 才查得到型別。
export const asProvider = (p: string): VendorProvider =>
  (VENDOR_PROVIDERS as readonly string[]).includes(p) ? (p as VendorProvider) : "other";
export const asKind = (k: string): PaymentMethodKind =>
  (PAYMENT_METHOD_KINDS as readonly string[]).includes(k) ? (k as PaymentMethodKind) : "other";
export const asMatch = (m: string): MatchStatus =>
  (MATCH_STATUSES as readonly string[]).includes(m) ? (m as MatchStatus) : "unmatched";
export const asLedgerMode = (m: string): LedgerModeValue =>
  (LEDGER_MODES as readonly string[]).includes(m) ? (m as LedgerModeValue) : "match_only";

export const isCardKind = (k: string) => k === "card" || k === "wise_card";

/** YYYY-MM-DD → YYYY/MM/DD（純字串處理，server / client 結果一致，不會 hydration 不合）。 */
export const day = (s: string | null | undefined) => (s ? s.slice(0, 10).replaceAll("-", "/") : "—");

export function period(start: string | null, end: string | null): string {
  if (!start && !end) return "—";
  return `${day(start)} – ${day(end)}`;
}

/** DB 的 timestamptz 字串 → 本地時間顯示（只在 client 開 Sheet 後才 render，不參與 SSR）。 */
export function dateTime(s: string | null): string | null {
  if (!s) return null;
  const d = parseTimestamp(s);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("zh-TW", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

/** ISO 化後再交給 AuditMeta（DB 的 timestamptz 字串在部分瀏覽器解析不了）；壞值原樣交回。 */
export function isoOf(s: string): string {
  const d = parseTimestamp(s);
  return Number.isNaN(d.getTime()) ? s : d.toISOString();
}

export function txnText(txn: TxnBrief): string {
  return [day(txn.txnDate), formatCurrency(txn.amount, txn.currency), txn.partyName, txn.description]
    .filter(Boolean)
    .join(" · ");
}

export function ProviderBadge({ provider }: Readonly<{ provider: string }>) {
  const t = useTranslations("vendorBilling");
  return <Badge variant="outline">{t(`provider.${asProvider(provider)}`)}</Badge>;
}

const matchClass: Record<MatchStatus, string> = {
  unmatched: "border-amber-500/40 text-amber-700 dark:text-amber-400",
  suggested: "border-sky-500/40 text-sky-700 dark:text-sky-400",
  matched: "border-emerald-500/40 text-emerald-700 dark:text-emerald-400",
  manual: "border-emerald-500/40 text-emerald-700 dark:text-emerald-400",
  created: "border-emerald-500/40 text-emerald-700 dark:text-emerald-400",
  ignored: "text-muted-foreground",
};

export function MatchChip({ status }: Readonly<{ status: string }>) {
  const t = useTranslations("vendorBilling");
  const s = asMatch(status);
  return (
    <Badge variant="outline" className={matchClass[s]}>
      {t(`match.${s}`)}
    </Badge>
  );
}

/** 帳號狀態不是 active 才顯示。 */
export function AccountStatusChip({ status }: Readonly<{ status: string }>) {
  const t = useTranslations("vendorBilling");
  if (status === "missing") {
    return (
      <Badge variant="outline" className="border-destructive/40 text-destructive">
        {t("status.missing")}
      </Badge>
    );
  }
  if (status === "closed") {
    return (
      <Badge variant="outline" className="text-muted-foreground">
        {t("status.closed")}
      </Badge>
    );
  }
  return null;
}

/** 卡的到期 chip：90 天內琥珀色、過期紅色；正常時不顯示。today 由 server 給（台北日期）。 */
export function ExpiryChip({
  month,
  year,
  today,
}: Readonly<{ month: number | null; year: number | null; today: string }>) {
  const t = useTranslations("vendorBilling");
  const exp = cardExpiry(month, year, today);
  if (!exp || exp.state === "ok") return null;
  if (exp.state === "expired") {
    return (
      <Badge variant="outline" className="border-destructive/40 text-destructive">
        {t("cell.expired")}
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="border-amber-500/40 text-amber-700 dark:text-amber-400">
      {t("cell.daysLeft", { days: exp.daysLeft })}
    </Badge>
  );
}

export function expiryText(month: number | null, year: number | null): string {
  if (!month || !year) return "—";
  return `${String(month).padStart(2, "0")}/${year}`;
}

/** 整列可點的表格列（鍵盤 Enter / Space 也能開）。點到列內的按鈕或連結時不觸發。 */
export function ClickableRow({
  onOpen,
  children,
  className,
}: Readonly<{ onOpen: () => void; children: React.ReactNode; className?: string }>) {
  const hitInteractive = (target: EventTarget | null) =>
    Boolean((target as HTMLElement | null)?.closest("button, a, input, label"));
  return (
    <TableRow
      role="button"
      tabIndex={0}
      aria-haspopup="dialog"
      className={cn(
        "cursor-pointer hover:bg-muted/50 focus-visible:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
        className,
      )}
      onClick={(e) => {
        if (!hitInteractive(e.target)) onOpen();
      }}
      onKeyDown={(e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        if (hitInteractive(e.target)) return;
        e.preventDefault();
        onOpen();
      }}
    >
      {children}
    </TableRow>
  );
}

/** 關 Sheet 前「放棄未儲存的變更？」。 */
export function DiscardDialog({
  open,
  onOpenChange,
  onDiscard,
}: Readonly<{ open: boolean; onOpenChange: (open: boolean) => void; onDiscard: () => void }>) {
  const t = useTranslations("vendorBilling");
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("discard.title")}</AlertDialogTitle>
          <AlertDialogDescription>{t("discard.description")}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t("discard.keepEditing")}</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            onClick={() => {
              onOpenChange(false);
              onDiscard();
            }}
          >
            {t("discard.confirm")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** 刪除確認；等 server 回來才關，失敗時留著。 */
export function DeleteDialog({
  open,
  onOpenChange,
  title,
  description,
  pending,
  onConfirm,
}: Readonly<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  pending: boolean;
  onConfirm: () => void;
}>) {
  const t = useTranslations("vendorBilling");
  return (
    <AlertDialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{t("actions.cancel")}</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={pending}
            onClick={(e) => {
              e.preventDefault();
              onConfirm();
            }}
          >
            {t("actions.delete")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Sheet 表單底部：左邊刪除（手動建立的才有），右邊儲存（沒改過就不能按）。 */
export function FormActions({
  canDelete,
  dirty,
  saving,
  deleting,
  onDelete,
}: Readonly<{ canDelete: boolean; dirty: boolean; saving: boolean; deleting: boolean; onDelete: () => void }>) {
  const t = useTranslations("vendorBilling");
  return (
    <div className="flex items-center gap-2 sm:col-span-2">
      {canDelete ? (
        <Button
          type="button"
          variant="ghost"
          className="text-destructive hover:text-destructive"
          onClick={onDelete}
          disabled={saving || deleting}
        >
          {t("actions.delete")}
        </Button>
      ) : null}
      <Button type="submit" className="ml-auto" disabled={!dirty || saving || deleting}>
        {saving ? t("actions.saving") : t("actions.save")}
      </Button>
    </div>
  );
}

export function FormError({ message }: Readonly<{ message: string | null }>) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive sm:col-span-2">
      {message}
    </p>
  );
}

export const textareaClass =
  "flex min-h-16 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs transition-[color,box-shadow] outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30";

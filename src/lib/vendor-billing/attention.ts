import { daysBetween, MATCH_WINDOW_DAYS, type MatchStatus } from "./match";

// 廠商計費頁上方「需要處理」清單的判斷規則（純函式；client 與 server 都會用）。
//
//   - 卡（card / wise_card）90 天內到期或已過期
//   - 使用中的計費帳號沒有付款方式
//   - Azure 同步到的卡跟多張手動卡資料相同（不知道該收編哪一張），請人合併
//   - 手動登記的帳號超過 180 天沒人確認（或從沒確認過）
//   - 發票日超過 45 天仍沒對到交易（unmatched / suggested）
//   - 平台說帳單逾期未付（Azure status OverDue / PastDue，或發票日過了 30 天還有 amountDue）
//   - 同步的帳號 / 資源最近 30 天變成 missing（平台上找不到了）

export const CARD_WARN_DAYS = 90;
export const VERIFY_STALE_DAYS = 180;
export const MISSING_RECENT_DAYS = 30;
export const AMOUNT_DUE_GRACE_DAYS = 30;

export type ExpiryState = "ok" | "warn" | "expired";

/** 卡在到期月的最後一天之後失效。回傳還剩幾天（負數 = 已過期）與狀態。 */
export function cardExpiry(
  month: number | null,
  year: number | null,
  today: string,
): { state: ExpiryState; daysLeft: number } | null {
  if (!month || !year || month < 1 || month > 12) return null;
  // 下個月 1 號的前一天 = 到期月最後一天
  const lastDay = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  const daysLeft = daysBetween(today, lastDay);
  let state: ExpiryState = "ok";
  if (daysLeft < 0) state = "expired";
  else if (daysLeft <= CARD_WARN_DAYS) state = "warn";
  return { state, daysLeft };
}

export type AttentionPaymentMethod = {
  id: number;
  label: string;
  kind: string;
  isActive: boolean;
  expiryMonth: number | null;
  expiryYear: number | null;
};

export type AttentionAccount = {
  id: number;
  displayName: string;
  provider: string;
  source: string;
  status: string;
  paymentMethodId: number | null;
  /** ISO 時間或 null */
  lastVerifiedAt: string | null;
  /** 同步時卡片對到多張相同的手動卡（meta.paymentMethodConflict，卡的名稱）。 */
  cardConflict?: string | null;
  updatedAt: string;
};

export type AttentionResource = {
  id: number;
  billingAccountId: number;
  name: string | null;
  externalId: string;
  status: string;
  updatedAt: string;
};

export type AttentionInvoice = {
  id: number;
  billingAccountId: number;
  externalRef: string;
  invoiceDate: string;
  amount: number;
  currency: string;
  matchStatus: MatchStatus;
  /** 平台上的帳單狀態原文（Azure：Due / OverDue / Paid / Void…）。 */
  providerStatus: string | null;
  /** 平台說還沒付清的金額。 */
  amountDue: number | null;
};

export type AttentionItem =
  | { kind: "card_expired" | "card_expiring"; paymentMethodId: number; label: string; daysLeft: number }
  | { kind: "no_payment_method"; billingAccountId: number; label: string }
  | { kind: "duplicate_cards"; billingAccountId: number; label: string; card: string }
  | { kind: "stale_verification"; billingAccountId: number; label: string; days: number | null }
  | { kind: "invoice_unmatched"; invoiceId: number; billingAccountId: number; label: string; days: number }
  | {
      kind: "invoice_overdue";
      invoiceId: number;
      billingAccountId: number;
      label: string;
      amount: number;
      currency: string;
    }
  | { kind: "account_missing"; billingAccountId: number; label: string }
  | { kind: "resource_missing"; resourceId: number; billingAccountId: number; label: string };

const isCardKind = (k: string) => k === "card" || k === "wise_card";

/** 平台說這張帳單逾期未付。 */
export function isProviderOverdue(inv: Pick<AttentionInvoice, "providerStatus" | "amountDue" | "invoiceDate">, today: string): boolean {
  const st = (inv.providerStatus ?? "").toLowerCase().replaceAll(/[\s_-]/g, "");
  if (st === "overdue" || st === "pastdue") return true;
  if (st === "paid" || st === "void" || st === "voided") return false;
  return (inv.amountDue ?? 0) > 0 && daysBetween(inv.invoiceDate, today) > AMOUNT_DUE_GRACE_DAYS;
}

/**
 * 時間字串 → Date。DB 讀回來的 timestamptz 是 `2026-09-24 10:00:00.123+00`（空白分隔、
 * 時區只有小時），先整理成 ISO 8601 再解析；純日期當 UTC 午夜。
 */
export function parseTimestamp(s: string): Date {
  let x = s.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(x)) return new Date(`${x}T00:00:00Z`);
  x = x.replace(" ", "T");
  if (/[+-]\d{2}$/.test(x)) x += ":00";
  return new Date(x);
}

/** 時間字串 → 台北日期；壞值回 null。 */
function dayOf(iso: string | null): string | null {
  if (!iso) return null;
  const d = parseTimestamp(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function cardItems(today: string, pms: readonly AttentionPaymentMethod[]): AttentionItem[] {
  const out: AttentionItem[] = [];
  for (const pm of pms) {
    if (!pm.isActive || !isCardKind(pm.kind)) continue;
    const exp = cardExpiry(pm.expiryMonth, pm.expiryYear, today);
    if (!exp || exp.state === "ok") continue;
    out.push({
      kind: exp.state === "expired" ? "card_expired" : "card_expiring",
      paymentMethodId: pm.id,
      label: pm.label,
      daysLeft: exp.daysLeft,
    });
  }
  return out;
}

/** 狀態最近（MISSING_RECENT_DAYS 內）才變的。 */
function changedRecently(updatedAt: string, today: string): boolean {
  const changed = dayOf(updatedAt);
  return changed !== null && daysBetween(changed, today) <= MISSING_RECENT_DAYS;
}

function accountItems(today: string, a: AttentionAccount): AttentionItem[] {
  const out: AttentionItem[] = [];
  if (a.cardConflict) {
    out.push({ kind: "duplicate_cards", billingAccountId: a.id, label: a.displayName, card: a.cardConflict });
  } else if (a.status === "active" && a.paymentMethodId === null) {
    out.push({ kind: "no_payment_method", billingAccountId: a.id, label: a.displayName });
  }
  if (a.status === "active" && a.source === "manual") {
    const verified = dayOf(a.lastVerifiedAt);
    const days = verified ? daysBetween(verified, today) : null;
    if (days === null || days > VERIFY_STALE_DAYS) {
      out.push({ kind: "stale_verification", billingAccountId: a.id, label: a.displayName, days });
    }
  }
  if (a.status === "missing" && a.source === "synced" && changedRecently(a.updatedAt, today)) {
    out.push({ kind: "account_missing", billingAccountId: a.id, label: a.displayName });
  }
  return out;
}

function invoiceItems(today: string, inv: AttentionInvoice, accountName: string): AttentionItem[] {
  const out: AttentionItem[] = [];
  const label = `${accountName} · ${inv.externalRef}`;
  if (isProviderOverdue(inv, today)) {
    const due = inv.amountDue ?? 0;
    out.push({
      kind: "invoice_overdue",
      invoiceId: inv.id,
      billingAccountId: inv.billingAccountId,
      label,
      amount: due > 0 ? due : inv.amount,
      currency: inv.currency,
    });
  }
  const open = inv.matchStatus === "unmatched" || inv.matchStatus === "suggested";
  const days = daysBetween(inv.invoiceDate, today);
  if (open && inv.amount > 0 && days > MATCH_WINDOW_DAYS) {
    out.push({ kind: "invoice_unmatched", invoiceId: inv.id, billingAccountId: inv.billingAccountId, label, days });
  }
  return out;
}

export function computeAttention(input: {
  today: string;
  paymentMethods: readonly AttentionPaymentMethod[];
  accounts: readonly AttentionAccount[];
  resources: readonly AttentionResource[];
  invoices: readonly AttentionInvoice[];
}): AttentionItem[] {
  const { today } = input;
  const accountName = new Map(input.accounts.map((a) => [a.id, a.displayName]));
  const nameOf = (id: number) => accountName.get(id) ?? "";
  const resources: AttentionItem[] = input.resources
    .filter((r) => r.status === "missing" && changedRecently(r.updatedAt, today))
    .map((r) => ({
      kind: "resource_missing",
      resourceId: r.id,
      billingAccountId: r.billingAccountId,
      label: `${nameOf(r.billingAccountId)} · ${r.name ?? r.externalId}`,
    }));
  return [
    ...cardItems(today, input.paymentMethods),
    ...input.accounts.flatMap((a) => accountItems(today, a)),
    ...resources,
    ...input.invoices.flatMap((inv) => invoiceItems(today, inv, nameOf(inv.billingAccountId))),
  ];
}

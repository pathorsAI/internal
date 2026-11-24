/**
 * 開立發票 → 應收（docs/general-ledger.md §2.3）。
 * 收入在發票日認列；綁定的收款貸 ar。收款合計與含稅不同 → 在最後一筆收款日沖差額。
 */
import { postableIssuedInvoice, review } from "./post";
import { line, type Ctx } from "./resolve";
import { round2 } from "./round";
import type { LedgerKind, LedgerTransaction, Posting, ReviewItem } from "./types";

export type LinkedPayment = { txn: LedgerTransaction; amount: number | null };

export function postInvoices(ctx: Ctx, ledger: LedgerKind, linked: Map<number, LinkedPayment[]>): { postings: Posting[]; review: ReviewItem[] } {
  const postings: Posting[] = [];
  const reviews: ReviewItem[] = [];
  // 只有明確設定的起始日才切掉之前的發票：預設起始日是最早一筆交易，發票常常比第一筆收款早
  const start = ctx.inputs.settings.booksStartDate?.slice(0, 10) ?? null;

  for (const inv of ctx.inputs.invoices) {
    if (inv.direction !== "issued" || inv.status !== "valid") continue;
    const tax = round2(inv.tax ?? 0);
    const gross = round2(inv.amountGross ?? (inv.amountNet ?? 0) + tax);
    const net = round2(inv.amountNet ?? gross - tax);
    const pays = (linked.get(inv.id) ?? []).slice().sort((a, b) => (a.txn.txnDate < b.txn.txnDate ? -1 : a.txn.txnDate > b.txn.txnDate ? 1 : a.txn.id - b.txn.id));
    const date = inv.invoiceDate?.slice(0, 10) ?? null;

    if (pays.length === 0) {
      if (!start || !date || date >= start)
        reviews.push(review("invoice_unlinked", "warning", ledger, "invoice", inv.id, date, gross, { invoiceNumber: inv.invoiceNumber ?? "" }));
      continue;
    }
    if (!postableIssuedInvoice(ctx, inv.id) || !date) continue;
    if (start && date < start) continue;

    const first = pays[0].txn;
    const cat = first.categoryId != null ? ctx.categories.get(first.categoryId) : undefined;
    const revenueId = cat ? ctx.categoryAccount(cat).glAccountId : ctx.sys("uncategorized_income");
    const party = { partyId: inv.partyId };
    const lines = [line(ctx.sys("ar"), gross, party), line(revenueId, -net, party)];
    if (tax !== 0) lines.push(line(ctx.sys("output_vat"), -tax, party));
    postings.push({
      key: `invoice:${inv.id}:${ledger}`,
      ledger,
      date,
      sourceType: "invoice",
      sourceId: inv.id,
      memo: inv.invoiceNumber ?? "",
      fromSnapshot: false,
      lines,
    });

    // 有任何一筆收款換不了匯 → 不知道真正收了多少，先不沖差額
    if (pays.some((p) => p.amount == null)) continue;
    const received = round2(pays.reduce((s, p) => s + (p.amount ?? 0), 0));
    const diff = round2(gross - received); // > 0：少收；< 0：多收
    if (diff === 0) continue;
    const lastDate = pays[pays.length - 1].txn.txnDate.slice(0, 10);
    let offset: number | null = null;
    if (inv.foreignCurrency) offset = ctx.sys("fx_gain_loss");
    else if (Math.abs(diff) <= Math.max(100, gross * 0.01)) offset = ctx.sys("bank_fee");
    if (offset == null) {
      reviews.push(review("ar_residual", "warning", ledger, "invoice", inv.id, lastDate, diff, { invoiceNumber: inv.invoiceNumber ?? "", gross, received }));
      continue;
    }
    postings.push({
      key: `invoice:${inv.id}:${ledger}:residual`,
      ledger,
      date: lastDate,
      sourceType: "invoice",
      sourceId: inv.id,
      memo: inv.invoiceNumber ?? "",
      fromSnapshot: false,
      lines: [line(offset, diff, party), line(ctx.sys("ar"), -diff, party)],
    });
  }
  return { postings, review: reviews };
}

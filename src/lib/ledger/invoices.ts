/**
 * 開立發票 → 應收（docs/general-ledger.md §2.3）。
 * 收入在發票日認列；綁定的收款貸 ar。收款合計與含稅不同 → 在最後一筆收款日沖差額。
 */
import { compareStrings } from "./periods";
import { postableIssuedInvoice, review, type ReviewAt } from "./post";
import { line, type Ctx } from "./resolve";
import { round2 } from "./round";
import type { LedgerInvoice, LedgerKind, LedgerTransaction, Posting, ReviewItem } from "./types";

export type LinkedPayment = { txn: LedgerTransaction; amount: number | null };

type Result = { postings: Posting[]; review: ReviewItem[] };

export function postInvoices(ctx: Ctx, ledger: LedgerKind, linked: Map<number, LinkedPayment[]>): Result {
  const postings: Posting[] = [];
  const reviews: ReviewItem[] = [];
  // 只有明確設定的起始日才切掉之前的發票：預設起始日是最早一筆交易，發票常常比第一筆收款早
  const start = ctx.inputs.settings.booksStartDate?.slice(0, 10) ?? null;

  for (const inv of ctx.inputs.invoices) {
    if (inv.direction !== "issued" || inv.status !== "valid") continue;
    const r = postInvoice(ctx, ledger, inv, linked.get(inv.id) ?? [], start);
    postings.push(...r.postings);
    reviews.push(...r.review);
  }
  return { postings, review: reviews };
}

const byPaymentDate = (a: LinkedPayment, b: LinkedPayment) => compareStrings(a.txn.txnDate, b.txn.txnDate) || a.txn.id - b.txn.id;

function invoiceAmounts(inv: LedgerInvoice): { tax: number; gross: number; net: number } {
  const tax = round2(inv.tax ?? 0);
  const gross = round2(inv.amountGross ?? (inv.amountNet ?? 0) + tax);
  const net = round2(inv.amountNet ?? gross - tax);
  return { tax, gross, net };
}

/** 收入科目：第一筆收款的分類；沒分類 → 待分類收入。 */
function revenueAccount(ctx: Ctx, first: LedgerTransaction): number {
  const cat = first.categoryId == null ? undefined : ctx.categories.get(first.categoryId);
  return cat ? ctx.categoryAccount(cat).glAccountId : ctx.sys("uncategorized_income");
}

function postInvoice(ctx: Ctx, ledger: LedgerKind, inv: LedgerInvoice, linkedPays: LinkedPayment[], start: string | null): Result {
  const { tax, gross, net } = invoiceAmounts(inv);
  const pays = linkedPays.slice().sort(byPaymentDate);
  const date = inv.invoiceDate?.slice(0, 10) ?? null;
  const last = pays.at(-1);

  if (last === undefined) {
    const inBooks = !start || !date || date >= start;
    const unlinked = inBooks ? [review("invoice_unlinked", "warning", ledger, at(inv, date, gross), { invoiceNumber: inv.invoiceNumber ?? "" })] : [];
    return { postings: [], review: unlinked };
  }
  if (!postableIssuedInvoice(ctx, inv.id) || !date) return { postings: [], review: [] };
  if (start && date < start) return { postings: [], review: [] };

  const party = { partyId: inv.partyId };
  const lines = [line(ctx.sys("ar"), gross, party), line(revenueAccount(ctx, pays[0].txn), -net, party)];
  if (tax !== 0) lines.push(line(ctx.sys("output_vat"), -tax, party));
  const posting: Posting = {
    key: `invoice:${inv.id}:${ledger}`,
    ledger,
    date,
    sourceType: "invoice",
    sourceId: inv.id,
    memo: inv.invoiceNumber ?? "",
    fromSnapshot: false,
    lines,
  };
  const residual = postResidual(ctx, ledger, inv, pays, last.txn.txnDate.slice(0, 10), gross);
  return { postings: [posting, ...residual.postings], review: residual.review };
}

function at(inv: LedgerInvoice, date: string | null, amount: number): ReviewAt {
  return { sourceType: "invoice", sourceId: inv.id, date, amount };
}

/** 差額沖到哪：外幣發票 → 兌換損益；差額小（≤ 100 或 1%）→ 手續費；其他 → null（留給人看）。 */
function residualOffset(ctx: Ctx, inv: LedgerInvoice, diff: number, gross: number): number | null {
  if (inv.foreignCurrency) return ctx.sys("fx_gain_loss");
  if (Math.abs(diff) <= Math.max(100, gross * 0.01)) return ctx.sys("bank_fee");
  return null;
}

/** 收款合計與含稅不同 → 在最後一筆收款日沖差額。 */
function postResidual(ctx: Ctx, ledger: LedgerKind, inv: LedgerInvoice, pays: LinkedPayment[], lastDate: string, gross: number): Result {
  // 有任何一筆收款換不了匯 → 不知道真正收了多少，先不沖差額
  if (pays.some((p) => p.amount == null)) return { postings: [], review: [] };
  const received = round2(pays.reduce((s, p) => s + (p.amount ?? 0), 0));
  const diff = round2(gross - received); // > 0：少收；< 0：多收
  if (diff === 0) return { postings: [], review: [] };
  const offset = residualOffset(ctx, inv, diff, gross);
  if (offset == null) {
    return { postings: [], review: [review("ar_residual", "warning", ledger, at(inv, lastDate, diff), { invoiceNumber: inv.invoiceNumber ?? "", gross, received })] };
  }
  const party = { partyId: inv.partyId };
  return {
    postings: [
      {
        key: `invoice:${inv.id}:${ledger}:residual`,
        ledger,
        date: lastDate,
        sourceType: "invoice",
        sourceId: inv.id,
        memo: inv.invoiceNumber ?? "",
        fromSnapshot: false,
        lines: [line(offset, diff, party), line(ctx.sys("ar"), -diff, party)],
      },
    ],
    review: [],
  };
}

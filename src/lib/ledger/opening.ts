/**
 * 帳戶期初（docs/general-ledger.md §2.4）：opening_balance + 起始日前所有交易的原幣淨額，
 * 在起始日前一天記 借 帳戶、貸 期初權益科目。隱形帳戶只進管理帳。
 */
import { nativeFor, review } from "./post";
import { addDays } from "./periods";
import { line, type Ctx } from "./resolve";
import { round2 } from "./round";
import type { LedgerBankAccount, LedgerKind, LedgerTransaction, Posting, ReviewItem } from "./types";

export function postOpenings(ctx: Ctx, ledger: LedgerKind): { postings: Posting[]; review: ReviewItem[] } {
  const postings: Posting[] = [];
  const reviews: ReviewItem[] = [];
  const start = ctx.booksStart;
  if (!start) return { postings, review: reviews };
  const date = addDays(start, -1);

  const native = nativeBalances(ctx, start);

  for (const bank of ctx.inputs.bankAccounts) {
    if (ledger === "government" && bank.ledgerScope !== "government") continue;
    const n = round2(native.get(bank.id) ?? 0);
    if (n === 0) continue;
    const foreign = !ctx.fx.isFunctional(bank.currency);
    const hit = ctx.fx.rateAt(bank.currency, date);
    if (!hit) {
      reviews.push(review("missing_fx", "error", ledger, { sourceType: "opening", sourceId: bank.id, date, amount: n }, { currency: bank.currency, account: bank.name }));
      continue;
    }
    const amount = round2(n * hit.rate);
    const gl = ctx.bankAccountGl(bank).glAccountId;
    postings.push({
      key: `opening:${bank.id}:${ledger}`,
      ledger,
      date,
      sourceType: "opening",
      sourceId: bank.id,
      memo: bank.name,
      fromSnapshot: false,
      lines: [
        line(gl, amount, { bankAccountId: bank.id, currency: foreign ? bank.currency.toUpperCase() : null, fxAmount: foreign ? n : null }),
        line(ctx.openingEquityId, -amount),
      ],
    });
    reviews.push(review("opening_balance", "info", ledger, { sourceType: "opening", sourceId: bank.id, date, amount }, { account: bank.name, native: n, currency: bank.currency }));
  }
  return { postings, review: reviews };
}

/** 每個帳戶在起始日前的原幣餘額：opening_balance ＋ 起始日前所有交易的原幣淨額。 */
function nativeBalances(ctx: Ctx, start: string): Map<number, number> {
  const native = new Map<number, number>();
  for (const b of ctx.inputs.bankAccounts) native.set(b.id, b.openingBalance || 0);
  for (const t of ctx.inputs.transactions) {
    if (t.txnDate.slice(0, 10) < start) accumulate(ctx, native, t);
  }
  return native;
}

function accumulate(ctx: Ctx, native: Map<number, number>, t: LedgerTransaction): void {
  const conv = ctx.fx.toFunctional(t.amount, t.currency, t.amountTwd, t.txnDate.slice(0, 10));
  const add = (accountId: number | null, sign: 1 | -1) => {
    const bank = accountId == null ? undefined : ctx.banks.get(accountId);
    if (!bank) return;
    const n = nativeOn(ctx, t, bank, conv);
    if (n != null) native.set(bank.id, (native.get(bank.id) ?? 0) + sign * n);
  };
  if (t.type === "income") add(t.toAccountId, 1);
  else if (t.type === "expense" || t.type === "reimbursement") add(t.fromAccountId, -1);
  else if (t.type === "transfer") {
    add(t.toAccountId, 1);
    add(t.fromAccountId, -1);
  }
}

/** 同幣別不需要匯率；跨幣別換不了就略過（期初少算，靠對帳檢查抓）。 */
function nativeOn(ctx: Ctx, t: LedgerTransaction, bank: LedgerBankAccount, conv: { amount: number } | null): number | null {
  if (conv) return nativeFor(ctx, t, bank, conv.amount);
  if (bank.currency.toUpperCase() === t.currency.toUpperCase()) return t.amount;
  return null;
}

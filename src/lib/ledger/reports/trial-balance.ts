/** 試算表、權益變動表、科目明細（下鑽）。 */
import { createCtx } from "../resolve";
import { round2 } from "../round";
import type { EquityChangesRow, LedgerInputs, LedgerKind, LedgerLine, Period, TrialBalanceRow } from "../types";
import { balances, sumWhere } from "./common";
import { periodPostings } from "./income-statement";

export function trialBalance(inputs: LedgerInputs, ledger: LedgerKind, period: Period): TrialBalanceRow[] {
  const ctx = createCtx(inputs);
  const postings = periodPostings(inputs, ledger, period, ctx);
  const opening = balances(postings, (p) => p.date < period.from);
  const debit = new Map<number, number>();
  const credit = new Map<number, number>();
  for (const p of postings) {
    if (p.date < period.from || p.date > period.to) continue;
    for (const l of p.lines) {
      debit.set(l.glAccountId, (debit.get(l.glAccountId) ?? 0) + l.debit);
      credit.set(l.glAccountId, (credit.get(l.glAccountId) ?? 0) + l.credit);
    }
  }
  const out: TrialBalanceRow[] = [];
  for (const a of [...inputs.accounts].sort((x, y) => (x.code < y.code ? -1 : x.code > y.code ? 1 : 0))) {
    const o = opening.get(a.id) ?? 0;
    const d = round2(debit.get(a.id) ?? 0);
    const c = round2(credit.get(a.id) ?? 0);
    if (o === 0 && d === 0 && c === 0) continue;
    out.push({ glAccountId: a.id, code: a.code, name: a.name, type: a.type, opening: o, debit: d, credit: c, closing: round2(o + d - c) });
  }
  return out;
}

/**
 * 權益變動表。欄：股本（equity 且 cashFlow = financing，含 capital）、保留盈餘（retained_earnings 科目＋累積損益）、
 * 其他權益。列：期初、本期淨利、股本變動、其他、期末。
 */
export function equityChanges(inputs: LedgerInputs, ledger: LedgerKind, period: Period): EquityChangesRow[] {
  const ctx = createCtx(inputs);
  const postings = periodPostings(inputs, ledger, period, ctx);
  const retainedId = ctx.sys("retained_earnings");
  const isEquity = (id: number) => ctx.accounts.get(id)?.type === "equity" && !ctx.isPL(id);
  const isCapital = (id: number) => id !== retainedId && isEquity(id) && ctx.accounts.get(id)?.cashFlow === "financing";
  const isOther = (id: number) => id !== retainedId && isEquity(id) && !isCapital(id);
  const before = balances(postings, (p) => p.date < period.from);
  const during = balances(postings, (p) => p.date >= period.from && p.date <= period.to);

  // 貸方為正
  const open = {
    capital: -sumWhere(before, isCapital),
    retained: -sumWhere(before, (id) => id === retainedId || ctx.isPL(id)),
    other: -sumWhere(before, isOther),
  };
  const ni = -sumWhere(during, (id) => ctx.isPL(id));
  const capitalChange = -sumWhere(during, isCapital);
  const otherRetained = -(during.get(retainedId) ?? 0);
  const otherChange = -sumWhere(during, isOther);

  const mk = (key: EquityChangesRow["key"], capital: number, retained: number, other: number): EquityChangesRow => ({
    key,
    capital: round2(capital),
    retained: round2(retained),
    other: round2(other),
    total: round2(capital + retained + other),
  });
  return [
    mk("opening", open.capital, open.retained, open.other),
    mk("net_income", 0, ni, 0),
    mk("capital", capitalChange, 0, 0),
    mk("other", 0, otherRetained, otherChange),
    mk("closing", open.capital + capitalChange, open.retained + ni + otherRetained, open.other + otherChange),
  ];
}

/** 某科目某期間的明細，一張分錄一行，balance 從期初累計（借正貸負）。 */
export function accountLedger(inputs: LedgerInputs, ledger: LedgerKind, glAccountId: number, period: Period): LedgerLine[] {
  const ctx = createCtx(inputs);
  const postings = periodPostings(inputs, ledger, period, ctx);
  let balance = 0;
  const out: LedgerLine[] = [];
  for (const p of postings) {
    if (p.date > period.to) continue;
    const mine = p.lines.filter((l) => l.glAccountId === glAccountId);
    if (mine.length === 0) continue;
    const d = mine.reduce((s, l) => s + l.debit, 0);
    const c = mine.reduce((s, l) => s + l.credit, 0);
    balance = round2(balance + d - c);
    if (p.date < period.from) continue;
    const counter = [...new Set(p.lines.filter((l) => l.glAccountId !== glAccountId).map((l) => ctx.accounts.get(l.glAccountId)?.code ?? String(l.glAccountId)))];
    out.push({
      date: p.date,
      postingKey: p.key,
      sourceType: p.sourceType,
      sourceId: p.sourceId,
      memo: p.memo,
      debit: round2(d),
      credit: round2(c),
      balance,
      counterAccounts: counter,
    });
  }
  return out;
}

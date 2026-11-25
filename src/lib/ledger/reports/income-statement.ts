/**
 * 綜合損益表：期間內的損益科目，依模組區塊與小計排列。
 * build 到 to，並在 from 前一天加外幣評價邊界，未實現兌換損益 = R(to) − R(from−1)。
 */
import { buildInternal } from "../build";
import type { SubtotalDef } from "../module";
import { addDays } from "../periods";
import { createCtx, type Ctx } from "../resolve";
import { round2 } from "../round";
import type { LedgerInputs, LedgerKind, Period, Posting, Statement, StatementRow } from "../types";
import { balances, orderedSections, row, sectionBlock } from "./common";

export function periodPostings(inputs: LedgerInputs, ledger: LedgerKind, period: Period, ctx: Ctx): Posting[] {
  return buildInternal(inputs, ledger, period.to, { boundaries: [addDays(period.from, -1)], ctx }).postings;
}

export function periodPL(inputs: LedgerInputs, ledger: LedgerKind, period: Period, ctx: Ctx): Map<number, number> {
  const postings = periodPostings(inputs, ledger, period, ctx);
  return balances(postings, (p, l) => p.date >= period.from && p.date <= period.to && ctx.isPL(l.glAccountId));
}

/** 本期淨利（貸方為正）。 */
export function netIncome(pl: Map<number, number>): number {
  let s = 0;
  for (const v of pl.values()) s -= v;
  return round2(s);
}

/** 小計的各項（"-key" 表示減）加總，回傳 [本期, 比較期]。 */
function sumTerms(terms: string[], totals: Map<string, [number, number]>): [number, number] {
  let a = 0;
  let c = 0;
  for (const term of terms) {
    const neg = term.startsWith("-");
    const t = totals.get(neg ? term.slice(1) : term) ?? [0, 0];
    a += neg ? -t[0] : t[0];
    c += neg ? -t[1] : t[1];
  }
  return [a, c];
}

function coversAll(terms: string[], keys: string[]): boolean {
  return keys.every((k) => terms.some((t) => t.replace(/^-/, "") === k));
}

function subtotalRow(sub: SubtotalDef, totals: Map<string, [number, number]>, allKeys: string[], hasCompare: boolean): StatementRow {
  const [a, c] = sumTerms(sub.sum, totals);
  // 涵蓋全部損益區塊的小計就是本期淨利 → 當總計
  const kind = coversAll(sub.sum, allKeys) ? "total" : "subtotal";
  return row(`subtotal:${sub.key}`, kind, `subtotals.${sub.key}`, a, hasCompare ? c : null);
}

export function incomeStatement(inputs: LedgerInputs, ledger: LedgerKind, period: Period, compare: Period | null): Statement {
  const ctx = createCtx(inputs);
  const main = periodPL(inputs, ledger, period, ctx);
  const cmp = compare ? periodPL(inputs, ledger, compare, ctx) : null;
  const sections = orderedSections(ctx, "income_statement");
  const totals = new Map<string, [number, number]>();
  const rows: StatementRow[] = [];
  const allKeys = sections.map((s) => s.key);
  let coveredAll = false;

  for (const s of sections) {
    const block = sectionBlock(ctx, s, main, cmp);
    rows.push(...block.rows);
    totals.set(s.key, [block.total, block.compareTotal ?? 0]);
    for (const sub of ctx.module.incomeSubtotals.filter((x) => x.after === s.key)) {
      const r = subtotalRow(sub, totals, allKeys, cmp != null);
      if (r.kind === "total") coveredAll = true;
      rows.push(r);
    }
  }
  if (!coveredAll) rows.push(row("totals.net_income", "total", "totals.net_income", netIncome(main), cmp ? netIncome(cmp) : null));
  return { kind: "income_statement", ledger, period, comparePeriod: compare, rows };
}

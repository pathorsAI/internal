/** 報表共用：餘額加總、依模組區塊產生列。 */
import type { SectionDef } from "../module";
import type { Ctx } from "../resolve";
import { round2 } from "../round";
import type { Posting, PostingLine, StatementRow } from "../types";

/** 每科目 Σ(借 − 貸)。 */
export function balances(postings: Posting[], pred: (p: Posting, l: PostingLine) => boolean = () => true): Map<number, number> {
  const out = new Map<number, number>();
  for (const p of postings) for (const l of p.lines) if (pred(p, l)) out.set(l.glAccountId, (out.get(l.glAccountId) ?? 0) + l.debit - l.credit);
  for (const [k, v] of out) out.set(k, round2(v));
  return out;
}

export function sumWhere(map: Map<number, number>, pred: (id: number) => boolean): number {
  let s = 0;
  for (const [id, v] of map) if (pred(id)) s += v;
  return round2(s);
}

export function orderedSections(ctx: Ctx, statement: SectionDef["statement"]): SectionDef[] {
  return ctx.module.sections.filter((s) => s.statement === statement).sort((a, b) => a.order - b.order);
}

/** 依科目代碼排序（字串比較，相同為 0）。 */
export function byCode(a: { code: string }, b: { code: string }): number {
  if (a.code < b.code) return -1;
  if (a.code > b.code) return 1;
  return 0;
}

export const row = (
  key: string,
  kind: StatementRow["kind"],
  label: string,
  amount: number,
  compareAmount: number | null,
  extra: Partial<StatementRow> = {},
): StatementRow => ({ key, kind, label, code: null, glAccountId: null, level: kind === "account" ? 1 : 0, amount: round2(amount), compareAmount: compareAmount == null ? null : round2(compareAmount), ...extra });

/**
 * 一個區塊：表頭、科目列（兩期都是 0 的不列）、區塊合計。金額 = sign × (借 − 貸)。
 * 回傳合計（已帶 sign），給小計與總計用。
 */
export function sectionBlock(
  ctx: Ctx,
  section: SectionDef,
  main: Map<number, number>,
  cmp: Map<number, number> | null,
  opts: { exclude?: Set<number>; include?: Set<number>; extraRows?: { key: string; label: string; amount: number; compare: number | null }[] } = {},
): { rows: StatementRow[]; total: number; compareTotal: number | null } {
  const rows: StatementRow[] = [row(`section:${section.key}`, "header", `sections.${section.key}`, 0, null)];
  let total = 0;
  let compareTotal = 0;
  const accounts = ctx.inputs.accounts
    .filter((a) => (ctx.sectionOf(a.id)?.key === section.key || opts.include?.has(a.id)) && !opts.exclude?.has(a.id))
    .sort(byCode);
  for (const a of accounts) {
    const amt = section.sign * (main.get(a.id) ?? 0);
    const c = cmp ? section.sign * (cmp.get(a.id) ?? 0) : null;
    if (round2(amt) === 0 && (c == null || round2(c) === 0)) continue;
    total += amt;
    compareTotal += c ?? 0;
    rows.push(row(`account:${a.id}`, "account", a.name, amt, c, { code: a.code, glAccountId: a.id }));
  }
  for (const x of opts.extraRows ?? []) {
    total += x.amount;
    compareTotal += x.compare ?? 0;
    rows.push(row(x.key, "account", x.label, x.amount, x.compare));
  }
  rows.push(row(`section_total:${section.key}`, "subtotal", `section_totals.${section.key}`, total, cmp ? compareTotal : null));
  return { rows, total: round2(total), compareTotal: cmp ? round2(compareTotal) : null };
}

/**
 * 外幣評價（docs/general-ledger.md §2.4），只在 build 時產生、不存快照。
 *
 * 做法：令 R(D) = Σ（原幣餘額 × D 的匯率 − 本位幣帳面）＝ D 當天累計的未實現兌換損益。
 *   - 每個月底（以及報表需要的期間邊界，例如損益表 from 的前一天）D < asOf：
 *     D 記一張 R(D)，D+1 記一張反向沖回。
 *   - asOf 當天記一張 R(asOf)，不沖回。
 * 這樣任何「月初（或指定邊界）起、到 asOf」的期間，損益上的未實現兌換損益剛好是 R(to) − R(from−1)，
 * 而 asOf 的資產負債表只剩 R(asOf)。累積盈虧（會計年度開始前）帶著 R(年度開始前一天)，
 * 本期損益只認列年度內的變動 → 損益表淨利 ＝ 資產負債表「本期損益」。
 */
import { addDays, compareStrings, monthEnd, monthStart, addMonths } from "./periods";
import { review } from "./post";
import { line, type Ctx } from "./resolve";
import { round2 } from "./round";
import type { LedgerKind, Posting, PostingLine, ReviewItem } from "./types";

type Group = { glAccountId: number; bankAccountId: number | null; currency: string; native: number; functional: number };

export function postRevaluations(
  ctx: Ctx,
  ledger: LedgerKind,
  base: Posting[],
  asOf: string,
  boundaries: string[],
): { postings: Posting[]; review: ReviewItem[] } {
  const postings: Posting[] = [];
  const reviews: ReviewItem[] = [];
  const foreignLines: { date: string; l: PostingLine }[] = [];
  for (const p of base)
    for (const l of p.lines) if (l.currency && !ctx.fx.isFunctional(l.currency)) foreignLines.push({ date: p.date, l });
  if (foreignLines.length === 0) return { postings, review: reviews };
  foreignLines.sort((a, b) => compareStrings(a.date, b.date));

  const dates = new Set<string>();
  for (let m = monthStart(foreignLines[0].date); monthEnd(m) < asOf; m = addMonths(m, 1)) dates.add(monthEnd(m));
  for (const b of boundaries) if (b < asOf && b >= foreignLines[0].date) dates.add(b);
  const points = [...dates].sort(compareStrings);

  const fxGain = ctx.sys("fx_gain_loss");
  const groups = new Map<string, Group>();
  let i = 0;
  const advance = (d: string) => {
    for (; i < foreignLines.length && foreignLines[i].date <= d; i++) {
      const { l } = foreignLines[i];
      const k = `${l.glAccountId}|${l.bankAccountId}|${l.currency}`;
      const g = groups.get(k) ?? { glAccountId: l.glAccountId, bankAccountId: l.bankAccountId, currency: l.currency!.toUpperCase(), native: 0, functional: 0 };
      g.native += l.fxAmount ?? 0;
      g.functional += l.debit - l.credit;
      groups.set(k, g);
    }
  };

  const revalue = (d: string, final: boolean) => {
    advance(d);
    const lines: PostingLine[] = [];
    let total = 0;
    for (const g of groups.values()) {
      const hit = ctx.fx.rateAt(g.currency, d);
      if (!hit) {
        if (final) reviews.push(review("missing_fx", "error", ledger, { sourceType: "fx_revaluation", sourceId: null, date: d, amount: round2(g.native) }, { currency: g.currency }));
        continue;
      }
      const adj = round2(round2(g.native * hit.rate) - g.functional);
      if (adj === 0) continue;
      lines.push(line(g.glAccountId, adj, { bankAccountId: g.bankAccountId, currency: g.currency, fxAmount: 0 }));
      total += adj;
    }
    if (lines.length === 0) return;
    lines.push(line(fxGain, -round2(total)));
    const mk = (date: string, suffix: string, ls: PostingLine[]): Posting => ({
      key: `fx_revaluation:${d}:${ledger}${suffix}`,
      ledger,
      date,
      sourceType: "fx_revaluation",
      sourceId: null,
      memo: d,
      fromSnapshot: false,
      lines: ls,
    });
    postings.push(mk(d, "", lines));
    if (!final) {
      const reversed = lines.map((l) => ({ ...l, debit: l.credit, credit: l.debit }));
      postings.push(mk(addDays(d, 1), ":reversal", reversed));
    }
  };

  for (const d of points) revalue(d, false);
  revalue(asOf, true);
  return { postings, review: reviews };
}

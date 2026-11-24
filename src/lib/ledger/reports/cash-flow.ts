/**
 * 現金流量表（間接法）。每張分錄 Σ(借−貸)=0，所以「現金變動 = −Σ非現金行」，逐行分到各區：
 *   - 損益科目行 → 本期淨利
 *   - 折舊分錄的非損益行 → 加回折舊
 *   - 外幣評價：損益行另列「未實現兌換損益」扣回；現金行列「匯率影響」；非現金行不是現金流，略過
 *   - 其他非現金行 → 依科目 cashFlow 分到營業／投資／籌資（none 歸籌資）
 * 各分錄的貢獻都剛好等於它的現金行，所以期初現金 + 淨變動 = 期末現金一定成立。
 */
import { createCtx, type Ctx } from "../resolve";
import { round2 } from "../round";
import type { LedgerInputs, LedgerKind, Period, Statement, StatementRow } from "../types";
import { row } from "./common";
import { periodPostings } from "./income-statement";

type Bucket = "operating" | "investing" | "financing";

export type CashFlowData = {
  netIncome: number;
  depreciation: number;
  unrealizedFx: number;
  changes: Record<Bucket, Map<number, number>>;
  fxEffect: number;
  openingCash: number;
  closingCash: number;
};

export function cashFlowData(inputs: LedgerInputs, ledger: LedgerKind, period: Period, ctx: Ctx): CashFlowData {
  const postings = periodPostings(inputs, ledger, period, ctx);
  const d: CashFlowData = {
    netIncome: 0,
    depreciation: 0,
    unrealizedFx: 0,
    changes: { operating: new Map(), investing: new Map(), financing: new Map() },
    fxEffect: 0,
    openingCash: 0,
    closingCash: 0,
  };
  const isCash = (id: number) => ctx.accounts.get(id)?.cashFlow === "cash";
  for (const p of postings) {
    if (p.date > period.to) continue;
    const before = p.date < period.from;
    for (const l of p.lines) {
      const net = l.debit - l.credit;
      if (isCash(l.glAccountId)) {
        d.closingCash += net;
        if (before) d.openingCash += net;
        else if (p.sourceType === "fx_revaluation") d.fxEffect += net;
        continue;
      }
      if (before) continue;
      if (ctx.isPL(l.glAccountId)) {
        d.netIncome -= net;
        if (p.sourceType === "fx_revaluation") d.unrealizedFx += net;
        continue;
      }
      if (p.sourceType === "fx_revaluation") continue;
      if (p.sourceType === "depreciation") {
        d.depreciation -= net;
        continue;
      }
      const cf = ctx.accounts.get(l.glAccountId)?.cashFlow;
      const bucket: Bucket = cf === "operating" ? "operating" : cf === "investing" ? "investing" : "financing";
      d.changes[bucket].set(l.glAccountId, (d.changes[bucket].get(l.glAccountId) ?? 0) - net);
    }
  }
  // 期末現金直接加總現金科目（不從各區推），報表上「期初 + 淨變動 = 期末」才是真的檢查
  d.closingCash = round2(d.closingCash);
  d.openingCash = round2(d.openingCash);
  return d;
}

export function cashFlowStatement(inputs: LedgerInputs, ledger: LedgerKind, period: Period, compare: Period | null): Statement {
  const ctx = createCtx(inputs);
  const main = cashFlowData(inputs, ledger, period, ctx);
  const cmp = compare ? cashFlowData(inputs, ledger, compare, ctx) : null;
  const rows: StatementRow[] = [];
  const c = (v: number | undefined) => (cmp ? (v ?? 0) : null);
  const nz = (a: number, b: number | null) => round2(a) !== 0 || (b != null && round2(b) !== 0);

  const block = (bucket: Bucket, fixed: { key: string; amount: number; compare: number | null; always?: boolean }[]) => {
    rows.push(row(`cf.${bucket}`, "header", `cf.${bucket}`, 0, null));
    let total = 0;
    let ctotal = 0;
    for (const f of fixed) {
      total += f.amount;
      ctotal += f.compare ?? 0;
      if (f.always || nz(f.amount, f.compare)) rows.push(row(f.key, "account", f.key, f.amount, f.compare));
    }
    const ids = new Set([...main.changes[bucket].keys(), ...(cmp ? cmp.changes[bucket].keys() : [])]);
    const accounts = [...ids].map((id) => ctx.accounts.get(id)).filter((a) => a != null).sort((a, b) => (a.code < b.code ? -1 : 1));
    for (const a of accounts) {
      const amt = main.changes[bucket].get(a.id) ?? 0;
      const ca = c(cmp?.changes[bucket].get(a.id));
      total += amt;
      ctotal += ca ?? 0;
      if (nz(amt, ca)) rows.push(row(`cf.${bucket}:${a.id}`, "account", a.name, amt, ca, { code: a.code, glAccountId: a.id }));
    }
    // 科目表外的科目（理論上不會有）也要算進合計，不然對不上
    for (const [id, v] of main.changes[bucket]) if (!ctx.accounts.has(id)) total += v;
    rows.push(row(`cf.${bucket}_total`, "subtotal", `cf.${bucket}_total`, total, cmp ? ctotal : null));
    return [total, ctotal];
  };

  const [op, cop] = block("operating", [
    { key: "cf.net_income", amount: main.netIncome, compare: c(cmp?.netIncome), always: true },
    { key: "cf.depreciation", amount: main.depreciation, compare: c(cmp?.depreciation) },
    { key: "cf.unrealized_fx", amount: main.unrealizedFx, compare: c(cmp?.unrealizedFx) },
  ]);
  const [inv, cinv] = block("investing", []);
  const [fin, cfin] = block("financing", []);
  if (nz(main.fxEffect, c(cmp?.fxEffect))) rows.push(row("cf.fx_effect", "account", "cf.fx_effect", main.fxEffect, c(cmp?.fxEffect)));
  rows.push(row("cf.net_change", "total", "cf.net_change", op + inv + fin + main.fxEffect, cmp ? cop + cinv + cfin + cmp.fxEffect : null));
  rows.push(row("cf.opening_cash", "account", "cf.opening_cash", main.openingCash, c(cmp?.openingCash)));
  rows.push(row("cf.closing_cash", "total", "cf.closing_cash", main.closingCash, c(cmp?.closingCash)));
  return { kind: "cash_flow", ledger, period, comparePeriod: compare, rows };
}

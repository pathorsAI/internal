/**
 * 資產負債表（docs/general-ledger.md §3）。權益區自動加「累積盈虧」（年度開始前的損益＋未分配盈餘科目）
 * 與「本期損益」（年度開始到 asOf）。比較日另外 build 一次，外幣評價各用自己的日期。
 */
import { buildInternal } from "../build";
import { addDays, fiscalYearStart } from "../periods";
import { createCtx, equitySectionKey, type Ctx } from "../resolve";
import { round2 } from "../round";
import type { LedgerInputs, LedgerKind, Statement, StatementRow } from "../types";
import { balances, orderedSections, row, sectionBlock, sumWhere } from "./common";

export type BalanceSheetData = { balances: Map<number, number>; prior: number; current: number };

export function balanceSheetData(inputs: LedgerInputs, ledger: LedgerKind, asOf: string, ctx: Ctx = createCtx(inputs)): BalanceSheetData {
  const fy = fiscalYearStart(asOf, inputs.settings.fiscalYearStartMonth);
  const { postings } = buildInternal(inputs, ledger, asOf, { boundaries: [addDays(fy, -1)], ctx });
  const all = balances(postings);
  const beforeFy = balances(postings, (p) => p.date < fy);
  const retainedId = ctx.sys("retained_earnings");
  const pl = (id: number) => ctx.isPL(id);
  return {
    balances: all,
    // 貸方為正
    prior: round2(-sumWhere(beforeFy, pl) - (all.get(retainedId) ?? 0)),
    current: round2(-(sumWhere(all, pl) - sumWhere(beforeFy, pl))),
  };
}

export function balanceSheet(inputs: LedgerInputs, ledger: LedgerKind, asOf: string, compareAsOf: string | null): Statement {
  const ctx = createCtx(inputs);
  const main = balanceSheetData(inputs, ledger, asOf, ctx);
  const cmp = compareAsOf ? balanceSheetData(inputs, ledger, compareAsOf, ctx) : null;
  const sections = orderedSections(ctx, "balance_sheet");
  const equityKey = equitySectionKey(inputs.accounts, new Map(sections.map((s) => [s.key, s]))) ?? sections.filter((s) => s.sign === -1).pop()?.key;
  const exclude = new Set([ctx.sys("retained_earnings")]);
  // 股東往來是借方餘額（公司付了股東的錢、或政府帳上的股東取用）時，依台灣表達列在流動資產，不列成負的負債。
  // 以報表日（asOf）的餘額決定位置，比較欄跟著同一列。
  const shareholderId = ctx.sys("shareholder");
  const reclass = (main.balances.get(shareholderId) ?? 0) > 0.005 ? new Set([shareholderId]) : new Set<number>();
  const firstAssetKey = sections.find((s) => s.sign === 1 && s.key !== equityKey)?.key;

  const kindOf = (key: string): "asset" | "liability" | "equity" => (key === equityKey ? "equity" : sections.find((s) => s.key === key)!.sign === 1 ? "asset" : "liability");
  const lastIdx = (k: "asset" | "liability") => sections.map((s) => kindOf(s.key)).lastIndexOf(k);
  const lastAsset = lastIdx("asset");
  const lastLiab = lastIdx("liability");
  const totals = { asset: [0, 0], liability: [0, 0], equity: [0, 0] } as Record<string, [number, number]>;

  const rows: StatementRow[] = [];
  const pushTotal = (k: "asset" | "liability" | "equity") => {
    const label = k === "asset" ? "totals.assets" : k === "liability" ? "totals.liabilities" : "totals.equity";
    rows.push(row(label, "total", label, totals[k][0], cmp ? totals[k][1] : null));
  };
  sections.forEach((s, idx) => {
    const isEquity = s.key === equityKey;
    const block = sectionBlock(ctx, s, main.balances, cmp?.balances ?? null, {
      exclude: s.key === firstAssetKey ? exclude : new Set([...exclude, ...reclass]),
      include: s.key === firstAssetKey ? reclass : undefined,
      extraRows: isEquity
        ? [
            { key: "rows.prior_earnings", label: "rows.prior_earnings", amount: main.prior, compare: cmp?.prior ?? null },
            { key: "rows.current_earnings", label: "rows.current_earnings", amount: main.current, compare: cmp?.current ?? null },
          ]
        : [],
    });
    rows.push(...block.rows);
    const k = kindOf(s.key);
    totals[k][0] += block.total;
    totals[k][1] += block.compareTotal ?? 0;
    if (idx === lastAsset) pushTotal("asset");
    if (idx === lastLiab) pushTotal("liability");
    if (isEquity) pushTotal("equity");
  });
  rows.push(
    row("totals.liabilities_equity", "total", "totals.liabilities_equity", totals.liability[0] + totals.equity[0], cmp ? totals.liability[1] + totals.equity[1] : null),
  );
  return { kind: "balance_sheet", ledger, period: { from: asOf, to: asOf }, comparePeriod: compareAsOf ? { from: compareAsOf, to: compareAsOf } : null, rows };
}

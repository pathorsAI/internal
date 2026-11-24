/**
 * 直線法折舊（docs/general-ledger.md §2.4）：取得當月起每月月底一筆，最後一個月吸收尾差，
 * 處分月（含）之後不再提。帳別跟著來源交易：來源 book = internal → 只在管理帳。
 */
import { addMonths, monthEnd, monthStart, ym } from "./periods";
import { line, type Ctx } from "./resolve";
import { round2 } from "./round";
import type { LedgerKind, Posting } from "./types";

export function postDepreciation(ctx: Ctx, ledger: LedgerKind, asOf: string): Posting[] {
  const out: Posting[] = [];
  const expense = ctx.sys("depreciation_expense");
  const accumulated = ctx.sys("accumulated_depreciation");
  for (const fa of ctx.inputs.fixedAssets) {
    if (ledger === "government" && fa.sourceTransactionId != null) {
      const src = ctx.txns.get(fa.sourceTransactionId);
      if (src && src.book === "internal") continue;
    }
    const life = Math.trunc(fa.usefulLifeMonths);
    const total = round2(fa.cost - (fa.salvageValue || 0));
    if (life <= 0 || total <= 0) continue;
    const monthly = round2(total / life);
    const lastMonth = fa.disposedOn ? ym(fa.disposedOn) : null;
    let m = monthStart(fa.acquiredOn);
    let booked = 0;
    for (let i = 0; i < life; i++, m = addMonths(m, 1)) {
      const date = monthEnd(m);
      if (date > asOf) break;
      if (lastMonth && ym(m) > lastMonth) break;
      const amount = i === life - 1 ? round2(total - booked) : monthly;
      booked = round2(booked + amount);
      if (amount === 0) continue;
      out.push({
        key: `depreciation:${fa.id}:${ledger}:${ym(m)}`,
        ledger,
        date,
        sourceType: "depreciation",
        sourceId: fa.id,
        memo: fa.name,
        fromSnapshot: false,
        lines: [line(expense, amount), line(accumulated, -amount)],
      });
    }
  }
  return out;
}

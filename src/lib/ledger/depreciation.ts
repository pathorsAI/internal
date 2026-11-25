/**
 * 直線法折舊（docs/general-ledger.md §2.4）：取得當月起每月月底一筆，最後一個月吸收尾差，
 * 處分月（含）之後不再提。帳別跟著來源交易：來源 book = internal → 只在管理帳。
 */
import { addMonths, monthEnd, monthStart, ym } from "./periods";
import { line, type Ctx } from "./resolve";
import { round2 } from "./round";
import type { FixedAsset, LedgerKind, Posting } from "./types";

export function postDepreciation(ctx: Ctx, ledger: LedgerKind, asOf: string): Posting[] {
  const accounts = { expense: ctx.sys("depreciation_expense"), accumulated: ctx.sys("accumulated_depreciation") };
  const out: Posting[] = [];
  for (const fa of ctx.inputs.fixedAssets) {
    if (managementOnly(ctx, ledger, fa)) continue;
    out.push(...assetSchedule(fa, ledger, asOf, accounts));
  }
  return out;
}

/** 政府帳不提來源交易 book = internal 的財產。 */
function managementOnly(ctx: Ctx, ledger: LedgerKind, fa: FixedAsset): boolean {
  if (ledger !== "government" || fa.sourceTransactionId == null) return false;
  return ctx.txns.get(fa.sourceTransactionId)?.book === "internal";
}

/** 一項財產到 asOf（且不超過處分月）為止每月的折舊分錄。 */
function assetSchedule(fa: FixedAsset, ledger: LedgerKind, asOf: string, accounts: { expense: number; accumulated: number }): Posting[] {
  const out: Posting[] = [];
  const life = Math.trunc(fa.usefulLifeMonths);
  const total = round2(fa.cost - (fa.salvageValue || 0));
  if (life <= 0 || total <= 0) return out;
  const monthly = round2(total / life);
  const lastMonth = fa.disposedOn ? ym(fa.disposedOn) : null;
  let m = monthStart(fa.acquiredOn);
  let booked = 0;
  for (let i = 0; i < life; i++, m = addMonths(m, 1)) {
    const date = monthEnd(m);
    if (date > asOf || (lastMonth && ym(m) > lastMonth)) break;
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
      lines: [line(accounts.expense, amount), line(accounts.accumulated, -amount)],
    });
  }
  return out;
}

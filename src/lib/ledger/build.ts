/**
 * 組出一本帳到 asOf 的全部分錄：engine（交易、發票、期初、折舊）＋手動分錄，已結帳月份改讀快照，
 * 最後依 revaluation.ts 的方式加外幣評價。純函式，同樣輸入一定同樣輸出。
 */
import { postDepreciation } from "./depreciation";
import { postInvoices, type LinkedPayment } from "./invoices";
import { postOpenings } from "./opening";
import { compareStrings, monthEndOf, ym } from "./periods";
import { postTransaction, review } from "./post";
import { createCtx, type Ctx } from "./resolve";
import { postRevaluations } from "./revaluation";
import { round2 } from "./round";
import type { BuildResult, LedgerInputs, LedgerKind, Posting, PostingLine, ReviewItem, StoredEntry } from "./types";

export type InternalBuildOptions = {
  /** 額外的外幣評價邊界（期間起日前一天），讓任意起日的損益表也拿得到正確的未實現損益。 */
  boundaries?: string[];
  /** 當作沒結帳的月份（重算快照用）。 */
  ignoreClosed?: string[];
  /** 共用同一份查表，報表連 build 好幾次時省重建。 */
  ctx?: Ctx;
};

const byDateKey = (a: Posting, b: Posting) => compareStrings(a.date, b.date) || compareStrings(a.key, b.key);

function pushTo<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key) ?? [];
  list.push(value);
  map.set(key, list);
}

export function buildInternal(inputs: LedgerInputs, ledger: LedgerKind, asOf: string, opts: InternalBuildOptions = {}): BuildResult & { ctx: Ctx } {
  const ctx = opts.ctx ?? createCtx(inputs);
  const txns = postAllTransactions(inputs, ctx, ledger);
  const engine: Posting[] = [...txns.postings];
  const reviews: ReviewItem[] = [...txns.reviews];

  const inv = postInvoices(ctx, ledger, txns.linked);
  engine.push(...inv.postings);
  reviews.push(...inv.review);
  const open = postOpenings(ctx, ledger);
  engine.push(...open.postings);
  reviews.push(...open.review);
  engine.push(...postDepreciation(ctx, ledger, asOf));

  // 已結帳月份：engine 的結果丟掉，改用快照
  const ignore = new Set(opts.ignoreClosed ?? []);
  const closed = new Set(inputs.closedPeriods.filter((p) => !ignore.has(p)));
  // 明確設定起始日時，起始日前的折舊不提（那段已併進期初）；預設起始日（最早交易）不切，免得切掉更早取得的財產
  const explicitStart = inputs.settings.booksStartDate?.slice(0, 10) ?? null;
  const base: Posting[] = engine.filter((p) => !closed.has(ym(p.date)) && !(explicitStart && p.sourceType === "depreciation" && p.date < explicitStart));
  base.push(...storedPostings(inputs, ctx, ledger, closed));

  const inRange = base.filter((p) => p.date <= asOf);
  const reval = postRevaluations(ctx, ledger, inRange, asOf, opts.boundaries ?? []);
  reviews.push(...reval.review);
  const postings = [...inRange, ...reval.postings].sort(byDateKey);
  return { postings, review: reviews.filter((r) => !r.date || r.date <= asOf), ctx };
}

/** 分類是換匯的 income／expense，依日期分組（同一天只有一筆 → 換匯只有一邊）。 */
function transferKindByDate(inputs: LedgerInputs, ctx: Ctx): Map<string, number[]> {
  const out = new Map<string, number[]>();
  for (const t of inputs.transactions) {
    const cat = t.categoryId == null ? undefined : ctx.categories.get(t.categoryId);
    if (cat?.kind === "transfer" && (t.type === "income" || t.type === "expense")) pushTo(out, t.txnDate.slice(0, 10), t.id);
  }
  return out;
}

/** 交易 → 分錄；順便收集綁了發票的收款，給 postInvoices 用。 */
function postAllTransactions(inputs: LedgerInputs, ctx: Ctx, ledger: LedgerKind): { postings: Posting[]; reviews: ReviewItem[]; linked: Map<number, LinkedPayment[]> } {
  const start = ctx.booksStart;
  const postings: Posting[] = [];
  const reviews: ReviewItem[] = [];
  const linked = new Map<number, LinkedPayment[]>();
  const transfersByDate = transferKindByDate(inputs, ctx);
  for (const t of inputs.transactions) {
    const date = t.txnDate.slice(0, 10);
    if (start && date < start) continue; // 起始日前的交易併進期初
    const r = postTransaction(ctx, t, ledger);
    reviews.push(...r.review);
    if (r.posting) postings.push(r.posting);
    if (t.type === "income" && t.invoiceId != null) pushTo(linked, t.invoiceId, { txn: t, amount: r.functionalAmount });
    const sameDay = transfersByDate.get(date);
    if (r.posting && sameDay?.length === 1 && sameDay[0] === t.id) {
      reviews.push(review("fx_transfer_one_sided", "warning", ledger, { sourceType: "transaction", sourceId: t.id, date, amount: r.functionalAmount }, {}));
    }
  }
  return { postings, reviews, linked };
}

/** 快照存的是哪個月：有存年月用年月，否則看分錄日。 */
function snapshotMonthOf(e: StoredEntry): string {
  if (e.snapshotYear != null && e.snapshotMonth != null) return `${e.snapshotYear}-${String(e.snapshotMonth).padStart(2, "0")}`;
  return ym(e.entryDate);
}

/** 已結帳月份的快照＋這本帳的手動分錄。 */
function storedPostings(inputs: LedgerInputs, ctx: Ctx, ledger: LedgerKind, closed: Set<string>): Posting[] {
  const bankByGl = inferBankByGl(ctx);
  const out: Posting[] = [];
  for (const e of inputs.entries) {
    if (e.kind === "snapshot") {
      if (e.ledger === ledger && closed.has(snapshotMonthOf(e))) out.push(storedToPosting(e, ledger, true, bankByGl));
    } else if (e.ledger === ledger || e.ledger === "both") {
      out.push(storedToPosting(e, ledger, false, bankByGl));
    }
  }
  return out;
}

/** 快照與手動分錄沒有存 bankAccountId 時，科目只對到一個銀行帳戶就推回那個帳戶。 */
function inferBankByGl(ctx: Ctx): Map<number, number> {
  const seen = new Map<number, number[]>();
  for (const b of ctx.inputs.bankAccounts) {
    const gl = ctx.bankAccountGl(b).glAccountId;
    seen.set(gl, [...(seen.get(gl) ?? []), b.id]);
  }
  const out = new Map<number, number>();
  for (const [gl, ids] of seen) if (ids.length === 1) out.set(gl, ids[0]);
  return out;
}

function storedToPosting(e: StoredEntry, ledger: LedgerKind, fromSnapshot: boolean, bankByGl: Map<number, number>): Posting {
  const sourceType = fromSnapshot ? (e.sourceType ?? "manual") : "manual";
  const sourceId = fromSnapshot ? e.sourceId : e.id;
  const lines: PostingLine[] = e.lines.map((l) => ({
    glAccountId: l.glAccountId,
    debit: round2(l.debit),
    credit: round2(l.credit),
    currency: l.currency,
    fxAmount: l.fxAmount,
    partyId: l.partyId,
    employeeId: l.employeeId,
    bankAccountId: l.bankAccountId ?? bankByGl.get(l.glAccountId) ?? null,
    memo: l.memo,
  }));
  return {
    key: fromSnapshot ? `${sourceType}:${sourceId}:${ledger}:snapshot:${e.id}` : `manual:${e.id}:${ledger}`,
    ledger,
    date: e.entryDate.slice(0, 10),
    sourceType,
    sourceId,
    memo: e.memo ?? "",
    fromSnapshot,
    lines,
  };
}

export function buildLedger(inputs: LedgerInputs, opts: { ledger: LedgerKind; asOf: string }): BuildResult {
  const { postings, review } = buildInternal(inputs, opts.ledger, opts.asOf);
  return { postings, review };
}

export function computeSnapshot(inputs: LedgerInputs, ledger: LedgerKind, year: number, month: number): Posting[] {
  const end = monthEndOf(year, month);
  const key = end.slice(0, 7);
  const { postings } = buildInternal(inputs, ledger, end, { ignoreClosed: [key] });
  return postings.filter((p) => ym(p.date) === key && p.sourceType !== "fx_revaluation" && p.sourceType !== "manual" && !p.fromSnapshot);
}

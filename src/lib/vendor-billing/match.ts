// 雲端帳單 ↔ 帳本交易的對帳規則（純函式，不碰 DB；src/lib/vendor-billing/reconcile.ts 負責讀寫）。
//
// 背景：各組織每月照信用卡帳單手動記「每家廠商一筆」的支出（台幣、含國外手續費、
// from_account = 卡費扣款的銀行帳戶），而且一列常常涵蓋好幾張雲端發票 —— 東蜂的實例：
//   - 2026-04-13「auto flat Azure VM」8,964 = 3 月發票 4,626 + 4 月發票 4,338（兩個月合併）
//   - 「Google Cloud（4ZVNTM/MXMTKW/W28MNR/FCBXVH/Xw3FXS 合併，含國外手續費）1,722」
//     = 五個 GCP billing account 同一個月的費用
//   - 同一個 Azure 帳號，帳本上有時記在「Azure」、有時記在「Microsoft」
// 所以匯入的發票一律先找既有交易，絕不自己記帳（除非帳號明確設成 create_unmatched，
// 見 invoicesDueForCreation）。
//
// 候選交易 = 同組織、未刪除、type = expense、對象在發票帳號的「比對廠商」裡（party_id ∪
// meta.matchPartyIds）、還沒綁給別的發票組合。
//   1. 單張比對（交易日在 [發票日, 發票日 + 45 天]）：同幣別、金額比 txn / invoice 在
//      [0.98, 1.06]（卡費約 1.5% 國外手續費）。金額完全相同的優先（Azure 台幣發票實測就是
//      一模一樣，只差 5～7 天入帳）。不同幣別永遠不自動綁；視窗內剛好只有一筆候選時標「建議」。
//   2. 合併比對：對每一筆還沒用到的交易，從「發票日 ≤ 交易日 ≤ 發票日 + 75 天、同幣別、還沒綁」
//      的發票裡（跨帳號：只要帳號的比對廠商含這筆交易的對象）找 2～5 張加總落在比例內的組合。
//      剛好一組（或剛好一組完全相等）→ 全部綁到那一筆；多組 → 只給建議。
//   3. 1、2 交替跑到沒有新的配對為止（一筆綁走後，別的發票的候選可能變唯一）。
//   4. 唯一結果 → matched（自動）；有可能但不唯一 → suggested；都沒有 → unmatched。
// matched / manual / created / ignored 是定案狀態，這裡不會改；suggested 每次重算。
// 人工解除過的綁定記在發票 meta.rejectedTransactionIds：那筆交易不會再被自動配給這張發票
// （單張、合併、建議都一樣；合併時任何一張拒絕過就不能放進那筆交易的組合）。人工綁定不受限制。

export const MATCH_WINDOW_DAYS = 45;
export const GROUP_WINDOW_DAYS = 75;
export const GROUP_MAX_SIZE = 5;
/** 合併比對時一筆交易最多看幾張發票（避免組合爆炸）；取日期最近的。 */
const GROUP_POOL_LIMIT = 16;
export const RATIO_MIN = 0.98;
export const RATIO_MAX = 1.06;
const EXACT_EPS = 0.005;

export type MatchStatus = "unmatched" | "suggested" | "matched" | "manual" | "created" | "ignored";

export const MATCH_STATUSES: readonly MatchStatus[] = [
  "unmatched",
  "suggested",
  "matched",
  "manual",
  "created",
  "ignored",
];

/** 定案（不再自動重算）且綁著交易的狀態。這些交易不會再拿去配別的發票。 */
const FINAL: ReadonlySet<MatchStatus> = new Set(["matched", "manual", "created"]);

export type MatchInvoice = {
  id: number;
  billingAccountId: number;
  /** 帳號的比對廠商（party_id ∪ meta.matchPartyIds）；空 = 不參與對帳。 */
  partyIds: readonly number[];
  /** YYYY-MM-DD */
  invoiceDate: string;
  amount: number;
  currency: string;
  matchStatus: MatchStatus;
  matchedTransactionId: number | null;
  suggestedTransactionId: number | null;
  /** 人工解除過、不要再自動配給這張發票的交易。 */
  rejectedTransactionIds?: readonly number[];
};

/** 這張發票拒絕過這筆交易。 */
function rejects(inv: MatchInvoice, txnId: number): boolean {
  return inv.rejectedTransactionIds?.includes(txnId) ?? false;
}

export type MatchTransaction = {
  id: number;
  partyId: number | null;
  /** YYYY-MM-DD */
  txnDate: string;
  amount: number;
  currency: string;
};

export type MatchReason = "single" | "group" | "ambiguous" | "currency" | "none";

export type MatchUpdate = {
  invoiceId: number;
  matchStatus: "unmatched" | "suggested" | "matched";
  matchedTransactionId: number | null;
  suggestedTransactionId: number | null;
  reason: MatchReason;
};

// ---------------------------------------------------------------------------
// 小工具
// ---------------------------------------------------------------------------

/** YYYY-MM-DD 加減天數（UTC 日曆，不受時區影響）。 */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 兩個 YYYY-MM-DD 相差幾天（b − a）。 */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/** 交易日是否落在發票的比對視窗 [invoiceDate, invoiceDate + days]（兩端都含）。 */
export function inWindow(invoiceDate: string, txnDate: string, days = MATCH_WINDOW_DAYS): boolean {
  return txnDate >= invoiceDate && txnDate <= addDays(invoiceDate, days);
}

/** 交易金額 / 發票金額 是否在可接受的比例內（含手續費）。 */
export function ratioOk(invoiceAmount: number, txnAmount: number): boolean {
  if (Number.isNaN(invoiceAmount) || Number.isNaN(txnAmount) || invoiceAmount <= 0 || txnAmount <= 0) return false;
  const r = txnAmount / invoiceAmount;
  // 浮點誤差：邊界值不要因為 1e-12 掉出去
  return r >= RATIO_MIN - 1e-9 && r <= RATIO_MAX + 1e-9;
}

export function isExact(a: number, b: number): boolean {
  return Math.abs(a - b) < EXACT_EPS;
}

/** 越接近「剛好相等」越好；同分取日期早的、再取 id 小的。 */
function best(invoiceAmount: number, txns: readonly MatchTransaction[]): MatchTransaction {
  return [...txns].sort(
    (a, b) =>
      Math.abs(a.amount / invoiceAmount - 1) - Math.abs(b.amount / invoiceAmount - 1) ||
      a.txnDate.localeCompare(b.txnDate) ||
      a.id - b.id,
  )[0];
}

const sameCurrency = (a: string, b: string) => a.trim().toUpperCase() === b.trim().toUpperCase();

/** 從 pool 裡找 2..maxSize 張加總落在比例內的組合（依 pool 順序列舉，最多 limit 組）。 */
export function findSubsets(
  pool: readonly { id: number; amount: number }[],
  target: number,
  maxSize = GROUP_MAX_SIZE,
  limit = 64,
): { ids: number[]; sum: number }[] {
  const hi = target / RATIO_MIN + 1e-9;
  const out: { ids: number[]; sum: number }[] = [];
  const items = [...pool].sort((a, b) => b.amount - a.amount);
  const pick: number[] = [];
  function walk(start: number, sum: number): void {
    if (out.length >= limit) return;
    if (pick.length >= 2 && ratioOk(sum, target)) out.push({ ids: [...pick], sum });
    if (pick.length === maxSize) return;
    for (let i = start; i < items.length; i++) {
      const next = sum + items[i].amount;
      if (next > hi) continue; // 金額由大到小排，但後面更小的可能放得下，所以 continue 不是 break
      pick.push(items[i].id);
      walk(i + 1, next);
      pick.pop();
      if (out.length >= limit) return;
    }
  }
  walk(0, 0);
  return out;
}

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

type Ctx = {
  open: MatchInvoice[];
  txns: MatchTransaction[];
  used: Set<number>;
  matched: Map<number, { txn: number; reason: MatchReason }>;
};

const isOpen = (ctx: Ctx, inv: MatchInvoice) => !ctx.matched.has(inv.id);

function singleCandidates(ctx: Ctx, inv: MatchInvoice): MatchTransaction[] {
  return ctx.txns.filter(
    (t) =>
      !ctx.used.has(t.id) &&
      !rejects(inv, t.id) &&
      t.partyId !== null &&
      inv.partyIds.includes(t.partyId) &&
      inWindow(inv.invoiceDate, t.txnDate) &&
      sameCurrency(t.currency, inv.currency) &&
      ratioOk(inv.amount, t.amount),
  );
}

/**
 * 單張比對的一輪。exactOnly = 只看金額完全相同的候選（優先），否則看比例內的。
 * 一筆交易同時是好幾張發票的唯一候選 → 不能自己挑，這輪先不綁。
 */
function singleRound(ctx: Ctx, exactOnly: boolean): boolean {
  const lists = new Map<number, MatchTransaction[]>();
  for (const inv of ctx.open) {
    if (!isOpen(ctx, inv)) continue;
    const cands = singleCandidates(ctx, inv);
    lists.set(inv.id, exactOnly ? cands.filter((t) => isExact(t.amount, inv.amount)) : cands);
  }
  const claims = new Map<number, number>();
  for (const l of lists.values()) if (l.length === 1) claims.set(l[0].id, (claims.get(l[0].id) ?? 0) + 1);
  let changed = false;
  for (const inv of ctx.open) {
    const l = lists.get(inv.id);
    if (l?.length !== 1) continue;
    const t = l[0];
    if (claims.get(t.id) !== 1 || ctx.used.has(t.id)) continue;
    ctx.used.add(t.id);
    ctx.matched.set(inv.id, { txn: t.id, reason: "single" });
    changed = true;
  }
  return changed;
}

type GroupFit = { txn: MatchTransaction; ids: number[]; exact: boolean };

function groupPool(ctx: Ctx, t: MatchTransaction): MatchInvoice[] {
  return ctx.open
    .filter(
      (inv) =>
        isOpen(ctx, inv) &&
        !rejects(inv, t.id) &&
        t.partyId !== null &&
        inv.partyIds.includes(t.partyId) &&
        inv.amount > 0 &&
        sameCurrency(inv.currency, t.currency) &&
        inWindow(inv.invoiceDate, t.txnDate, GROUP_WINDOW_DAYS),
    )
    .sort((a, b) => b.invoiceDate.localeCompare(a.invoiceDate) || a.id - b.id)
    .slice(0, GROUP_POOL_LIMIT);
}

/** 每筆還沒用到的交易找合併組合；回傳「唯一」的配對提案與「有但不唯一」的建議。 */
function groupFits(ctx: Ctx): { proposals: GroupFit[]; suggestions: GroupFit[] } {
  const proposals: GroupFit[] = [];
  const suggestions: GroupFit[] = [];
  for (const t of ctx.txns) {
    if (ctx.used.has(t.id) || t.partyId === null || t.amount <= 0) continue;
    const pool = groupPool(ctx, t);
    if (pool.length < 2) continue;
    const fits = findSubsets(pool, t.amount);
    if (fits.length === 0) continue;
    const exact = fits.filter((f) => isExact(f.sum, t.amount));
    if (exact.length === 1) proposals.push({ txn: t, ids: exact[0].ids, exact: true });
    else if (exact.length === 0 && fits.length === 1) proposals.push({ txn: t, ids: fits[0].ids, exact: false });
    else {
      const pick = (exact.length > 0 ? exact : fits).sort(
        (a, b) => Math.abs(a.sum - t.amount) - Math.abs(b.sum - t.amount) || a.ids.length - b.ids.length,
      )[0];
      suggestions.push({ txn: t, ids: pick.ids, exact: false });
    }
  }
  return { proposals, suggestions };
}

function groupRound(ctx: Ctx): boolean {
  const { proposals } = groupFits(ctx);
  // 兩筆交易的唯一組合搶同一張發票 → 都不綁（留給人看）
  const owners = new Map<number, number>();
  for (const p of proposals) for (const id of p.ids) owners.set(id, (owners.get(id) ?? 0) + 1);
  let changed = false;
  for (const p of proposals) {
    if (p.ids.some((id) => owners.get(id) !== 1)) continue;
    ctx.used.add(p.txn.id);
    for (const id of p.ids) ctx.matched.set(id, { txn: p.txn.id, reason: "group" });
    changed = true;
  }
  return changed;
}

type Decision = Omit<MatchUpdate, "invoiceId">;

const UNMATCHED: Decision = { matchStatus: "unmatched", matchedTransactionId: null, suggestedTransactionId: null, reason: "none" };

function suggested(txnId: number, reason: MatchReason): Decision {
  return { matchStatus: "suggested", matchedTransactionId: null, suggestedTransactionId: txnId, reason };
}

/** 沒配到的發票給建議：同幣別比例內（取最接近的）→ 合併組合的建議 → 不同幣別且視窗內只有一筆。 */
function suggestionFor(ctx: Ctx, inv: MatchInvoice, groupSuggestion: Map<number, number>): Decision {
  const same = singleCandidates(ctx, inv);
  if (same.length > 0) return suggested(best(inv.amount, same).id, "ambiguous");
  const group = groupSuggestion.get(inv.id);
  if (group !== undefined) return suggested(group, "ambiguous");
  const inWin = ctx.txns.filter(
    (t) =>
      !ctx.used.has(t.id) &&
      !rejects(inv, t.id) &&
      t.partyId !== null &&
      inv.partyIds.includes(t.partyId) &&
      inWindow(inv.invoiceDate, t.txnDate),
  );
  if (inWin.length === 1 && !sameCurrency(inWin[0].currency, inv.currency)) return suggested(inWin[0].id, "currency");
  return UNMATCHED;
}

function unchanged(inv: MatchInvoice, d: Decision): boolean {
  return (
    d.matchStatus === inv.matchStatus &&
    d.matchedTransactionId === inv.matchedTransactionId &&
    d.suggestedTransactionId === inv.suggestedTransactionId
  );
}

function buildContext(invoices: readonly MatchInvoice[], txns: readonly MatchTransaction[]): Ctx {
  // 已經綁給別的發票組合的交易不能再用
  const used = new Set<number>();
  for (const inv of invoices) {
    if (FINAL.has(inv.matchStatus) && inv.matchedTransactionId !== null) used.add(inv.matchedTransactionId);
  }
  const isOpenStatus = (i: MatchInvoice) => i.matchStatus === "unmatched" || i.matchStatus === "suggested";
  return {
    open: invoices
      .filter((i) => isOpenStatus(i) && i.partyIds.length > 0 && i.amount > 0)
      .sort((a, b) => a.invoiceDate.localeCompare(b.invoiceDate) || a.id - b.id),
    txns: txns
      .filter((t) => t.partyId !== null && t.amount > 0)
      .sort((a, b) => a.txnDate.localeCompare(b.txnDate) || a.id - b.id),
    used,
    matched: new Map(),
  };
}

/** 單張（先完全相等、再比例內）與合併交替跑到沒有新配對為止。 */
function runToFixpoint(ctx: Ctx): void {
  for (let guard = 0; guard < 100; guard++) {
    let changed = false;
    while (singleRound(ctx, true)) changed = true;
    while (singleRound(ctx, false)) changed = true;
    if (groupRound(ctx)) changed = true;
    if (!changed) return;
  }
}

/**
 * 跑一次對帳，回傳「狀態有變的」發票。只會產生 unmatched / suggested / matched；
 * 定案狀態（matched / manual / created / ignored）的發票不會出現在結果裡。
 */
export function reconcileInvoices(invoices: readonly MatchInvoice[], txns: readonly MatchTransaction[]): MatchUpdate[] {
  const ctx = buildContext(invoices, txns);
  runToFixpoint(ctx);

  const groupSuggestion = new Map<number, number>();
  for (const sug of groupFits(ctx).suggestions) {
    for (const id of sug.ids) if (!groupSuggestion.has(id)) groupSuggestion.set(id, sug.txn.id);
  }

  const updates: MatchUpdate[] = [];
  for (const inv of ctx.open) {
    const m = ctx.matched.get(inv.id);
    const d: Decision = m
      ? { matchStatus: "matched", matchedTransactionId: m.txn, suggestedTransactionId: null, reason: m.reason }
      : suggestionFor(ctx, inv, groupSuggestion);
    if (!unchanged(inv, d)) updates.push({ invoiceId: inv.id, ...d });
  }
  return updates;
}

export type LedgerMode = "match_only" | "create_unmatched";

/**
 * ledger_mode = create_unmatched 的帳號：發票日過了 45 天（視窗已關）仍是 unmatched 的發票，
 * 該新建一筆待確認支出。suggested 不算（已經有可能的對象，等人看）；沒有比對廠商、金額 ≤ 0 也不算。
 * match_only（預設）永遠回空。
 */
export function invoicesDueForCreation<T extends MatchInvoice>(
  invoices: readonly T[],
  ledgerModeOf: (billingAccountId: number) => LedgerMode,
  today: string,
): T[] {
  return invoices.filter(
    (i) =>
      i.matchStatus === "unmatched" &&
      i.partyIds.length > 0 &&
      i.amount > 0 &&
      ledgerModeOf(i.billingAccountId) === "create_unmatched" &&
      daysBetween(i.invoiceDate, today) > MATCH_WINDOW_DAYS,
  );
}

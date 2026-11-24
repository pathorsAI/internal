/**
 * 收款分配（migrations/0041）：一筆入帳分給多個應收，並記下吸收的手續費／匯差。
 *
 * 規則（讀取路徑一律照這裡，SQL 版本在 src/db/allocations.ts 的 effective CTE）：
 *   - 交易有任何分配列 → 只看分配列，忽略它舊的單一綁定欄位；
 *   - 交易沒有分配列 → 用舊的單一綁定欄位，視為「整筆金額分給那個目標、手續費 0」。
 *     優先順序：訂閱期別 > 請款項目 > 合約（與 migration 的搬移一致）。
 *   - 某個應收「已收」＝ Σ(amount + fee)：fee 不是錢，是我們同意少收的差額，收齊判斷要算進去；
 *     比的對象一律是含稅應收（gross）。
 *
 * 純函式，client / server 共用，不能 import server-only 的東西。
 */

export type AllocationTarget =
  | { type: "subscription_period"; subscriptionId: number; period: string }
  | { type: "billing_item"; billingItemId: number }
  | { type: "contract"; contractId: number };

export type AllocationTargetType = AllocationTarget["type"];

export const ALLOCATION_TARGET_TYPES = ["subscription_period", "billing_item", "contract"] as const;

export type AllocationInput = {
  target: AllocationTarget;
  /** 分給這個應收的實收金額（跟交易同幣別） */
  amount: number;
  /** 這個應收吸收掉的手續費／匯差，不是錢 */
  fee: number;
  note?: string | null;
};

/** 交易上舊的單一綁定欄位。 */
export type LegacyBinding = {
  amount: number;
  contractId: number | null;
  subscriptionId: number | null;
  subscriptionPeriod: string | null;
  billingItemId: number | null;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * 目標的穩定 key。訂閱期別與請款項目沿用看板列的 key（`sub:<id>:<period>`、`bi:<id>`），
 * 看板開分配時可以直接拿列的 key 對上；合約是 `c:<id>`。
 */
export function targetKey(t: AllocationTarget): string {
  if (t.type === "subscription_period") return `sub:${t.subscriptionId}:${t.period}`;
  if (t.type === "billing_item") return `bi:${t.billingItemId}`;
  return `c:${t.contractId}`;
}

function positiveInt(s: string | undefined): number | null {
  if (!s || !/^\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** targetKey 的反函式；格式不對回 null。 */
export function parseTargetKey(key: string): AllocationTarget | null {
  const parts = key.split(":");
  if (parts[0] === "sub" && parts.length === 3) {
    const subscriptionId = positiveInt(parts[1]);
    if (subscriptionId == null || !isValidPeriod(parts[2])) return null;
    return { type: "subscription_period", subscriptionId, period: parts[2] };
  }
  if (parts[0] === "bi" && parts.length === 2) {
    const billingItemId = positiveInt(parts[1]);
    return billingItemId == null ? null : { type: "billing_item", billingItemId };
  }
  if (parts[0] === "c" && parts.length === 2) {
    const contractId = positiveInt(parts[1]);
    return contractId == null ? null : { type: "contract", contractId };
  }
  return null;
}

/** 期別是合法的 YYYY-MM-DD（真的存在的日期，不只是格式對）。 */
export function isValidPeriod(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export type AllocationErrorCode =
  | "invalidTarget"
  | "invalidPeriod"
  | "negativeAmount"
  | "negativeFee"
  | "emptyLine"
  | "duplicateTarget"
  | "overAllocated";

export type AllocationValidation =
  | { ok: true }
  | { ok: false; code: AllocationErrorCode; index: number | null };

function targetShapeError(t: AllocationTarget): AllocationErrorCode | null {
  if (t.type === "subscription_period") {
    if (!Number.isSafeInteger(t.subscriptionId) || t.subscriptionId <= 0) return "invalidTarget";
    return isValidPeriod(t.period) ? null : "invalidPeriod";
  }
  if (t.type === "billing_item") {
    return Number.isSafeInteger(t.billingItemId) && t.billingItemId > 0 ? null : "invalidTarget";
  }
  if (t.type === "contract") {
    return Number.isSafeInteger(t.contractId) && t.contractId > 0 ? null : "invalidTarget";
  }
  return "invalidTarget";
}

function lineError(a: AllocationInput): AllocationErrorCode | null {
  const shape = targetShapeError(a.target);
  if (shape) return shape;
  if (!Number.isFinite(a.amount) || a.amount < 0) return "negativeAmount";
  if (!Number.isFinite(a.fee) || a.fee < 0) return "negativeFee";
  if (round2(a.amount + a.fee) <= 0) return "emptyLine";
  return null;
}

/**
 * 檢查一整組分配（寫入前，client 與 server 都跑）：
 * amount ≥ 0、fee ≥ 0、amount + fee > 0、期別是合法日期、同一個目標不重複、Σamount ≤ 交易金額。
 * 空陣列合法（＝清除分配，退回舊的單一綁定）。
 */
export function validateAllocations(
  txnAmount: number,
  list: readonly AllocationInput[],
): AllocationValidation {
  const seen = new Set<string>();
  for (let i = 0; i < list.length; i++) {
    const err = lineError(list[i]);
    if (err) return { ok: false, code: err, index: i };
    const key = targetKey(list[i].target);
    if (seen.has(key)) return { ok: false, code: "duplicateTarget", index: i };
    seen.add(key);
  }
  const allocated = round2(list.reduce((s, a) => s + a.amount, 0));
  if (allocated > round2(txnAmount)) return { ok: false, code: "overAllocated", index: null };
  return { ok: true };
}

/** 舊的單一綁定換成目標；優先順序 訂閱期別 > 請款項目 > 合約，都沒有回 null。 */
export function legacyTarget(b: Omit<LegacyBinding, "amount">): AllocationTarget | null {
  if (b.subscriptionId != null && b.subscriptionPeriod != null) {
    return { type: "subscription_period", subscriptionId: b.subscriptionId, period: b.subscriptionPeriod };
  }
  if (b.billingItemId != null) return { type: "billing_item", billingItemId: b.billingItemId };
  if (b.contractId != null) return { type: "contract", contractId: b.contractId };
  return null;
}

/** 一筆交易實際算數的分配：有分配列就是分配列，沒有就退回舊綁定（整筆、fee 0）。 */
export function effectiveAllocations(
  txn: LegacyBinding,
  rows: readonly AllocationInput[],
): AllocationInput[] {
  if (rows.length > 0) return [...rows];
  const target = legacyTarget(txn);
  return target ? [{ target, amount: txn.amount, fee: 0 }] : [];
}

/**
 * 分配列是不是「舊單一綁定的鏡像」：只有一列、手續費 0、金額等於整筆、目標就是舊綁定。
 * （0041 不搬舊資料，這種列只會在有人把整筆分給它原本綁的目標時出現。）改交易的綁定或金額之前先把鏡像拿掉，讓讀取退回新的綁定欄位，
 * 不然舊表單／update_transaction 的改綁就會被這列蓋掉、看起來沒生效。真正拆分過的不動。
 */
export function isLegacyMirror(txn: LegacyBinding, rows: readonly AllocationInput[]): boolean {
  if (rows.length !== 1) return false;
  const [a] = rows;
  const legacy = legacyTarget(txn);
  return (
    legacy != null &&
    round2(a.fee) === 0 &&
    round2(a.amount) === round2(txn.amount) &&
    targetKey(a.target) === targetKey(legacy)
  );
}

/** 某個目標的已收（含吸收的手續費）與其中的手續費。 */
export function collectedFor(
  target: AllocationTarget,
  allocations: readonly AllocationInput[],
): { collected: number; fee: number } {
  const key = targetKey(target);
  let collected = 0;
  let fee = 0;
  for (const a of allocations) {
    if (targetKey(a.target) !== key) continue;
    collected += a.amount + a.fee;
    fee += a.fee;
  }
  return { collected: round2(collected), fee: round2(fee) };
}

/** Sheet 上的即時合計：已分配（Σamount）、未分配（交易金額 − 已分配）、手續費合計。 */
export function allocationTotals(
  txnAmount: number,
  list: readonly Pick<AllocationInput, "amount" | "fee">[],
): { allocated: number; unallocated: number; fees: number } {
  const allocated = round2(list.reduce((s, a) => s + (Number.isFinite(a.amount) ? a.amount : 0), 0));
  const fees = round2(list.reduce((s, a) => s + (Number.isFinite(a.fee) ? a.fee : 0), 0));
  return { allocated, unallocated: round2(txnAmount - allocated), fees };
}

/** 一列分配加上它的目標還差多少（不算這筆交易自己已經分給它的）。 */
export type DraftLine = { amount: number; fee: number; outstanding: number | null };

/** 這一列還差多少沒收齊：outstanding − amount − fee（outstanding 未知回 null）。 */
export function lineShortfall(line: DraftLine): number | null {
  if (line.outstanding == null) return null;
  return round2(line.outstanding - line.amount - line.fee);
}

/**
 * 「把剩下的差額記為手續費，吸收」：指定那一列（預設最後一列）的 fee 補到剛好收齊
 * （fee = outstanding − amount，不會是負的）。outstanding 未知或已經收齊就不動。
 */
export function absorbShortfall<T extends DraftLine>(lines: readonly T[], index = lines.length - 1): T[] {
  const line = lines[index];
  if (!line || line.outstanding == null) return [...lines];
  const fee = Math.max(0, round2(line.outstanding - line.amount));
  return lines.map((l, i) => (i === index ? { ...l, fee } : l));
}

/** 從看板開分配時預填的那一列金額：min(交易還沒分出去的, 該列還沒收的)，不會是負的。 */
export function prefillAmount(unallocated: number, outstanding: number): number {
  return Math.max(0, round2(Math.min(unallocated, outstanding)));
}

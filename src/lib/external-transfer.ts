/**
 * 外部同步進來的「單腳轉帳」（Wise 換匯的其中一腳，見 src/lib/wise-sync.ts）。
 *
 * 帳本一列只有一個幣別，所以跨幣換匯的兩腳各記一列 type = transfer、只填自己這邊的帳戶。
 * 一般手動轉帳仍然必須兩個帳戶都有；只有「外部同步來的、本來就只有一腳」的列才放寬。
 * 純函式，client / server 都能用。
 */

export type SingleLegSide = "from" | "to";

type Row = {
  type: string;
  externalSource: string | null;
  fromAccountId: number | null;
  toAccountId: number | null;
};

/** 外部同步的單腳轉帳 → 回傳帳戶在哪一腳；其餘（含一般轉帳）回 null。 */
export function externalSingleLegSide(row: Row): SingleLegSide | null {
  if (row.type !== "transfer" || !row.externalSource) return null;
  const hasFrom = row.fromAccountId !== null;
  const hasTo = row.toAccountId !== null;
  if (hasFrom === hasTo) return null;
  return hasFrom ? "from" : "to";
}

/**
 * 從 external_meta 讀出換匯方向（「USD → THB」的兩個幣別）；讀不到回 null。
 * DEBIT 腳：本列幣別 → 對方幣別；CREDIT 腳：對方幣別 → 本列幣別。
 */
export function conversionCurrencies(
  meta: unknown,
  currency: string,
): { from: string; to: string } | null {
  if (!meta || typeof meta !== "object") return null;
  const m = meta as { wiseType?: unknown; conversion?: { counterCurrency?: unknown } | null };
  const counter = m.conversion?.counterCurrency;
  if (typeof counter !== "string" || !counter) return null;
  const own = currency.trim().toUpperCase();
  return m.wiseType === "CREDIT" ? { from: counter, to: own } : { from: own, to: counter };
}

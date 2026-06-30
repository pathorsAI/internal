/**
 * 金額顏色語意：收入用 income（綠）、支出/負值用 expense（紅）、零或中性回傳空字串。
 * 顏色由 globals.css 的 --income / --expense token 統一定義，請勿在各頁面硬寫 green/emerald/red/rose。
 */

/** 依數值正負決定顏色（0 為中性，不上色）。 */
export function signColor(value: number | string): string {
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n) || n === 0) return "";
  return n > 0 ? "text-income" : "text-expense";
}

/** 依交易類型決定顏色：收入綠、支出/員工代墊紅，其餘中性。 */
export function txnTypeColor(type: string): string {
  if (type === "income") return "text-income";
  if (type === "expense" || type === "advance") return "text-expense";
  return "";
}

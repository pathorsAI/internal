/**
 * 專案狀態由底下的合約與訂閱推導（純函式）。projects.status 只剩「手動封存」這個 override。
 *
 *   archived   人手動封存（override，不管底下怎樣）
 *   active     有草稿 / 進行中的合約，或有進行中 / 暫停的訂閱
 *   completed  底下有合約或訂閱，而且全部都結束了（合約 completed / cancelled、訂閱 ended）
 *   empty      底下什麼都沒有
 *
 * completed 而且沒封存 → 提示「可以結案」。
 */
export type DerivedProjectStatus = "archived" | "active" | "completed" | "empty";

const OPEN_CONTRACT = new Set(["draft", "active"]);
const OPEN_SUBSCRIPTION = new Set(["active", "paused"]);

export function deriveProjectStatus(input: {
  manualStatus: string;
  contractStatuses: readonly string[];
  subscriptionStatuses: readonly string[];
}): DerivedProjectStatus {
  if (input.manualStatus === "archived") return "archived";
  const total = input.contractStatuses.length + input.subscriptionStatuses.length;
  if (total === 0) return "empty";
  const open =
    input.contractStatuses.some((s) => OPEN_CONTRACT.has(s)) ||
    input.subscriptionStatuses.some((s) => OPEN_SUBSCRIPTION.has(s));
  return open ? "active" : "completed";
}

/** 推導出 completed、但還沒封存 → 該提示結案。 */
export function projectReadyToClose(input: Parameters<typeof deriveProjectStatus>[0]): boolean {
  return deriveProjectStatus(input) === "completed";
}

/** 合約已收 ≥ 含稅應收（gross）、但還在草稿 / 進行中 → 該提示結案。amount 請傳含稅應收。 */
export function contractReadyToClose(c: { status: string; amount: number | null; received: number }): boolean {
  return OPEN_CONTRACT.has(c.status) && c.amount !== null && c.amount > 0 && c.received >= c.amount;
}

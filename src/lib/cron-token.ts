/**
 * Cron → Next route 的一次性通行證。
 *
 * Cloudflare Cron Trigger 叫的是 worker.ts 的 `scheduled()`，那裡沒有 Next 的 request
 * context。所以 `scheduled()` 不自己跑同步，而是用 OpenNext 的 `fetch` handler 在
 * **同一個 isolate 裡直接呼叫** `/api/cron/integrations-autosync`（函式呼叫，不經過網路），
 * 讓同步跑在一般的 Next route handler 裡 —— env、DB、i18n 都跟網頁請求一模一樣。
 *
 * 那條 route 在網際網路上也摸得到，所以要一個外人拿不到的憑證：`scheduled()` 每次產生
 * 一個 256-bit 隨機 token，放進 globalThis 上的集合，帶在 header 裡呼叫；route 檢查
 * token 在集合裡、用完即刪。token 只存在這個 isolate 的記憶體、只活在那一次呼叫期間，
 * 不需要另外設定任何 secret。
 *
 * 這支刻意**沒有任何 import**：worker.ts（wrangler 打包）與 route（Next 打包）各有一份
 * 模組副本，兩邊靠同一個 `Symbol.for` key 共用 globalThis 上的同一個 Set。
 */

export const CRON_TOKEN_HEADER = "x-pathors-cron-token";

/** route 的路徑。worker.ts 與 src/proxy.ts 的 matcher 例外都要對得上。 */
export const AUTOSYNC_CRON_PATH = "/api/cron/integrations-autosync";

const KEY = Symbol.for("pathors.cronTokens");

function tokens(): Set<string> {
  const g = globalThis as unknown as Record<symbol, Set<string> | undefined>;
  let set = g[KEY];
  if (!set) {
    set = new Set<string>();
    g[KEY] = set;
  }
  return set;
}

/** 產生並登記一個一次性 token（給 scheduled() 用）。 */
export function issueCronToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const token = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  tokens().add(token);
  return token;
}

/** 撤銷（scheduled() 在 finally 裡呼叫，避免 route 沒走到時殘留）。 */
export function revokeCronToken(token: string): void {
  tokens().delete(token);
}

/** route 用：token 有效就消耗掉並回 true。 */
export function consumeCronToken(token: string | null): boolean {
  if (!token || token.length !== 64) return false;
  return tokens().delete(token);
}

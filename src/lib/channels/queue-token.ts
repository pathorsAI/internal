/**
 * Queue consumer → Next route 的一次性通行證（做法同 src/lib/cron-token.ts）。
 *
 * worker.ts 的 `queue()` 沒有 Next 的 request context，所以它不自己處理聊天訊息，而是在同一個
 * isolate 裡以函式呼叫 OpenNext 的 fetch，打 /api/channels/process。route 在網際網路上也摸得到，
 * 所以 `queue()` 每則訊息產生一個 256-bit 隨機 token、放進 globalThis 上的集合、帶在 header 裡；
 * route 檢查 token 在集合裡、用完即刪。不需要另外設定 secret。
 *
 * 刻意**沒有任何 import**：worker.ts（wrangler 打包）與 route（Next 打包）各有一份模組副本，
 * 兩邊靠同一個 `Symbol.for` key 共用 globalThis 上的同一個 Set。
 */

export const CHANNEL_TOKEN_HEADER = "x-pathors-channel-token";

/** route 的路徑。worker.ts 與 src/proxy.ts 的 matcher 例外都要對得上。 */
export const CHANNEL_PROCESS_PATH = "/api/channels/process";

const KEY = Symbol.for("pathors.channelTokens");

function tokens(): Set<string> {
  const g = globalThis as unknown as Record<symbol, Set<string> | undefined>;
  let set = g[KEY];
  if (!set) {
    set = new Set<string>();
    g[KEY] = set;
  }
  return set;
}

export function issueChannelToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const token = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  tokens().add(token);
  return token;
}

export function revokeChannelToken(token: string): void {
  tokens().delete(token);
}

export function consumeChannelToken(token: string | null): boolean {
  if (token?.length !== 64) return false;
  return tokens().delete(token);
}

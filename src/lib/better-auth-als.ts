import { AsyncLocalStorage } from "node:async_hooks";

/**
 * 在 better-auth 第一次用到之前，先把它的三個 AsyncLocalStorage 建好。
 *
 * 為什麼：@better-auth/core（1.6.x）是「用到才建」——`ensureAsyncStorage()` 先檢查
 * 全域有沒有 storage，沒有就 `await import("node:async_hooks")` 再 new 一個。中間那個
 * await 是空窗：同一個 Worker isolate 同時進來兩個請求時，兩邊都看到「還沒有」，各自
 * new 一個，後到的把全域的蓋掉。先進來的請求把 request state 存在舊的那個 storage，
 * 之後 getSession 去讀新的就是空的，於是丟出「No request state found … runWithRequestState」
 * → 「Failed to get session」→ 整頁 500。module 層那個 import promise 本身也是第一個請求
 * 建的，那個請求先結束時，Workers 會在別的請求裡報「This promise was created by a request
 * that has since ended」。正式站同一位使用者同時開幾個頁面（或 RSC prefetch）就會撞到。
 *
 * 這裡用同步 import 的 AsyncLocalStorage 先把三個 storage 放進 better-auth 的全域
 * （`Symbol.for("better-auth:global")`，見 @better-auth/core/dist/context/global.mjs），
 * 之後 `ensureAsyncStorage()` 一律直接拿到同一個實例，不會再 await、也不會重建。
 * 鍵名對應 context/request-state、context/endpoint-context、context/transaction 三支。
 * 升級 better-auth 時確認這三個鍵名還在（better-auth-als.test.ts 會檢查）。
 */
export const BETTER_AUTH_ALS_KEYS = [
  "requestStateAsyncStorage",
  "endpointContextAsyncStorage",
  "adapterAsyncStorage",
] as const;

type BetterAuthGlobal = { version?: string; epoch?: number; context: Record<string, unknown> };

export function primeBetterAuthAsyncStorage(): void {
  const symbol = Symbol.for("better-auth:global");
  const g = globalThis as unknown as Record<symbol, BetterAuthGlobal | undefined>;
  // 還沒有全域物件時建一個；better-auth 之後看到它已存在就直接沿用（並補上自己的 version）。
  const holder = (g[symbol] ??= { epoch: 1, context: {} });
  for (const key of BETTER_AUTH_ALS_KEYS) {
    holder.context[key] ??= new AsyncLocalStorage();
  }
}

primeBetterAuthAsyncStorage();

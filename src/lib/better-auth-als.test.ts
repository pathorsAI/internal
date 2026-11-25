import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { BETTER_AUTH_ALS_KEYS } from "./better-auth-als";
import {
  getCurrentAuthContextAsyncLocalStorage,
  getCurrentDBAdapterAsyncLocalStorage,
  getRequestStateAsyncLocalStorage,
  runWithRequestState,
  getCurrentRequestState,
} from "@better-auth/core/context";

describe("primeBetterAuthAsyncStorage", () => {
  test("better-auth 拿到的就是預先建好的 storage", async () => {
    const ctx = (globalThis as unknown as Record<symbol, { context: Record<string, unknown> }>)[
      Symbol.for("better-auth:global")
    ].context;
    expect(await getRequestStateAsyncLocalStorage()).toBe(ctx.requestStateAsyncStorage as never);
    expect(await getCurrentAuthContextAsyncLocalStorage()).toBe(ctx.endpointContextAsyncStorage as never);
    expect(await getCurrentDBAdapterAsyncLocalStorage()).toBe(ctx.adapterAsyncStorage as never);
  });

  test("並發的請求各自看得到自己的 request state", async () => {
    const run = (n: number) =>
      runWithRequestState(new WeakMap([[{}, n]]) as never, async () => {
        await new Promise((r) => setTimeout(r, 5));
        return getCurrentRequestState();
      });
    const results = await Promise.all([1, 2, 3, 4].map(run));
    for (const r of results) expect(r).toBeDefined();
  });

  test("鍵名跟 @better-auth/core 的實作一致（升級時會在這裡抓到）", () => {
    const dir = require.resolve("@better-auth/core/context").replace(/index\.mjs$/, "");
    const src = ["request-state.mjs", "endpoint-context.mjs", "transaction.mjs"]
      .map((f) => readFileSync(dir + f, "utf8"))
      .join("\n");
    for (const key of BETTER_AUTH_ALS_KEYS) expect(src).toContain(`context.${key}`);
  });
});

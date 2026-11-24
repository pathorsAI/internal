import { afterEach, describe, expect, test } from "bun:test";
import { hitApiRateLimit, resetApiRateLimitMemory, stepBucket } from "./api-rate-limit";

const cfg = { windowSeconds: 60, max: 3 };

describe("stepBucket", () => {
  test("counts within the window, blocks past max with Retry-After, resets after the window", () => {
    let b = stepBucket(undefined, 0, cfg);
    expect(b.result).toEqual({ ok: true, remaining: 2 });
    b = stepBucket(b.bucket, 1_000, cfg);
    b = stepBucket(b.bucket, 2_000, cfg);
    expect(b.result).toEqual({ ok: true, remaining: 0 });
    b = stepBucket(b.bucket, 10_000, cfg);
    expect(b.result).toEqual({ ok: false, retryAfterSeconds: 50 });
    b = stepBucket(b.bucket, 60_000, cfg);
    expect(b.result).toEqual({ ok: true, remaining: 2 });
  });
});

describe("hitApiRateLimit (memory storage)", () => {
  afterEach(() => {
    resetApiRateLimitMemory();
    delete process.env.API_RATE_LIMIT_MAX;
  });

  test("is per key", async () => {
    process.env.API_RATE_LIMIT_MAX = "2";
    expect((await hitApiRateLimit(1, 0)).ok).toBe(true);
    expect((await hitApiRateLimit(1, 1)).ok).toBe(true);
    expect((await hitApiRateLimit(1, 2)).ok).toBe(false);
    expect((await hitApiRateLimit(2, 3)).ok).toBe(true);
  });
});

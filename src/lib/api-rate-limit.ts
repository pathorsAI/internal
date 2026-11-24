import { sql } from "drizzle-orm";
import { getDb } from "@/db";

/**
 * API key 的速率限制（REST /api/v1 與用 API key 打的 /mcp）。
 *
 * 沿用 better-auth 那套的儲存選擇（src/lib/auth.ts）：
 * - RATE_LIMIT_STORAGE=database → 計數存在 rate_limit 表（migrations/0034），跨 Worker isolate 共享。
 *   key 用 `api-key:<id>`，不會跟 better-auth 的「IP × 路徑」列撞在一起。
 * - 其他 → 每個 isolate 自己的記憶體（擋得住單一腳本暴衝，擋不住刻意分散的來源；同 auth 的註解）。
 *
 * 規則：固定視窗，每把金鑰 API_RATE_LIMIT_WINDOW 秒內最多 API_RATE_LIMIT_MAX 次（預設 60 秒 120 次）。
 * 計數是以「金鑰」為單位，不是 IP：同一把金鑰從哪裡打都共用一份配額。
 */

export type RateLimitResult = { ok: true; remaining: number } | { ok: false; retryAfterSeconds: number };

function envInt(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

export function apiRateLimitConfig(): { windowSeconds: number; max: number } {
  return { windowSeconds: envInt("API_RATE_LIMIT_WINDOW", 60), max: envInt("API_RATE_LIMIT_MAX", 120) };
}

type Bucket = { count: number; windowStart: number };
const memory = new Map<string, Bucket>();

/** 純函式：給定目前的桶與時間，算出新的桶與結果。memory 與測試都用它。 */
export function stepBucket(
  bucket: Bucket | undefined,
  now: number,
  cfg: { windowSeconds: number; max: number },
): { bucket: Bucket; result: RateLimitResult } {
  const windowMs = cfg.windowSeconds * 1000;
  const next: Bucket =
    !bucket || now - bucket.windowStart >= windowMs
      ? { count: 1, windowStart: now }
      : { count: bucket.count + 1, windowStart: bucket.windowStart };
  if (next.count > cfg.max) {
    return {
      bucket: next,
      result: { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((next.windowStart + windowMs - now) / 1000)) },
    };
  }
  return { bucket: next, result: { ok: true, remaining: cfg.max - next.count } };
}

async function hitDatabase(key: string, now: number, cfg: { windowSeconds: number; max: number }) {
  const windowStartFloor = now - cfg.windowSeconds * 1000;
  // 單一 upsert：視窗過了就從 1 重算（last_request = 視窗起點），否則 +1。原子操作，不會有 race。
  const res = await getDb().execute(sql`
    INSERT INTO rate_limit (id, key, count, last_request)
    VALUES (${crypto.randomUUID()}, ${key}, 1, ${now})
    ON CONFLICT (key) DO UPDATE SET
      count = CASE WHEN rate_limit.last_request <= ${windowStartFloor} THEN 1 ELSE rate_limit.count + 1 END,
      last_request = CASE WHEN rate_limit.last_request <= ${windowStartFloor} THEN ${now} ELSE rate_limit.last_request END
    RETURNING count, last_request
  `);
  const rows = (Array.isArray(res) ? res : (res as { rows?: unknown[] }).rows) ?? [];
  const row = rows[0] as { count: number | string; last_request: number | string } | undefined;
  const bucket: Bucket = {
    count: Number(row?.count ?? 1),
    windowStart: Number(row?.last_request ?? now),
  };
  // 已經算好的桶再丟進 stepBucket 會多加一次，所以這裡直接判斷。
  const windowMs = cfg.windowSeconds * 1000;
  if (bucket.count > cfg.max) {
    return { ok: false as const, retryAfterSeconds: Math.max(1, Math.ceil((bucket.windowStart + windowMs - now) / 1000)) };
  }
  return { ok: true as const, remaining: cfg.max - bucket.count };
}

/** 記一次請求並回傳是否放行。DB 失敗時放行（限流不該讓服務整個掛掉）。 */
export async function hitApiRateLimit(apiKeyId: number, now = Date.now()): Promise<RateLimitResult> {
  const cfg = apiRateLimitConfig();
  const key = `api-key:${apiKeyId}`;
  if (process.env.RATE_LIMIT_STORAGE === "database") {
    try {
      return await hitDatabase(key, now, cfg);
    } catch {
      // 掉回記憶體版，至少擋得住同一個 isolate 的暴衝
    }
  }
  const { bucket, result } = stepBucket(memory.get(key), now, cfg);
  memory.set(key, bucket);
  return result;
}

/** 測試用。 */
export function resetApiRateLimitMemory() {
  memory.clear();
}

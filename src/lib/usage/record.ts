import { lt } from "drizzle-orm";
import { after } from "next/server";
import { getDb } from "@/db";
import { usageEvents } from "@/db/schema";

/**
 * 功能使用紀錄的寫入端（docs/usage-tracking.md）。
 *
 * 規則：
 * - **永遠不擋請求**：寫入排在回應送出之後（Next 的 `after()`，OpenNext 在 Workers 上用
 *   `ctx.waitUntil` 實作），而且自己吞掉所有錯誤。DB 不通、表還沒建（migration 0047 前）
 *   都只是少一筆紀錄。
 * - **不記內容**：頁面只記路由 pattern，工具只記名稱、成敗、耗時。不記 query string、
 *   參數、回傳值。
 * - module 層只放同步的資料（下面的去重 Map 存時間戳），**不放任何 promise**：跨請求共用
 *   promise 在 Workers 會撞到「promise created by a request that has since ended」
 *   （見 src/lib/better-auth-als.ts 與 PR #122）。
 */

export type UsageChannel = "web" | "mcp" | "api" | "ai" | "line" | "whatsapp";

export { USAGE_ROUTE_HEADER } from "./record-header";

const OFF_VALUES = new Set(["off", "false", "0", "no", "disabled"]);

/**
 * 預設開啟。自架者設 `USAGE_TRACKING=off`（或 false / 0 / no / disabled）就完全不寫。
 * `bun test` 底下一律不寫，測試不需要 DB。
 */
export function usageTrackingEnabled(): boolean {
  if (process.env.NODE_ENV === "test") return false;
  const v = process.env.USAGE_TRACKING?.trim().toLowerCase();
  return !(v && OFF_VALUES.has(v));
}

type UsageRow = {
  organizationId: string | null;
  userId: string | null;
  kind: "page" | "tool";
  channel: UsageChannel;
  feature: string;
  ok?: boolean | null;
  durationMs?: number | null;
};

async function insert(row: UsageRow): Promise<void> {
  try {
    await getDb()
      .insert(usageEvents)
      .values({
        organizationId: row.organizationId,
        userId: row.userId,
        kind: row.kind,
        channel: row.channel,
        feature: row.feature.slice(0, 200),
        ok: row.ok ?? null,
        durationMs: row.durationMs == null ? null : Math.max(0, Math.round(row.durationMs)),
      });
  } catch {
    // 紀錄失敗不影響任何功能
  }
}

/**
 * 在回應送出後跑 task。`after()` 只能在 Next 的請求範圍內呼叫（server component、route handler、
 * server action）；範圍外（例如單元測試、腳本）就直接丟到背景跑，不等它。
 */
function runAfterResponse(task: () => Promise<void>): void {
  const safe = () => task().catch(() => undefined);
  try {
    after(safe);
  } catch {
    void safe();
  }
}

// ---- 頁面瀏覽 ----

/** 同一人同一頁 30 秒內只記一次（重新整理、RSC refresh、同一頁裡多個元件各呼叫一次 requireOrg）。 */
export const PAGE_DEDUPE_MS = 30_000;
const MAX_DEDUPE_ENTRIES = 2_000;
const lastPageView = new Map<string, number>();

/**
 * 要不要記這次頁面瀏覽；要的話同時登記時間（同步完成，同一個請求裡第二次呼叫就會被擋下）。
 * 只在單一 isolate 內去重；不同 isolate 偶爾各記一次可以接受，這是用量統計不是帳。
 */
export function shouldRecordPageView(userId: string, route: string, now = Date.now()): boolean {
  const key = `${userId}\u0000${route}`;
  const last = lastPageView.get(key);
  if (last !== undefined && now - last < PAGE_DEDUPE_MS) return false;
  if (lastPageView.size >= MAX_DEDUPE_ENTRIES) {
    for (const [k, t] of lastPageView) {
      if (now - t >= PAGE_DEDUPE_MS) lastPageView.delete(k);
    }
    if (lastPageView.size >= MAX_DEDUPE_ENTRIES) lastPageView.clear();
  }
  lastPageView.set(key, now);
  return true;
}

/** 測試用：清掉去重狀態。 */
export function resetPageViewDedupe(): void {
  lastPageView.clear();
}

/**
 * 記一次 dashboard 頁面載入。route 必須是 src/lib/usage/routes.ts 的 pattern（proxy 已正規化）。
 * orgId 是 requireOrg() 解析出來的組織（跟頁面查資料用的是同一個）。
 */
export function recordPageView(args: { route: string; userId: string; orgId: string }): void {
  if (!usageTrackingEnabled()) return;
  if (!shouldRecordPageView(args.userId, args.route)) return;
  runAfterResponse(async () => {
    await insert({
      organizationId: args.orgId,
      userId: args.userId,
      kind: "page",
      channel: "web",
      feature: args.route,
    });
  });
}

// ---- 工具呼叫 ----

/**
 * 記一次工具呼叫（讀取也算）。組織在背景才解析（`resolveOrg` 可能要查一次 DB），
 * 解析不出來（還沒選組織、呼叫本身就是因為組織不對而失敗）就記 NULL。
 */
export function recordToolCall(args: {
  name: string;
  userId: string;
  channel: UsageChannel;
  ok: boolean;
  durationMs: number;
  resolveOrg: () => Promise<string | null>;
}): void {
  if (!usageTrackingEnabled()) return;
  runAfterResponse(async () => {
    const orgId = await args.resolveOrg().catch(() => null);
    await insert({
      organizationId: orgId,
      userId: args.userId,
      kind: "tool",
      channel: args.channel,
      feature: args.name,
      ok: args.ok,
      durationMs: args.durationMs,
    });
  });
}

// ---- 保存期限 ----

export const USAGE_RETENTION_DAYS = 180;

/** 每日 cron 呼叫：刪掉 180 天以前的紀錄。關掉紀錄時照樣清（把之前留下的舊資料清掉）。 */
export async function purgeOldUsageEvents(now = new Date()): Promise<{ deleted: number }> {
  const cutoff = new Date(now.getTime() - USAGE_RETENTION_DAYS * 86_400_000).toISOString();
  const rows = await getDb()
    .delete(usageEvents)
    .where(lt(usageEvents.createdAt, cutoff))
    .returning({ id: usageEvents.id });
  return { deleted: rows.length };
}

import { consumeCronToken, CRON_TOKEN_HEADER } from "@/lib/cron-token";
import { runScheduledSync } from "@/lib/integrations/autosync";
import { runBillingNotifications } from "@/lib/billing-notify";
import { runChatCleanup, type ChatCleanupResult } from "@/lib/chat-cleanup";

export const dynamic = "force-dynamic";

/**
 * 整合每日自動同步的進入點 —— **只給 worker.ts 的 `scheduled()` 呼叫**。
 *
 * `scheduled()` 在同一個 isolate 裡以函式呼叫 OpenNext 的 fetch handler 打這條路徑，
 * 帶一個只存在於記憶體、用完即刪的 token（src/lib/cron-token.ts）。從網際網路打進來的
 * 請求不可能有那個 token，一律 404（不回 401 / 403，不透露這裡有東西）。
 *
 * src/proxy.ts 的 matcher 排除了 /api/cron：這裡沒有 session cookie，不能被導去登入頁。
 *
 * 同步完再發固定支出的 Discord 通知（src/lib/billing-notify.ts）：回顧要用到剛同步進來的
 * Wise 交易。通知整個失敗（例如 DB 不通）也不能讓同步的結果跟著遺失，所以分開接住；
 * 這時回 500 讓 Cloudflare 把這次 cron 標成失敗。
 *
 * 最後做聊天 bot 的清理（src/lib/chat-cleanup.ts：收件匣 30 天、去重 7 天、暫存 7 天、
 * 引用對照 90 天、過期卡片）。清理在同步與通知之後、自己接住所有錯誤，失敗只寫進回應，
 * 不影響同步結果，也不改變回應的狀態碼。
 */
export async function POST(request: Request): Promise<Response> {
  if (!consumeCronToken(request.headers.get(CRON_TOKEN_HEADER))) {
    return new Response("Not Found", { status: 404 });
  }
  const result = await runScheduledSync(new Date(), { trigger: "cron" });
  let notifications: Awaited<ReturnType<typeof runBillingNotifications>> | null = null;
  let notificationsError: string | null = null;
  try {
    notifications = await runBillingNotifications(new Date());
  } catch (e) {
    notificationsError = e instanceof Error ? e.message : String(e);
    console.error(`[cron] billing notifications failed: ${notificationsError}`);
  }
  const chatCleanup = await safeChatCleanup();
  if (notificationsError !== null) {
    return Response.json({ ...result, notifications: null, notificationsError, chatCleanup }, { status: 500 });
  }
  return Response.json({ ...result, notifications, chatCleanup });
}

/** runChatCleanup 本身已逐項接住錯誤；這裡再包一層，連 import 階段的意外都不外漏。 */
async function safeChatCleanup(): Promise<ChatCleanupResult | { error: string }> {
  try {
    return await runChatCleanup();
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error(`[cron] chat cleanup failed: ${error}`);
    return { error };
  }
}

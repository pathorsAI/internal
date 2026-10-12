import { consumeCronToken, CRON_TOKEN_HEADER } from "@/lib/cron-token";
import { runScheduledSync } from "@/lib/integrations/autosync";
import { runBillingNotifications } from "@/lib/billing-notify";

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
 */
export async function POST(request: Request): Promise<Response> {
  if (!consumeCronToken(request.headers.get(CRON_TOKEN_HEADER))) {
    return new Response("Not Found", { status: 404 });
  }
  const result = await runScheduledSync(new Date(), { trigger: "cron" });
  try {
    const notifications = await runBillingNotifications(new Date());
    return Response.json({ ...result, notifications });
  } catch (e) {
    const notificationsError = e instanceof Error ? e.message : String(e);
    console.error(`[cron] billing notifications failed: ${notificationsError}`);
    return Response.json({ ...result, notifications: null, notificationsError }, { status: 500 });
  }
}

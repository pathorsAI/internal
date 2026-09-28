import { consumeCronToken, CRON_TOKEN_HEADER } from "@/lib/cron-token";
import { runScheduledSync } from "@/lib/integrations/autosync";

export const dynamic = "force-dynamic";

/**
 * 整合每日自動同步的進入點 —— **只給 worker.ts 的 `scheduled()` 呼叫**。
 *
 * `scheduled()` 在同一個 isolate 裡以函式呼叫 OpenNext 的 fetch handler 打這條路徑，
 * 帶一個只存在於記憶體、用完即刪的 token（src/lib/cron-token.ts）。從網際網路打進來的
 * 請求不可能有那個 token，一律 404（不回 401 / 403，不透露這裡有東西）。
 *
 * src/proxy.ts 的 matcher 排除了 /api/cron：這裡沒有 session cookie，不能被導去登入頁。
 */
export async function POST(request: Request): Promise<Response> {
  if (!consumeCronToken(request.headers.get(CRON_TOKEN_HEADER))) {
    return new Response("Not Found", { status: 404 });
  }
  const result = await runScheduledSync(new Date(), { trigger: "cron" });
  return Response.json(result);
}

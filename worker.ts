// Cloudflare Worker 的進入點（wrangler.jsonc 的 `main`）。
//
// OpenNext 產生的 .open-next/worker.js 只有 `fetch`。這支照 OpenNext 文件的
// 「custom worker」做法把它包起來：fetch 原封不動轉給 OpenNext，再加上 Cron Trigger
// 需要的 `scheduled` 與聊天佇列的 `queue`（同樣打內部 route，見 src/lib/channels/queue-token.ts）。見 https://opennext.js.org/cloudflare/howtos/custom-worker
//
// scheduled 刻意不直接 import 業務程式碼（src/lib/…）：那些程式碼依賴 Next 的 request
// context（cookies / headers / next-intl），而且 wrangler 會把它們再打包一份。
// 改成在同一個 isolate 裡「以函式呼叫」OpenNext 的 fetch，打一條內部 route
// （/api/cron/integrations-autosync），同步就跑在一般的 Next route handler 裡：
// process.env 由 OpenNext 從 env 填好（字串型別的 vars / secrets）、DB、i18n 都與網頁
// 請求相同。route 用一次性 token 驗證（src/lib/cron-token.ts），不需要額外的 secret。

// eslint-disable-next-line @typescript-eslint/ban-ts-comment -- 檔案存在時不是錯誤，@ts-expect-error 會反過來報錯
// @ts-ignore -- `.open-next/worker.js` 由 `bun run cf:build` 產生，型別檢查時可能還不存在
import openNextHandler from "./.open-next/worker.js";
import {
  AUTOSYNC_CRON_PATH,
  CRON_TOKEN_HEADER,
  issueCronToken,
  revokeCronToken,
} from "./src/lib/cron-token";
import {
  CHANNEL_PROCESS_PATH,
  CHANNEL_TOKEN_HEADER,
  issueChannelToken,
  revokeChannelToken,
} from "./src/lib/channels/queue-token";

type Env = CloudflareEnv & Record<string, unknown>;

type OpenNextHandler = {
  fetch: (request: Request, env: Env, ctx: ExecutionContext) => Promise<Response>;
};
const handler = openNextHandler as OpenNextHandler;

/** 內部請求用的 origin。OpenNext 會拿 isolate 的第一個請求決定 origin，所以要用正式網址。 */
function internalOrigin(env: Env): string {
  const configured = typeof env.BETTER_AUTH_URL === "string" ? env.BETTER_AUTH_URL : "";
  try {
    return new URL(configured || "https://internal.pathors.com").origin;
  } catch {
    return "https://internal.pathors.com";
  }
}

async function runIntegrationAutoSync(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
  const token = issueCronToken();
  const started = Date.now();
  try {
    const request = new Request(`${internalOrigin(env)}${AUTOSYNC_CRON_PATH}`, {
      method: "POST",
      headers: { [CRON_TOKEN_HEADER]: token, "x-cron": controller.cron },
    });
    const response = await handler.fetch(request, env, ctx);
    const body = await response.text();
    if (!response.ok) {
      // 丟錯讓 Cloudflare 把這次 cron 標成失敗（dashboard 的 Cron Events 看得到）。
      throw new Error(`integrations autosync returned ${response.status}: ${body.slice(0, 500)}`);
    }
    console.log(`[cron] integrations autosync done in ${Date.now() - started}ms: ${body.slice(0, 2000)}`);
  } finally {
    revokeCronToken(token);
  }
}

/**
 * 聊天佇列（pathors-internal-chat）的一則訊息：同 cron 的做法，以函式呼叫 OpenNext 的 fetch 打
 * /api/channels/process（帶一次性 token），處理就跑在一般的 Next route handler 裡。
 * route 回非 2xx 或丟錯就 retry（wrangler.jsonc 設 max_retries 2），成功才 ack。
 */
async function processChatMessage(message: Message<unknown>, env: Env, ctx: ExecutionContext) {
  const token = issueChannelToken();
  try {
    const request = new Request(`${internalOrigin(env)}${CHANNEL_PROCESS_PATH}`, {
      method: "POST",
      headers: { [CHANNEL_TOKEN_HEADER]: token, "Content-Type": "application/json" },
      body: JSON.stringify(message.body),
    });
    const response = await handler.fetch(request, env, ctx);
    if (response.ok) {
      message.ack();
    } else {
      console.error(`[queue] chat job returned ${response.status}: ${(await response.text()).slice(0, 500)}`);
      message.retry({ delaySeconds: 5 });
    }
  } catch (err) {
    console.error("[queue] chat job failed", err);
    message.retry({ delaySeconds: 5 });
  } finally {
    revokeChannelToken(token);
  }
}

export default {
  fetch: (request: Request, env: Env, ctx: ExecutionContext) => handler.fetch(request, env, ctx),

  async queue(batch: MessageBatch<unknown>, env: Env, ctx: ExecutionContext) {
    // max_batch_size 是 1，這裡照樣逐則處理（同一人的順序靠 DB 的 busy 鎖，不靠批次）。
    for (const message of batch.messages) await processChatMessage(message, env, ctx);
  },

  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    // 目前只有一個排程（wrangler.jsonc triggers.crons），新增排程時依 controller.cron 分流。
    await runIntegrationAutoSync(controller, env, ctx);
  },
} satisfies ExportedHandler<Env>;

// OpenNext 的 worker.js 會匯出這幾個 Durable Object class（快取 / revalidation 用）。
// 這個專案目前沒有綁定它們，但照 OpenNext 的 custom worker 範例原樣轉出，之後開了
// 相關快取設定也不用回來改這裡。
// eslint-disable-next-line @typescript-eslint/ban-ts-comment -- 同上
// @ts-ignore -- 同上，build 時才產生
export { DOQueueHandler, DOShardedTagCache, BucketCachePurge } from "./.open-next/worker.js";

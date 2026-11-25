import { processJob } from "@/lib/channels/dispatcher";
import { CHANNEL_TOKEN_HEADER, consumeChannelToken } from "@/lib/channels/queue-token";
import { dispatcherDeps } from "@/lib/channels/runtime";
import { parseJob } from "@/lib/channels/job-parse";
import type { ChannelJob, RawWebhookJob } from "@/lib/channels/types";
import { handleRawWebhookJob } from "@/lib/channels/webhook";

export const dynamic = "force-dynamic";

/**
 * 聊天佇列的處理端 —— **只給 worker.ts 的 `queue()` 呼叫**（同一個 isolate 裡以函式呼叫
 * OpenNext 的 fetch，帶一次性 token，見 src/lib/channels/queue-token.ts）。外部請求一律 404。
 *
 * body 是一個 ChannelJob：`{ kind: "event", event }`（webhook 收到的事件）或
 * `{ kind: "flush", identityId, anchor, … }`（安靜幾秒後把暫存區合成一題），或
 * `{ kind: "raw", provider, body, headers }`（前哨 Worker 驗簽後放進來的原始 webhook，這裡重驗後拆成 event job）。
 * 處理失敗回 500，queue() 會讓 Cloudflare 重送（max_retries 2）。
 */
export async function POST(req: Request): Promise<Response> {
  if (!consumeChannelToken(req.headers.get(CHANNEL_TOKEN_HEADER))) {
    return new Response("Not Found", { status: 404 });
  }
  let job: ChannelJob | RawWebhookJob | null = null;
  try {
    job = parseJob(await req.json());
  } catch {
    job = null;
  }
  // 格式不對的訊息重送也不會變好：回 200 讓它被丟掉。
  if (!job) return Response.json({ ok: false, error: "bad job" });
  try {
    if (job.kind === "raw") await handleRawWebhookJob(job);
    else await processJob(job, dispatcherDeps());
    return Response.json({ ok: true });
  } catch (err) {
    console.error("[channels/process]", err);
    return Response.json({ ok: false }, { status: 500 });
  }
}

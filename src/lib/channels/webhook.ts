/**
 * webhook 共用的流程：原始 body → 驗簽 → parse → 去重 → 進佇列。處理（下載檔案、跑 AI）一律在佇列或
 * waitUntil 裡做。
 *
 * 兩個入口：
 * - handleWebhook：主站的 webhook route（直接打到主站時，例如自架、沒有前哨 Worker）。
 * - handleRawWebhookJob：正式站平台打的是前哨 Worker（workers/webhook-ack），它驗簽後把原始 body
 *   放進佇列，由 /api/channels/process 呼叫這裡。主站冷啟動 1–4 秒，LINE 的 Verify 等不了。
 */
import { forgetInboundEvents, recordInboundEvent } from "@/db/chat";
import { base64ToBytes } from "./crypto";
import { adapterFor, enqueueEvents } from "./runtime";
import type { ChannelAdapter, ChannelJob, RawWebhookJob } from "./types";

type Accepted = "ok" | "invalid" | "retry";

export async function handleWebhook(req: Request, adapter: ChannelAdapter | null): Promise<Response> {
  // 平台沒設定 secret：當作沒有這條路。
  if (!adapter) return new Response("Not Found", { status: 404 });
  const result = await acceptWebhook(adapter, req.headers, new Uint8Array(await req.arrayBuffer()));
  if (result === "invalid") return new Response("Invalid signature", { status: 401 });
  if (result === "retry") return new Response("Retry", { status: 500 });
  return new Response("OK", { status: 200 });
}

/**
 * 佇列裡的原始 webhook。驗簽失敗或主站沒設 secret 就丟掉（重送也不會變好）；進不了佇列就丟錯，
 * 讓 Cloudflare 重送這則 raw job（去重紀錄已撤回，重送時會重新處理）。
 */
export async function handleRawWebhookJob(job: RawWebhookJob): Promise<void> {
  const adapter = adapterFor(job.provider);
  if (!adapter) {
    console.error(`[channels/webhook] raw ${job.provider} job dropped: provider not configured`);
    return;
  }
  const raw = base64ToBytes(job.body);
  if (!raw) {
    console.error(`[channels/webhook] raw ${job.provider} job dropped: body is not base64`);
    return;
  }
  const result = await acceptWebhook(adapter, new Headers(job.headers), raw);
  if (result === "invalid") console.error(`[channels/webhook] raw ${job.provider} job dropped: invalid signature`);
  if (result === "retry") throw new Error(`enqueue failed for raw ${job.provider} webhook`);
}

async function acceptWebhook(adapter: ChannelAdapter, headers: Headers, raw: Uint8Array): Promise<Accepted> {
  if (!(await adapter.verify(headers, raw))) return "invalid";

  const events = adapter.parse(new TextDecoder().decode(raw));
  const jobs: ChannelJob[] = [];
  for (const event of events) {
    // 平台重送（LINE redelivery、WhatsApp 重試）：第二次看到就略過。
    if (await recordInboundEvent(event.provider, event.eventId)) jobs.push({ kind: "event", event });
  }
  try {
    await enqueueEvents(jobs);
  } catch (err) {
    // 進不了佇列：撤回去重紀錄並回 500，平台會重送（LINE redelivery、WhatsApp 重試）。
    console.error("[channels/webhook] enqueue failed", err);
    await forgetInboundEvents(adapter.provider, jobs.map((j) => (j.kind === "event" ? j.event.eventId : ""))).catch(() => {});
    return "retry";
  }
  return "ok";
}

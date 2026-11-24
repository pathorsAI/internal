/**
 * 兩個平台 webhook route 共用的流程：讀原始 body → 驗簽 → parse → 去重 → 進佇列 → 立刻回 200。
 * 處理（下載檔案、跑 AI）一律在佇列或 waitUntil 裡做，webhook 本身只花幾十到幾百毫秒。
 */
import { forgetInboundEvents, recordInboundEvent } from "@/db/chat";
import { enqueueEvents } from "./runtime";
import type { ChannelAdapter, ChannelJob } from "./types";

export async function handleWebhook(req: Request, adapter: ChannelAdapter | null): Promise<Response> {
  // 平台沒設定 secret：當作沒有這條路。
  if (!adapter) return new Response("Not Found", { status: 404 });
  const raw = new Uint8Array(await req.arrayBuffer());
  if (!(await adapter.verify(req.headers, raw))) return new Response("Invalid signature", { status: 401 });

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
    return new Response("Retry", { status: 500 });
  }
  return new Response("OK", { status: 200 });
}

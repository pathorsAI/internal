import { isChatProvider } from "@/db/chat";
import { processJob } from "@/lib/channels/dispatcher";
import { CHANNEL_TOKEN_HEADER, consumeChannelToken } from "@/lib/channels/queue-token";
import { dispatcherDeps } from "@/lib/channels/runtime";
import type { ChannelJob } from "@/lib/channels/types";

export const dynamic = "force-dynamic";

/**
 * 聊天佇列的處理端 —— **只給 worker.ts 的 `queue()` 呼叫**（同一個 isolate 裡以函式呼叫
 * OpenNext 的 fetch，帶一次性 token，見 src/lib/channels/queue-token.ts）。外部請求一律 404。
 *
 * body 是一個 ChannelJob：`{ kind: "event", event }`（webhook 收到的事件）或
 * `{ kind: "flush", identityId, anchor, … }`（安靜幾秒後把暫存區合成一題）。
 * 處理失敗回 500，queue() 會讓 Cloudflare 重送（max_retries 2）。
 */
export async function POST(req: Request): Promise<Response> {
  if (!consumeChannelToken(req.headers.get(CHANNEL_TOKEN_HEADER))) {
    return new Response("Not Found", { status: 404 });
  }
  let job: ChannelJob | null = null;
  try {
    job = parseJob(await req.json());
  } catch {
    job = null;
  }
  // 格式不對的訊息重送也不會變好：回 200 讓它被丟掉。
  if (!job) return Response.json({ ok: false, error: "bad job" });
  try {
    await processJob(job, dispatcherDeps());
    return Response.json({ ok: true });
  } catch (err) {
    console.error("[channels/process]", err);
    return Response.json({ ok: false }, { status: 500 });
  }
}

function parseJob(raw: unknown): ChannelJob | null {
  if (!raw || typeof raw !== "object") return null;
  const j = raw as Record<string, unknown>;
  if (j.kind === "flush") {
    if (!isChatProvider(j.provider) || typeof j.identityId !== "string" || typeof j.anchor !== "string") return null;
    return j as unknown as ChannelJob;
  }
  if (j.kind === "event") {
    const e = j.event as Record<string, unknown> | null;
    if (!e || !isChatProvider(e.provider) || typeof e.eventId !== "string" || typeof e.kind !== "string") return null;
    if (typeof e.externalUserId !== "string" || typeof e.isGroup !== "boolean") return null;
    return j as unknown as ChannelJob;
  }
  return null;
}

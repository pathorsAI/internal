// 聊天平台 webhook 的前哨（Worker `pathors-internal-webhook-ack`）。
//
// 為什麼要另外一支 Worker：主站 `pathors-internal` 是 OpenNext 打包的 Next，腳本有幾十 MB。
// Cloudflare 會把請求分散到很多個 isolate，流量小的時候幾乎每個請求都落在新的 isolate，光是載入
// 那支腳本就要 1–4 秒（2026-11-25 量的，見 docs/deployment.md「Cold starts」）。LINE 的 webhook
// Verify 跟 /v2/bot/channel/webhook/test 等不了這麼久，一直回 REQUEST_TIMEOUT。
//
// 這支只有幾 KB，冷啟動幾乎是零。它用 Workers route 掛在主站同一個網域、只接兩條 webhook 路徑
// （同一個 hostname 上 route 優先於 Custom Domain），收到 POST 就：
//   1. 用跟主站同一份程式（src/lib/channels/signature.ts）驗簽，
//   2. 把原始 body（base64）與驗簽 header 放進主站同一個佇列 `pathors-internal-chat`（kind: "raw"），
//   3. 回 200。
// 主站的 queue() 收到 raw job 會重驗、parse、去重，再照原本的流程拆成 event job
// （src/lib/channels/webhook.ts 的 handleRawWebhookJob）。處理失敗由佇列重送，不會掉訊息；
// 進不了佇列就回 500，讓平台重送。
//
// 這支 Worker 的 secret 要跟主站同一組：LINE_CHANNEL_SECRET、WHATSAPP_APP_SECRET。沒設的平台回 404
// （跟主站一樣「沒設就當沒有這條路」）。body 太大放不進佇列（單則上限 128KB）時，同步轉給主站處理。
// 其他方法（WhatsApp 的 GET 驗證 hub.challenge）原樣轉給主站。

import { bytesToBase64 } from "../../src/lib/channels/crypto";
import { SIGNATURE_HEADER, verifyLineSignature, verifyWhatsAppSignature } from "../../src/lib/channels/signature";

type Provider = keyof typeof SIGNATURE_HEADER;

export interface Env {
  APP: Fetcher;
  CHAT_QUEUE: Queue<unknown>;
  LINE_CHANNEL_SECRET?: string;
  WHATSAPP_APP_SECRET?: string;
}

/** 佇列單則上限 128KB；base64 會多 1/3，再留 JSON 外框的餘裕。 */
export const MAX_QUEUED_BODY_BYTES = 90 * 1024;

const PATHS: Record<string, Provider> = {
  "/api/channels/line/webhook": "line",
  "/api/channels/whatsapp/webhook": "whatsapp",
};

function verify(provider: Provider, env: Env, raw: Uint8Array, signature: string | null): Promise<boolean> | null {
  if (provider === "line") {
    return env.LINE_CHANNEL_SECRET ? verifyLineSignature(env.LINE_CHANNEL_SECRET, raw, signature) : null;
  }
  return env.WHATSAPP_APP_SECRET ? verifyWhatsAppSignature(env.WHATSAPP_APP_SECRET, raw, signature) : null;
}

export async function handle(request: Request, env: Env): Promise<Response> {
  const provider = PATHS[new URL(request.url).pathname];
  if (request.method !== "POST" || !provider) return env.APP.fetch(request);

  const raw = new Uint8Array(await request.arrayBuffer());
  const header = SIGNATURE_HEADER[provider];
  const signature = request.headers.get(header);
  const verified = verify(provider, env, raw, signature);
  if (!verified) return new Response("Not Found", { status: 404 });
  if (!(await verified)) return new Response("Invalid signature", { status: 401 });

  if (raw.byteLength > MAX_QUEUED_BODY_BYTES) {
    return env.APP.fetch(new Request(request.url, { method: "POST", headers: request.headers, body: raw }));
  }
  try {
    await env.CHAT_QUEUE.send({ kind: "raw", provider, body: bytesToBase64(raw), headers: { [header]: signature ?? "" } });
  } catch (err) {
    console.error(`[webhook-ack] enqueue ${provider} failed`, err);
    return new Response("Retry", { status: 500 });
  }
  return new Response("OK", { status: 200 });
}

export default { fetch: (request, env) => handle(request, env) } satisfies ExportedHandler<Env>;

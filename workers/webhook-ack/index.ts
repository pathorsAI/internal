// 聊天平台 webhook 的「先回 200」前哨（Worker `pathors-internal-webhook-ack`）。
//
// 為什麼要另外一支 Worker：主站 `pathors-internal` 是 OpenNext 打包的 Next，腳本約 56MB。
// Cloudflare 會把請求分散到很多個 isolate，流量小的時候幾乎每個請求都落在新的 isolate，
// 光是載入那支腳本就要 1.5–4 秒（2026-11-25 量的：一支不進 Next、直接回字串的路徑，冷的
// 一樣要 2–3.7 秒；暖的 0.4 秒）。LINE 的 webhook Verify 跟 /v2/bot/channel/webhook/test
// 等不了這麼久，一直回 REQUEST_TIMEOUT。
//
// 這支只有幾 KB，冷啟動幾乎是零。它掛在主站同一個網域、只認兩條 webhook 路徑（Workers route
// 在同一個 hostname 上優先於 Custom Domain），收到 POST 就：
//   1. 把原始 body 與 header 讀進來（簽章要原封不動），
//   2. 立刻回 200，
//   3. 在 waitUntil 裡經 service binding 把同一個請求轉給主站，由主站照舊驗簽、去重、進佇列。
// 主站回 5xx（例如進不了佇列）或連不上，就在 waitUntil 的 30 秒內重試幾次；驗簽失敗的 4xx
// 不重試。這裡不碰任何 secret，驗簽仍只在主站做一次。
//
// 取捨：平台看到的永遠是 200，所以主站三次都失敗的那一則不會有平台重送（LINE redelivery），
// 只會留在主站與這支的 log（`[webhook-ack]`）。主站本身就只是驗簽＋進佇列，實際上很少失敗。
//
// 其他方法（例如 WhatsApp 的 GET 驗證 hub.challenge）原樣同步轉給主站，回什麼就回什麼。

interface Env {
  APP: Fetcher;
}

const RETRY_DELAYS_MS = [0, 2_000, 6_000];

async function forward(url: string, method: string, headers: Headers, body: ArrayBuffer, env: Env): Promise<void> {
  let last = "";
  for (const wait of RETRY_DELAYS_MS) {
    if (wait) await new Promise((r) => setTimeout(r, wait));
    try {
      const res = await env.APP.fetch(new Request(url, { method, headers, body }));
      if (res.status < 500) {
        if (!res.ok) console.warn(`[webhook-ack] ${new URL(url).pathname} -> ${res.status} ${(await res.text()).slice(0, 200)}`);
        return;
      }
      last = `${res.status} ${(await res.text()).slice(0, 200)}`;
    } catch (err) {
      last = String(err);
    }
  }
  console.error(`[webhook-ack] gave up forwarding ${new URL(url).pathname}: ${last}`);
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method !== "POST") return env.APP.fetch(request);
    const body = await request.arrayBuffer();
    const headers = new Headers(request.headers);
    ctx.waitUntil(forward(request.url, request.method, headers, body, env));
    return new Response("OK", { status: 200 });
  },
} satisfies ExportedHandler<Env>;

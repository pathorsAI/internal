/**
 * 轉接層接上正式環境：adapter、DB、STORAGE、runTurn、排程（Cloudflare Queue 或 waitUntil）。
 *
 * 排程有兩條路：
 * - 有 `CHAT_QUEUE` binding（正式環境）：`send(job, { delaySeconds })`，由 worker.ts 的 queue()
 *   打 /api/channels/process 處理。Queue consumer 一次最長可跑 15 分鐘，AI 跑三輪也夠。
 * - 沒有（還沒建 queue、`next start`、本機）：用 OpenNext 的 `ctx.waitUntil` 在背景 sleep 後直接處理。
 *   注意 Workers 的 waitUntil 在回應送出後只保證 30 秒，AI 跑太久可能被砍；正式環境請建 queue。
 *   完全沒有 Cloudflare context（bun 腳本、next start）時就丟一個不等的 promise，不會炸。
 */
import { getCloudflareContext } from "@opennextjs/cloudflare";
import * as chatDb from "@/db/chat";
import { openRouterApiKey } from "@/lib/ai/config";
import { ModelError } from "@/lib/ai/openrouter";
import { defaultTurnDeps, runTurn, TurnNotFoundError } from "@/lib/ai/turn";
import { getOrgRole } from "@/lib/session";
import { getCurrentOrgId, setCurrentOrgId } from "@/db/current-org";
import { putObject } from "@/lib/storage";
import { appBaseUrl, lineConfig, whatsappConfig } from "./config";
import * as directory from "./directory";
import { processJob, type DispatcherDeps } from "./dispatcher";
import { createLineAdapter } from "./line";
import type { ChannelAdapter, ChannelJob, ChatProvider } from "./types";
import { createWhatsAppAdapter } from "./whatsapp";

export function adapterFor(p: ChatProvider): ChannelAdapter | null {
  if (p === "line") {
    const cfg = lineConfig();
    return cfg ? createLineAdapter(cfg) : null;
  }
  const cfg = whatsappConfig();
  return cfg ? createWhatsAppAdapter(cfg) : null;
}

type CfContext = { env: Record<string, unknown>; ctx: { waitUntil(p: Promise<unknown>): void } };

function cloudflare(): CfContext | null {
  try {
    return getCloudflareContext() as unknown as CfContext;
  } catch {
    return null;
  }
}

function chatQueue(): Queue<ChannelJob> | null {
  const q = cloudflare()?.env.CHAT_QUEUE;
  return q && typeof (q as Queue).send === "function" ? (q as Queue<ChannelJob>) : null;
}

/** 在回應送出後繼續跑（waitUntil）；沒有 Cloudflare context 就單純不等它。 */
export function runInBackground(task: () => Promise<void>): void {
  const p = task().catch((err) => console.error("[channels] background job failed", err));
  cloudflare()?.ctx.waitUntil(p);
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Queue 的 delaySeconds 上限 12 小時；我們只用到幾秒。 */
function delay(seconds: number): number {
  return Math.min(43_200, Math.max(0, Math.ceil(seconds)));
}

/** 排一個工作：有 queue 就送進 queue，沒有就在背景等 delaySeconds 再跑。 */
export async function scheduleJob(job: ChannelJob, delaySeconds = 0): Promise<void> {
  const queue = chatQueue();
  if (queue) {
    await queue.send(job, { delaySeconds: delay(delaySeconds) });
    return;
  }
  runInBackground(async () => {
    if (delaySeconds > 0) await sleep(delaySeconds * 1000);
    await processJob(job, dispatcherDeps());
  });
}

/** webhook 收到的事件：一次送進 queue（sendBatch），沒有 queue 就逐則在背景處理。 */
export async function enqueueEvents(jobs: ChannelJob[]): Promise<void> {
  if (jobs.length === 0) return;
  const queue = chatQueue();
  if (queue) {
    await queue.sendBatch(jobs.map((body) => ({ body })));
    return;
  }
  runInBackground(async () => {
    const deps = dispatcherDeps();
    for (const job of jobs) await processJob(job, deps);
  });
}

export function dispatcherDeps(): DispatcherDeps {
  const apiKey = openRouterApiKey();
  const turnDeps = apiKey ? defaultTurnDeps(apiKey) : null;
  return {
    adapter: adapterFor,
    db: chatDb,
    directory,
    getOrgRole,
    currentOrgId: getCurrentOrgId,
    setCurrentOrgId,
    putObject,
    runTurn: turnDeps ? (p) => runTurn({ ...p, deps: turnDeps }) : null,
    schedule: scheduleJob,
    baseUrl: appBaseUrl(),
    isModelError: (err) => err instanceof ModelError,
    isTurnNotFound: (err) => err instanceof TurnNotFoundError,
  };
}

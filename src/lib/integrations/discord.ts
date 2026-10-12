import { parseIntInRange, parseRoleId, RECAP_DAY_RANGE, REMINDER_DAYS_RANGE } from "./discord-config";
import { markNeedsReauth, recordSyncFailure, recordSyncSuccess, requireEnabledIntegration } from "./store";
import type { IntegrationConfig, IntegrationProvider, TestConnectionResult } from "./types";

/**
 * Discord 整合：用頻道的 Incoming Webhook 發固定支出的扣款提醒與每月回顧
 * （src/lib/billing-notify.ts）。只會對 webhook 網址本身發兩種請求：
 *   - GET：連接時確認 webhook 存在（Discord 回 webhook 資訊，不會發訊息）
 *   - POST ?wait=true：發一則訊息
 *
 * webhook 網址本身就是憑證（網址裡的 token 誰拿到誰就能發言），所以存在
 * credentials_enc；錯誤訊息、log、回傳值一律不含網址。
 */

const WEBHOOK_HOSTS = new Set(["discord.com", "discordapp.com", "ptb.discord.com", "canary.discord.com"]);
const WEBHOOK_PATH = /^\/api\/(?:v\d+\/)?webhooks\/\d+\/[\w-]+\/?$/;
const REQUEST_TIMEOUT_MS = 15_000;
/** 被限流時最多等這麼久再重試一次；Discord 要我們等更久就直接當失敗，明天再發。 */
const MAX_RETRY_WAIT_MS = 10_000;

const FORMAT_HINT = "Webhook 網址格式不對：應為 https://discord.com/api/webhooks/<id>/<token>（頻道設定 › 整合 › Webhook › 複製網址）";

export class DiscordApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "DiscordApiError";
  }
}

/** webhook 被刪掉或 token 被重設（401 / 404）：要重新連接。 */
export class DiscordWebhookGoneError extends DiscordApiError {
  constructor(status: number) {
    super(status, "Discord 找不到這個 webhook（可能已被刪除或重設），請 owner / admin 到 設定 › 整合 重新連接 Discord");
    this.name = "DiscordWebhookGoneError";
  }
}

/** 只接受 https 的 Discord webhook 網址；去掉 query / hash，認不得回 null。 */
export function parseWebhookUrl(raw: string | undefined): URL | null {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || !WEBHOOK_HOSTS.has(url.hostname) || url.port !== "") return null;
  if (!WEBHOOK_PATH.test(url.pathname)) return null;
  url.search = "";
  url.hash = "";
  return url;
}

async function discordFetch(url: URL, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (e) {
    // fetch 的錯誤訊息可能帶網址，所以只留錯誤類型。
    throw new DiscordApiError(0, `無法連線到 Discord（${e instanceof Error ? e.name : "network error"}）`);
  }
}

async function errorFromResponse(res: Response): Promise<DiscordApiError> {
  if (res.status === 401 || res.status === 404) return new DiscordWebhookGoneError(res.status);
  // Discord 的錯誤本文是 { message, code }，不會回顯網址或 token。
  const body = (await res.json().catch(() => null)) as { message?: unknown } | null;
  const detail = typeof body?.message === "string" ? `：${body.message.slice(0, 200)}` : "";
  return new DiscordApiError(res.status, `Discord 回應 ${res.status}${detail}`);
}

/** 429 的等待秒數：本文的 retry_after（秒，可有小數），沒有就看 Retry-After header。 */
async function retryAfterMs(res: Response): Promise<number> {
  const body = (await res.json().catch(() => null)) as { retry_after?: unknown } | null;
  const seconds =
    typeof body?.retry_after === "number" ? body.retry_after : Number(res.headers.get("retry-after"));
  return Number.isFinite(seconds) && seconds >= 0 ? Math.ceil(seconds * 1000) : MAX_RETRY_WAIT_MS + 1;
}

/**
 * 發一則訊息。allowed_mentions 只放行指定的身分組 —— 訊息裡就算出現 @everyone 或
 * 某人的名字也不會真的 tag 到。被限流（429）時照 Discord 給的秒數等一次再重試。
 */
export async function postDiscordMessage(
  webhookUrl: string,
  content: string,
  allowedRoleIds: readonly string[],
): Promise<void> {
  const url = parseWebhookUrl(webhookUrl);
  if (!url) throw new DiscordApiError(0, FORMAT_HINT);
  url.searchParams.set("wait", "true");
  const init: RequestInit = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content, allowed_mentions: { parse: [], roles: allowedRoleIds } }),
  };
  let res = await discordFetch(url, init);
  if (res.status === 429) {
    const wait = await retryAfterMs(res);
    if (wait > MAX_RETRY_WAIT_MS) throw new DiscordApiError(429, "Discord 限流中，稍後再試");
    await new Promise((resolve) => setTimeout(resolve, wait));
    res = await discordFetch(url, init);
  }
  if (!res.ok) throw await errorFromResponse(res);
}

/**
 * 用這個組織的 Discord 整合依序發多則訊息。整合必須已連接、已開啟（否則丟
 * IntegrationUnavailableError）。全部成功記 recordSyncSuccess；webhook 不見了 →
 * markNeedsReauth；其他 Discord 錯誤 → recordSyncFailure。錯誤原樣往外丟。
 */
export async function sendDiscordMessages(
  orgId: string,
  messages: readonly string[],
  allowedRoleIds: readonly string[],
): Promise<void> {
  const { credentials } = await requireEnabledIntegration(orgId, "discord");
  try {
    for (const content of messages) {
      await postDiscordMessage(credentials.webhookUrl, content, allowedRoleIds);
    }
    await recordSyncSuccess(orgId, "discord");
  } catch (e) {
    if (e instanceof DiscordWebhookGoneError) {
      await markNeedsReauth(orgId, "discord", "Discord webhook 已失效（被刪除或重設）");
    } else if (e instanceof DiscordApiError) {
      await recordSyncFailure(orgId, "discord", e.message);
    }
    throw e;
  }
}

/** 連接時一併輸入的設定：有填就要合法，不然在連接當下就講清楚，而不是事後默默用預設值。 */
function configError(config: IntegrationConfig): string | null {
  const present = (key: string) => {
    const v = config[key];
    return typeof v === "string" && v.trim() !== "";
  };
  if (present("mentionRoleId") && !parseRoleId(config.mentionRoleId)) {
    return "要 @ 的身分組 ID 應該是一串數字（伺服器設定 › 身分組 › 右鍵 › 複製身分組 ID）";
  }
  if (present("recapDay") && parseIntInRange(config.recapDay, RECAP_DAY_RANGE) === null) {
    return `每月回顧日要是 ${RECAP_DAY_RANGE.min}–${RECAP_DAY_RANGE.max} 的整數`;
  }
  if (present("reminderDays") && parseIntInRange(config.reminderDays, REMINDER_DAYS_RANGE) === null) {
    return `提前提醒天數要是 ${REMINDER_DAYS_RANGE.min}–${REMINDER_DAYS_RANGE.max} 的整數`;
  }
  return null;
}

type WebhookInfo = { name?: unknown; channel_id?: unknown; guild_id?: unknown };

export const discordProvider: IntegrationProvider = {
  id: "discord",
  async testConnection(creds, config): Promise<TestConnectionResult> {
    const url = parseWebhookUrl(creds.webhookUrl);
    if (!url) return { ok: false, error: FORMAT_HINT };
    const invalid = configError(config);
    if (invalid) return { ok: false, error: invalid };

    // GET webhook 網址只會回 webhook 資訊，不會在頻道裡發任何東西。
    const res = await discordFetch(url, { method: "GET" });
    if (!res.ok) return { ok: false, error: (await errorFromResponse(res)).message };
    const info = (await res.json().catch(() => ({}))) as WebhookInfo;
    const str = (v: unknown) => (typeof v === "string" ? v : null);
    return {
      ok: true,
      config: {
        channelId: str(info.channel_id),
        guildId: str(info.guild_id),
        webhookName: str(info.name),
        // 存正規化後的 id（使用者可能貼了 <@&123>）。
        ...(parseRoleId(config.mentionRoleId) ? { mentionRoleId: parseRoleId(config.mentionRoleId) } : {}),
      },
    };
  },
};

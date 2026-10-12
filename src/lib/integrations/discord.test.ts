import { afterEach, describe, expect, test } from "bun:test";
import { parseDiscordConfig } from "./discord-config";
import { DiscordWebhookGoneError, discordProvider, parseWebhookUrl, postDiscordMessage } from "./discord";

const TOKEN = "s3cr3t-T0ken_abc";
const WEBHOOK = `https://discord.com/api/webhooks/123456789012345678/${TOKEN}`;

type Call = { url: string; init: RequestInit | undefined };
const realFetch = globalThis.fetch;

/** 依序回傳給定的 Response，並記下每次呼叫。 */
function mockFetch(responses: Response[]): Call[] {
  const calls: Call[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    const next = responses.shift();
    if (!next) throw new Error("unexpected fetch");
    return next;
  }) as typeof fetch;
  return calls;
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("parseWebhookUrl", () => {
  test("accepts Discord webhook URLs and drops query / hash", () => {
    expect(parseWebhookUrl(`${WEBHOOK}?wait=true#x`)?.toString()).toBe(WEBHOOK);
    expect(parseWebhookUrl(` https://ptb.discord.com/api/v10/webhooks/1/${TOKEN} `)?.hostname).toBe("ptb.discord.com");
  });

  test("rejects anything that is not an https Discord webhook", () => {
    expect(parseWebhookUrl(WEBHOOK.replace("https:", "http:"))).toBeNull();
    expect(parseWebhookUrl(`https://evil.example/api/webhooks/1/${TOKEN}`)).toBeNull();
    expect(parseWebhookUrl("https://discord.com/api/channels/1/messages")).toBeNull();
    expect(parseWebhookUrl("not a url")).toBeNull();
  });
});

describe("parseDiscordConfig", () => {
  test("defaults, range checks and a pasted role mention", () => {
    expect(parseDiscordConfig({})).toEqual({ mentionRoleId: null, recapDay: 1, reminderDays: 3 });
    expect(parseDiscordConfig({ mentionRoleId: "<@&112233445566>", recapDay: "5", reminderDays: "0" })).toEqual({
      mentionRoleId: "112233445566",
      recapDay: 5,
      reminderDays: 0,
    });
    expect(parseDiscordConfig({ recapDay: "29", reminderDays: "-1" })).toEqual({
      mentionRoleId: null,
      recapDay: 1,
      reminderDays: 3,
    });
  });
});

const CTX = { orgId: "org_test" };

describe("discordProvider.testConnection", () => {
  test("reads the webhook with GET and stores channel / guild / name", async () => {
    const calls = mockFetch([Response.json({ name: "Billing bot", channel_id: "42", guild_id: "7" })]);
    const result = await discordProvider.testConnection({ webhookUrl: WEBHOOK }, { mentionRoleId: "<@&112233445566>" }, CTX);
    expect(result).toEqual({
      ok: true,
      config: { channelId: "42", guildId: "7", webhookName: "Billing bot", mentionRoleId: "112233445566" },
    });
    expect(calls.map((c) => [c.init?.method, c.url])).toEqual([["GET", WEBHOOK]]);
  });

  test("a deleted webhook is a clear error that never echoes the token", async () => {
    mockFetch([Response.json({ message: "Unknown Webhook", code: 10015 }, { status: 404 })]);
    const result = await discordProvider.testConnection({ webhookUrl: WEBHOOK }, {}, CTX);
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).toContain("找不到這個 webhook");
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });

  test("bad URL or bad settings fail before calling Discord", async () => {
    const calls = mockFetch([]);
    expect((await discordProvider.testConnection({ webhookUrl: "https://example.com/x" }, {}, CTX)).ok).toBe(false);
    expect(await discordProvider.testConnection({ webhookUrl: WEBHOOK }, { recapDay: "31" }, CTX)).toEqual({
      ok: false,
      error: "每月回顧日要是 1–28 的整數",
    });
    expect(calls).toEqual([]);
  });
});

describe("postDiscordMessage", () => {
  test("posts with wait=true, mentions only the allowed role, and retries once after 429", async () => {
    const calls = mockFetch([
      Response.json({ retry_after: 0.01, global: false }, { status: 429 }),
      Response.json({ id: "1" }),
    ]);
    await postDiscordMessage(WEBHOOK, "hello <@&999> @everyone", ["999"]);
    expect(calls.length).toBe(2);
    expect(calls[1].url).toBe(`${WEBHOOK}?wait=true`);
    expect(JSON.parse(String(calls[1].init?.body))).toEqual({
      content: "hello <@&999> @everyone",
      allowed_mentions: { parse: [], roles: ["999"] },
    });
  });

  test("401 / 404 mean the webhook is gone", async () => {
    mockFetch([Response.json({ message: "Invalid Webhook Token" }, { status: 401 })]);
    await expect(postDiscordMessage(WEBHOOK, "x", [])).rejects.toBeInstanceOf(DiscordWebhookGoneError);
  });
});

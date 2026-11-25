import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { base64ToBytes } from "../../src/lib/channels/crypto";
import { parseJob } from "../../src/lib/channels/job-parse";
import { handle, MAX_QUEUED_BODY_BYTES, type Env } from "./index";

const LINE_SECRET = "line-secret";
const WA_SECRET = "wa-secret";
const BASE = "https://internal.pathors.com";

function makeEnv(overrides: Partial<Env> = {}) {
  const sent: unknown[] = [];
  const forwarded: Request[] = [];
  const env: Env = {
    APP: { fetch: async (r: Request) => (forwarded.push(r), new Response("from app", { status: 202 })) } as unknown as Fetcher,
    CHAT_QUEUE: { send: async (m: unknown) => void sent.push(m) } as unknown as Queue<unknown>,
    LINE_CHANNEL_SECRET: LINE_SECRET,
    WHATSAPP_APP_SECRET: WA_SECRET,
    ...overrides,
  };
  return { env, sent, forwarded };
}

const lineSig = (body: string) => createHmac("sha256", LINE_SECRET).update(body).digest("base64");
const waSig = (body: string) => "sha256=" + createHmac("sha256", WA_SECRET).update(body).digest("hex");

function post(path: string, body: string, headers: Record<string, string>) {
  return new Request(BASE + path, { method: "POST", headers, body });
}

describe("webhook-ack 前哨", () => {
  test("LINE 簽章對：原始 body 進佇列、回 200，處理端解得回同樣的 bytes", async () => {
    const { env, sent, forwarded } = makeEnv();
    const body = '{"destination":"U1","events":[{"type":"message","text":"中文"}]}';
    const res = await handle(post("/api/channels/line/webhook", body, { "X-Line-Signature": lineSig(body) }), env);
    expect(res.status).toBe(200);
    expect(forwarded).toHaveLength(0);
    expect(sent).toHaveLength(1);
    const job = parseJob(JSON.parse(JSON.stringify(sent[0])));
    expect(job?.kind).toBe("raw");
    if (job?.kind !== "raw") throw new Error("not raw");
    expect(job.provider).toBe("line");
    expect(new TextDecoder().decode(base64ToBytes(job.body)!)).toBe(body);
    expect(job.headers["x-line-signature"]).toBe(lineSig(body));
  });

  test("WhatsApp 簽章對也進佇列", async () => {
    const { env, sent } = makeEnv();
    const body = '{"entry":[]}';
    const res = await handle(post("/api/channels/whatsapp/webhook", body, { "X-Hub-Signature-256": waSig(body) }), env);
    expect(res.status).toBe(200);
    expect((sent[0] as { provider: string }).provider).toBe("whatsapp");
  });

  test("簽章錯回 401，不進佇列", async () => {
    const { env, sent } = makeEnv();
    const res = await handle(post("/api/channels/line/webhook", "{}", { "X-Line-Signature": lineSig("other") }), env);
    expect(res.status).toBe(401);
    expect(sent).toHaveLength(0);
  });

  test("沒設 secret 的平台回 404", async () => {
    const { env, sent } = makeEnv({ WHATSAPP_APP_SECRET: undefined });
    const res = await handle(post("/api/channels/whatsapp/webhook", "{}", { "X-Hub-Signature-256": waSig("{}") }), env);
    expect(res.status).toBe(404);
    expect(sent).toHaveLength(0);
  });

  test("進不了佇列回 500，讓平台重送", async () => {
    const { env } = makeEnv({
      CHAT_QUEUE: { send: async () => { throw new Error("down"); } } as unknown as Queue<unknown>,
    });
    const res = await handle(post("/api/channels/line/webhook", "{}", { "X-Line-Signature": lineSig("{}") }), env);
    expect(res.status).toBe(500);
  });

  test("body 太大放不進佇列：同步轉給主站", async () => {
    const { env, sent, forwarded } = makeEnv();
    const body = JSON.stringify({ events: [{ text: "x".repeat(MAX_QUEUED_BODY_BYTES) }] });
    const res = await handle(post("/api/channels/line/webhook", body, { "X-Line-Signature": lineSig(body) }), env);
    expect(res.status).toBe(202);
    expect(sent).toHaveLength(0);
    expect(await forwarded[0].text()).toBe(body);
  });

  test("GET（WhatsApp 訂閱驗證）原樣轉給主站", async () => {
    const { env, forwarded } = makeEnv();
    const res = await handle(new Request(BASE + "/api/channels/whatsapp/webhook?hub.mode=subscribe"), env);
    expect(res.status).toBe(202);
    expect(forwarded[0].url).toContain("hub.mode=subscribe");
  });
});

describe("parseJob raw", () => {
  test("缺欄位或 header 不是字串就丟掉", () => {
    expect(parseJob({ kind: "raw", provider: "line", body: "e30=", headers: {} })?.kind).toBe("raw");
    expect(parseJob({ kind: "raw", provider: "sms", body: "e30=", headers: {} })).toBeNull();
    expect(parseJob({ kind: "raw", provider: "line", headers: {} })).toBeNull();
    expect(parseJob({ kind: "raw", provider: "line", body: "e30=", headers: { a: 1 } })).toBeNull();
  });
});

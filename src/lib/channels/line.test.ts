import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import {
  buildLineMessages,
  cardBubble,
  cardsToFlex,
  createLineAdapter,
  LINE_BUBBLE_MAX_BYTES,
  LINE_CAROUSEL_MAX,
  LINE_CAROUSEL_MAX_BYTES,
  parseLineWebhook,
  verifyLineSignature,
} from "./line";
import type { ConfirmCard } from "./types";

const SECRET = "test-channel-secret";
const enc = (s: string) => new TextEncoder().encode(s);
const sign = (body: string) => createHmac("sha256", SECRET).update(body).digest("base64");

// 官方文件的範例 payload（https://developers.line.biz/en/reference/messaging-api/#webhook-event-objects）
const USER = "U4af4980629aaaaaaaaaaaaaaaaaaaaaa";
const sample = {
  destination: "xxxxxxxxxx",
  events: [
    {
      type: "message",
      message: {
        type: "text",
        id: "468789577898262530",
        quoteToken: "q3Plxr4AgKd...",
        quotedMessageId: "468789532432007169",
        text: "這是代墊",
      },
      webhookEventId: "01H810YECXQQZ37VAXPF6H9E6T",
      deliveryContext: { isRedelivery: false },
      timestamp: 1692251666727,
      source: { type: "user", userId: USER },
      replyToken: "38ef843bde154d9b91c21320ffd17a0f",
      mode: "active",
    },
    {
      type: "message",
      message: {
        type: "image",
        id: "354718705033693859",
        quoteToken: "q3Plxr4AgKd...",
        contentProvider: { type: "line" },
        imageSet: { id: "E005D41A7288F41B65593ED38FF6E9834B046AB36A37921A56BC236F13A91855", index: 1, total: 2 },
      },
      webhookEventId: "01H810YECXQQZ37VAXPF6H9E6U",
      deliveryContext: { isRedelivery: false },
      timestamp: 1692251666728,
      source: { type: "user", userId: USER },
      replyToken: "rt2",
      mode: "active",
    },
    {
      type: "message",
      message: { type: "file", id: "325708", fileName: "invoice.pdf", fileSize: 2138, quoteToken: "q" },
      webhookEventId: "ev3",
      deliveryContext: { isRedelivery: false },
      timestamp: 1692251666729,
      source: { type: "user", userId: USER },
      replyToken: "rt3",
      mode: "active",
    },
    {
      type: "postback",
      postback: { data: "c:abc123defg:confirm" },
      webhookEventId: "ev4",
      deliveryContext: { isRedelivery: false },
      timestamp: 1692251666730,
      source: { type: "user", userId: USER },
      replyToken: "rt4",
      mode: "active",
    },
    {
      type: "follow",
      follow: { isUnblocked: false },
      webhookEventId: "ev5",
      deliveryContext: { isRedelivery: false },
      timestamp: 1692251666731,
      source: { type: "user", userId: USER },
      replyToken: "rt5",
      mode: "active",
    },
    {
      type: "message",
      message: { type: "sticker", id: "1501597916", quoteToken: "q", stickerId: "52002738", packageId: "11537" },
      webhookEventId: "ev6",
      deliveryContext: { isRedelivery: false },
      timestamp: 1692251666732,
      source: { type: "user", userId: USER },
      replyToken: "rt6",
      mode: "active",
    },
    {
      type: "join",
      webhookEventId: "ev7",
      deliveryContext: { isRedelivery: false },
      timestamp: 1692251666733,
      source: { type: "group", groupId: "Ca56f94637c..." },
      replyToken: "rt7",
      mode: "active",
    },
    {
      type: "unfollow",
      webhookEventId: "ev8",
      deliveryContext: { isRedelivery: false },
      timestamp: 1692251666734,
      source: { type: "user", userId: USER },
      mode: "active",
    },
    {
      type: "message",
      message: { type: "text", id: "9", text: "hi", quoteToken: "q" },
      webhookEventId: "ev9",
      deliveryContext: { isRedelivery: false },
      timestamp: 1692251666735,
      source: { type: "group", groupId: "Cgroup", userId: USER },
      replyToken: "rt9",
      mode: "active",
    },
  ],
};

describe("LINE 驗簽", () => {
  test("對的簽章通過、改過 body 或簽章就失敗", async () => {
    const body = JSON.stringify(sample);
    expect(await verifyLineSignature(SECRET, enc(body), sign(body))).toBe(true);
    expect(await verifyLineSignature(SECRET, enc(`${body} `), sign(body))).toBe(false);
    expect(await verifyLineSignature(SECRET, enc(body), sign("x"))).toBe(false);
    expect(await verifyLineSignature(SECRET, enc(body), null)).toBe(false);
    expect(await verifyLineSignature(SECRET, enc(body), "not base64 !!")).toBe(false);
  });

  test("adapter.verify 讀 x-line-signature", async () => {
    const a = createLineAdapter({ channelSecret: SECRET, accessToken: "t", basicId: "@bot" });
    const body = '{"destination":"x","events":[]}';
    expect(await a.verify(new Headers({ "x-line-signature": sign(body) }), enc(body))).toBe(true);
    expect(await a.verify(new Headers(), enc(body))).toBe(false);
  });
});

describe("LINE 事件解析", () => {
  const events = parseLineWebhook(JSON.stringify(sample));

  test("unfollow 略過，其他都轉成事件", () => {
    expect(events.length).toBe(8);
  });

  test("文字（含引用）", () => {
    expect(events[0]).toMatchObject({
      provider: "line",
      kind: "text",
      text: "這是代墊",
      eventId: "01H810YECXQQZ37VAXPF6H9E6T",
      messageId: "468789577898262530",
      externalUserId: USER,
      isGroup: false,
      replyToken: "38ef843bde154d9b91c21320ffd17a0f",
      quotedMessageId: "468789532432007169",
      receivedAt: 1692251666727,
    });
  });

  test("圖片與檔案", () => {
    expect(events[1]).toMatchObject({ kind: "media", media: { id: "354718705033693859", mime: "image/jpeg" } });
    expect(events[2]).toMatchObject({ kind: "media", media: { id: "325708", fileName: "invoice.pdf", size: 2138 } });
  });

  test("postback、follow、貼圖、群組", () => {
    expect(events[3]).toMatchObject({ kind: "button", payload: "c:abc123defg:confirm" });
    expect(events[4]).toMatchObject({ kind: "follow" });
    expect(events[5]).toMatchObject({ kind: "unsupported", what: "sticker" });
    expect(events[6]).toMatchObject({ isGroup: true, group: { id: "Ca56f94637c...", type: "group" } });
    expect(events[7]).toMatchObject({ kind: "text", isGroup: true, group: { id: "Cgroup", type: "group" } });
  });

  test("壞掉的 JSON 回空陣列", () => {
    expect(parseLineWebhook("{")).toEqual([]);
  });
});

function card(i: number, rows = 6): ConfirmCard {
  return {
    cardId: `card${String(i).padStart(6, "0")}`,
    title: `新增支出 ${i}`,
    orgName: "派斯科技",
    actorName: "Jack",
    rows: Array.from({ length: rows }, (_, k) => ({ label: `欄位${k}`, value: `值${k}` })),
    ruleHint: "依規則：Google → 軟體工具",
    actions: ["confirm", "edit", "cancel"],
  };
}

const bytes = (v: unknown) => new TextEncoder().encode(JSON.stringify(v)).byteLength;

describe("LINE Flex", () => {
  test("一張卡：標題、組織 · 操作人、規則、三顆 postback", () => {
    const b = cardBubble(card(1), "zh-TW") as Record<string, unknown>;
    const json = JSON.stringify(b);
    expect(b.type).toBe("bubble");
    expect(json).toContain("派斯科技 · Jack");
    expect(json).toContain("規則：依規則：Google → 軟體工具");
    expect(json).toContain('"data":"c:card000001:confirm"');
    expect(json).toContain('"data":"c:card000001:edit"');
    expect(json).toContain('"data":"c:card000001:cancel"');
    expect(bytes(b)).toBeLessThanOrEqual(LINE_BUBBLE_MAX_BYTES);
  });

  test("超大的卡會砍列到 30KB 以內", () => {
    const big: ConfirmCard = {
      ...card(1, 0),
      rows: Array.from({ length: 200 }, (_, k) => ({ label: `欄位${k}`, value: "很長的值".repeat(50) })),
    };
    expect(bytes(cardBubble(big, "zh-TW"))).toBeLessThanOrEqual(LINE_BUBBLE_MAX_BYTES);
  });

  test("一張用 bubble，多張用 carousel，每則最多 12 張且 ≤ 50KB", () => {
    expect((cardsToFlex([card(1)], "zh-TW")[0].message.contents as { type: string }).type).toBe("bubble");
    const many = cardsToFlex(Array.from({ length: 14 }, (_, i) => card(i)), "zh-TW");
    expect(many.length).toBe(2);
    for (const m of many) {
      const contents = m.message.contents as { type: string; contents: unknown[] };
      expect(contents.type).toBe("carousel");
      expect(contents.contents.length).toBeLessThanOrEqual(LINE_CAROUSEL_MAX);
      expect(bytes(contents)).toBeLessThanOrEqual(LINE_CAROUSEL_MAX_BYTES);
      expect(String(m.message.altText).length).toBeLessThanOrEqual(400);
    }
    expect(many[0].cardId).toBe("card000000");
  });

  test("批次卡：一顆全部確認", () => {
    const batch: ConfirmCard = { ...card(9), actions: ["all"], confirmLabel: "全部確認（3 筆）" };
    const json = JSON.stringify(cardBubble(batch, "zh-TW"));
    expect(json).toContain('"data":"c:card000009:all"');
    expect(json).not.toContain(":confirm");
  });

  test("文字的 quick reply：最多 13 個、label ≤ 20 字", () => {
    const [m] = buildLineMessages(
      [
        {
          type: "text",
          text: "要做什麼？",
          quickReplies: Array.from({ length: 20 }, (_, i) => ({ label: `選項${i}很長很長很長很長很長很長很長`, text: `選項${i}` })),
        },
      ],
      "zh-TW",
    );
    const items = (m.message.quickReply as { items: { action: { type: string; label: string; text: string } }[] }).items;
    expect(items.length).toBe(13);
    for (const i of items) {
      expect(i.action.type).toBe("message");
      expect(i.action.label.length).toBeLessThanOrEqual(20);
    }
  });

  test("組織選單：postback o:<id>", () => {
    const [m] = buildLineMessages(
      [{ type: "orgPicker", text: "要切換到哪個組織？", orgs: [{ id: "org-1", name: "派斯科技", current: true }, { id: "org-2", name: "東蜂科技" }] }],
      "zh-TW",
    );
    const json = JSON.stringify(m.message);
    expect(json).toContain('"data":"o:org-1"');
    expect(json).toContain('"data":"o:org-2"');
  });
});

describe("LINE send", () => {
  function fakeFetch(fail400 = false) {
    const calls: { url: string; body: Record<string, unknown> }[] = [];
    let n = 0;
    const fetchImpl = async (url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      calls.push({ url, body });
      if (fail400 && url.endsWith("/reply")) return new Response('{"message":"Invalid reply token"}', { status: 400 });
      const messages = (body.messages as unknown[]) ?? [];
      return Response.json({ sentMessages: messages.map(() => ({ id: `s${++n}`, quoteToken: "q" })) });
    };
    return { calls, fetchImpl };
  }
  const cfg = { channelSecret: SECRET, accessToken: "tok", basicId: "@bot" };

  test("reply token 新鮮就 reply，記下 sentMessages id", async () => {
    const f = fakeFetch();
    const a = createLineAdapter(cfg, f.fetchImpl);
    const sent = await a.send(USER, [{ type: "text", text: "hi" }, { type: "cards", cards: [card(1)] }], {
      replyToken: "rt",
      replyTokenAt: Date.now() - 1000,
    });
    expect(f.calls.length).toBe(1);
    expect(f.calls[0].url).toBe("https://api.line.me/v2/bot/message/reply");
    expect(sent).toEqual([
      { externalId: "s1", snippet: "hi" },
      expect.objectContaining({ externalId: "s2", cardId: "card000001" }),
    ]);
  });

  test("超過 50 秒改 push；超過 5 則分批，後面的都 push", async () => {
    const f = fakeFetch();
    const a = createLineAdapter(cfg, f.fetchImpl);
    await a.send(USER, [{ type: "text", text: "old" }], { replyToken: "rt", replyTokenAt: Date.now() - 55_000 });
    expect(f.calls[0].url).toEndWith("/push");
    expect(f.calls[0].body.to).toBe(USER);

    const g = fakeFetch();
    const b = createLineAdapter(cfg, g.fetchImpl);
    const sent = await b.send(
      USER,
      Array.from({ length: 7 }, (_, i) => ({ type: "text" as const, text: `m${i}` })),
      { replyToken: "rt", replyTokenAt: Date.now() },
    );
    expect(g.calls.map((c) => c.url.split("/").pop())).toEqual(["reply", "push"]);
    expect((g.calls[0].body.messages as unknown[]).length).toBe(5);
    expect(sent.length).toBe(7);
  });

  test("reply token 失效（400）改 push", async () => {
    const f = fakeFetch(true);
    const a = createLineAdapter(cfg, f.fetchImpl);
    const sent = await a.send(USER, [{ type: "text", text: "hi" }], { replyToken: "rt", replyTokenAt: Date.now() });
    expect(f.calls.map((c) => c.url.split("/").pop())).toEqual(["reply", "push"]);
    expect(sent.length).toBe(1);
  });

  test("loading 動畫 60 秒", async () => {
    const f = fakeFetch();
    await createLineAdapter(cfg, f.fetchImpl).showTyping(USER);
    expect(f.calls[0]).toEqual({
      url: "https://api.line.me/v2/bot/chat/loading/start",
      body: { chatId: USER, loadingSeconds: 60 },
    });
  });

  test("下載檔案：超過上限回 null", async () => {
    const a = createLineAdapter(cfg, async () => new Response(new Uint8Array(20), { headers: { "content-type": "image/png" } }));
    expect(await a.downloadMedia({ id: "1" }, 10)).toBeNull();
    const ok = await a.downloadMedia({ id: "1" }, 100);
    expect(ok?.mime).toBe("image/png");
    expect(ok?.bytes.byteLength).toBe(20);
  });
});

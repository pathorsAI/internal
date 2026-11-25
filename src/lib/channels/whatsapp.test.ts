import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { helpMessage } from "./render";
import { botStrings } from "./strings";
import type { ConfirmCard } from "./types";
import {
  buildWhatsAppMessages,
  cardToWhatsApp,
  createWhatsAppAdapter,
  parseWhatsAppWebhook,
  verifyWhatsAppSignature,
  WA_BODY_MAX,
  WA_BUTTON_TITLE_MAX,
  WA_BUTTONS_MAX,
  whatsappChallenge,
} from "./whatsapp";

const APP_SECRET = "test-app-secret";
const enc = (s: string) => new TextEncoder().encode(s);
const sign = (body: string) => `sha256=${createHmac("sha256", APP_SECRET).update(body).digest("hex")}`;
const cfg = {
  accessToken: "tok",
  phoneNumberId: "123456123",
  appSecret: APP_SECRET,
  verifyToken: "verify-me",
  displayNumber: "+886 912 345 678",
};

// 官方文件的範例（https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/payload-examples）
function webhook(messages: unknown[], extra: Record<string, unknown> = {}) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "WHATSAPP_BUSINESS_ACCOUNT_ID",
        changes: [
          {
            value: {
              messaging_product: "whatsapp",
              metadata: { display_phone_number: "16505551111", phone_number_id: "123456123" },
              contacts: [{ profile: { name: "Kerry Fisher" }, wa_id: "16315551181" }],
              messages,
              ...extra,
            },
            field: "messages",
          },
        ],
      },
    ],
  };
}

const textMsg = {
  from: "16315551181",
  id: "wamid.ABGGFlA5Fpa",
  timestamp: "1504902988",
  type: "text",
  text: { body: "這是代墊" },
  context: { from: "16505551111", id: "wamid.QUOTED" },
};
const imageMsg = {
  from: "16315551181",
  id: "wamid.IMG",
  timestamp: "1504902989",
  type: "image",
  image: { caption: "計程車", mime_type: "image/jpeg", sha256: "IMAGE_HASH", id: "IMAGE_ID" },
};
const docMsg = {
  from: "16315551181",
  id: "wamid.DOC",
  timestamp: "1504902990",
  type: "document",
  document: { caption: "", filename: "invoice.pdf", mime_type: "application/pdf", sha256: "H", id: "DOC_ID" },
};
const buttonMsg = {
  from: "16315551181",
  id: "wamid.BTN",
  timestamp: "1504902991",
  type: "interactive",
  interactive: { type: "button_reply", button_reply: { id: "c:abc123defg:confirm", title: "確認" } },
};
const quickMsg = {
  from: "16315551181",
  id: "wamid.Q",
  timestamp: "1504902992",
  type: "interactive",
  interactive: { type: "button_reply", button_reply: { id: "q:我先墊的", title: "我先墊的" } },
};
const listMsg = {
  from: "16315551181",
  id: "wamid.LIST",
  timestamp: "1504902993",
  type: "interactive",
  interactive: { type: "list_reply", list_reply: { id: "o:org-2", title: "東蜂科技", description: "" } },
};
const stickerMsg = {
  from: "16315551181",
  id: "wamid.STK",
  timestamp: "1504902994",
  type: "sticker",
  sticker: { mime_type: "image/webp", sha256: "H", id: "S" },
};

describe("WhatsApp 驗證", () => {
  test("GET 訂閱驗證", () => {
    const ok = new URLSearchParams({ "hub.mode": "subscribe", "hub.verify_token": "verify-me", "hub.challenge": "1158201444" });
    expect(whatsappChallenge(ok, "verify-me")).toBe("1158201444");
    const bad = new URLSearchParams({ "hub.mode": "subscribe", "hub.verify_token": "nope", "hub.challenge": "1" });
    expect(whatsappChallenge(bad, "verify-me")).toBeNull();
    expect(whatsappChallenge(new URLSearchParams({ "hub.verify_token": "verify-me" }), "verify-me")).toBeNull();
  });

  test("X-Hub-Signature-256", async () => {
    const body = JSON.stringify(webhook([textMsg]));
    expect(await verifyWhatsAppSignature(APP_SECRET, enc(body), sign(body))).toBe(true);
    expect(await verifyWhatsAppSignature(APP_SECRET, enc(`${body}x`), sign(body))).toBe(false);
    expect(await verifyWhatsAppSignature(APP_SECRET, enc(body), sign(body).replace("sha256=", ""))).toBe(false);
    expect(await verifyWhatsAppSignature(APP_SECRET, enc(body), "sha256=zz")).toBe(false);
    const a = createWhatsAppAdapter(cfg);
    expect(await a.verify(new Headers({ "x-hub-signature-256": sign(body) }), enc(body))).toBe(true);
  });
});

describe("WhatsApp 事件解析", () => {
  const events = parseWhatsAppWebhook(
    JSON.stringify(webhook([textMsg, imageMsg, docMsg, buttonMsg, quickMsg, listMsg, stickerMsg])),
    "123456123",
  );

  test("文字（含引用 context.id、顯示名稱）", () => {
    expect(events[0]).toMatchObject({
      provider: "whatsapp",
      kind: "text",
      text: "這是代墊",
      eventId: "wamid.ABGGFlA5Fpa",
      messageId: "wamid.ABGGFlA5Fpa",
      externalUserId: "16315551181",
      displayName: "Kerry Fisher",
      isGroup: false,
      quotedMessageId: "wamid.QUOTED",
      receivedAt: 1504902988000,
    });
  });

  test("圖片、文件", () => {
    expect(events[1]).toMatchObject({ kind: "media", media: { id: "IMAGE_ID", mime: "image/jpeg" }, caption: "計程車" });
    expect(events[2]).toMatchObject({
      kind: "media",
      media: { id: "DOC_ID", mime: "application/pdf", fileName: "invoice.pdf" },
    });
  });

  test("按鈕：確認卡、快速選項（當成文字）、清單", () => {
    expect(events[3]).toMatchObject({ kind: "button", payload: "c:abc123defg:confirm" });
    expect(events[4]).toMatchObject({ kind: "text", text: "我先墊的" });
    expect(events[5]).toMatchObject({ kind: "button", payload: "o:org-2" });
    expect(events[6]).toMatchObject({ kind: "unsupported", what: "sticker" });
  });

  test("statuses 略過；別的號碼、別的 object 略過", () => {
    const statuses = webhook([], {
      statuses: [{ id: "wamid.X", status: "delivered", timestamp: "1", recipient_id: "16315551181" }],
    });
    expect(parseWhatsAppWebhook(JSON.stringify(statuses), "123456123")).toEqual([]);
    expect(parseWhatsAppWebhook(JSON.stringify(webhook([textMsg])), "999")).toEqual([]);
    expect(parseWhatsAppWebhook(JSON.stringify({ object: "page", entry: [] }))).toEqual([]);
  });

  test("群組訊息標成 isGroup", () => {
    const [e] = parseWhatsAppWebhook(JSON.stringify(webhook([{ ...textMsg, group_id: "G1" }])));
    expect(e.isGroup).toBe(true);
  });
});

const card: ConfirmCard = {
  cardId: "abc123defg",
  title: "新增支出 11/22 計程車 NT$2,400",
  orgName: "派斯科技",
  actorName: "Jack",
  rows: Array.from({ length: 12 }, (_, k) => ({ label: `欄位${k}`, value: "值".repeat(200) })),
  ruleHint: "依規則：計程車 → 交通費",
  actions: ["confirm", "edit", "cancel"],
};

describe("WhatsApp interactive", () => {
  test("確認卡：≤ 3 顆、標題 ≤ 20 字、body ≤ 1024", () => {
    const p = cardToWhatsApp(card, "zh-TW") as {
      type: string;
      interactive: {
        type: string;
        header: { text: string };
        body: { text: string };
        footer: { text: string };
        action: { buttons: { reply: { id: string; title: string } }[] };
      };
    };
    expect(p.type).toBe("interactive");
    expect(p.interactive.type).toBe("button");
    expect(p.interactive.body.text.length).toBeLessThanOrEqual(WA_BODY_MAX);
    expect(p.interactive.footer.text).toBe("派斯科技 · Jack");
    const buttons = p.interactive.action.buttons;
    expect(buttons.length).toBeLessThanOrEqual(WA_BUTTONS_MAX);
    expect(buttons.map((b) => b.reply.id)).toEqual(["c:abc123defg:confirm", "c:abc123defg:edit", "c:abc123defg:cancel"]);
    for (const b of buttons) expect(b.reply.title.length).toBeLessThanOrEqual(WA_BUTTON_TITLE_MAX);
  });

  test("快速選項：≤ 3 個用按鈕（id 帶原文）、超過列成文字", () => {
    const [three] = buildWhatsAppMessages(
      [{ type: "text", text: "誰付的？", quickReplies: ["我先墊的", "公司信用卡", "公司帳戶"].map((t) => ({ label: t, text: t })) }],
      "zh-TW",
    );
    const json = JSON.stringify(three.payload);
    expect(json).toContain('"id":"q:我先墊的"');
    const [four] = buildWhatsAppMessages(
      [{ type: "text", text: "要做什麼？", quickReplies: ["a", "b", "c", "d"].map((t) => ({ label: t, text: t })) }],
      "zh-TW",
    );
    expect(four.payload.type).toBe("text");
    expect((four.payload.text as { body: string }).body).toContain("4. d");
  });

  test("組織選單：超過 3 個用 list", () => {
    const orgs = Array.from({ length: 5 }, (_, i) => ({ id: `org-${i}`, name: `組織${i}` }));
    const [m] = buildWhatsAppMessages([{ type: "orgPicker", text: "選組織", orgs }], "zh-TW");
    expect((m.payload.interactive as { type: string }).type).toBe("list");
    expect(JSON.stringify(m.payload)).toContain('"id":"o:org-4"');
  });

  test("說明卡：四則 image（link＋caption 寫標題與內文），最後一則文字列出指令", () => {
    const BASE = "https://internal.pathors.com";
    const built = buildWhatsAppMessages([helpMessage(botStrings("zh-TW"), BASE, `${BASE}/dashboard/settings/chat`)], "zh-TW");
    expect(built.length).toBe(5);
    expect(built[0].payload).toEqual({
      type: "image",
      image: { link: `${BASE}/line/help-1.png`, caption: "拍照記帳\n傳收據、發票、水單照片，我讀出金額日期，你按確認就記好" },
    });
    expect(built.slice(0, 4).map((b) => (b.payload.image as { link: string }).link)).toEqual(
      [1, 2, 3, 4].map((i) => `${BASE}/line/help-${i}.png`),
    );
    expect(built[4].payload.type).toBe("text");
    const commands = (built[4].payload.text as { body: string }).body;
    for (const c of ["說明", "切換組織", "新對話", "解除綁定"]) expect(commands).toContain(c);
  });

  test("表格、連結、收據卡沒有 Flex：都寫成文字", () => {
    const [t] = buildWhatsAppMessages(
      [{ type: "table", table: { title: "本月", headers: ["對象", "金額"], rows: [["AWS", "1,000"]], numeric: [false, true] } }],
      "zh-TW",
    );
    expect((t.payload.text as { body: string }).body).toBe("本月\n\n對象：AWS\n金額：1,000");
    const [l] = buildWhatsAppMessages(
      [{ type: "links", links: [{ label: "交易", url: "https://internal.pathors.com/dashboard/transactions" }] }],
      "zh-TW",
    );
    expect((l.payload.text as { body: string }).body).toBe("交易：https://internal.pathors.com/dashboard/transactions");
    const [d] = buildWhatsAppMessages(
      [
        {
          type: "done",
          receipts: [
            {
              title: "已記帳",
              rows: [{ label: "金額", value: "TWD 1,860" }],
              link: { label: "在 internal 查看", url: "https://internal.pathors.com/dashboard/transactions?ids=9" },
            },
          ],
        },
      ],
      "zh-TW",
    );
    expect((d.payload.text as { body: string }).body).toBe(
      "已記帳\n金額：TWD 1,860\n在 internal 查看：https://internal.pathors.com/dashboard/transactions?ids=9",
    );
  });

  test("send 記下 messages[0].id；media 下載兩段", async () => {
    const calls: string[] = [];
    let n = 0;
    const a = createWhatsAppAdapter(cfg, async (url, init) => {
      calls.push(`${init?.method ?? "GET"} ${url}`);
      if (url.endsWith("/messages")) return Response.json({ messaging_product: "whatsapp", messages: [{ id: `wamid.${++n}` }] });
      if (url.endsWith("/IMAGE_ID")) return Response.json({ url: "https://lookaside.fbsbx.com/x", mime_type: "image/jpeg", file_size: 3 });
      return new Response(new Uint8Array([1, 2, 3]));
    });
    const sent = await a.send("16315551181", [{ type: "text", text: "hi" }, { type: "cards", cards: [card] }]);
    expect(sent.map((s) => s.externalId)).toEqual(["wamid.1", "wamid.2"]);
    expect(sent[1].cardId).toBe("abc123defg");
    const media = await a.downloadMedia({ id: "IMAGE_ID" }, 100);
    expect(media?.bytes.byteLength).toBe(3);
    expect(media?.mime).toBe("image/jpeg");
    expect(calls.slice(-2)).toEqual([
      "GET https://graph.facebook.com/v23.0/IMAGE_ID",
      "GET https://lookaside.fbsbx.com/x",
    ]);
  });
});

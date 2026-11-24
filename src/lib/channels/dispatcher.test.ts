import { describe, expect, test } from "bun:test";
import type { ChatBufferRow, ChatCardRow, ChatIdentityRow, ChatMessageRefRow, InboxDocumentRow } from "@/db/chat";
import type { RunTurnParams } from "@/lib/ai/turn";
import type { ChatEvent } from "@/lib/ai/types";
import {
  FLUSH_DELAY_MEDIA_S,
  FLUSH_DELAY_TEXT_S,
  FLUSH_RETRY_S,
  handleEvent,
  handleFlush,
  processJob,
  type DispatcherDeps,
} from "./dispatcher";
import type { ChannelAdapter, ChannelJob, InboundEvent, OutboundMessage } from "./types";

// 記憶體裡的假 DB、假平台、假 runTurn：跑 dispatcher 不碰網路、資料庫、STORAGE、模型。

type Turn = Omit<RunTurnParams, "deps">;

function world(opts: { linked?: boolean; orgs?: { id: string; name: string; role: string }[]; turnEvents?: ChatEvent[][] } = {}) {
  const orgs = opts.orgs ?? [{ id: "org-1", name: "派斯科技", role: "member" }];
  const identities: ChatIdentityRow[] = [];
  const buffer: ChatBufferRow[] = [];
  const cards: ChatCardRow[] = [];
  const refs: ChatMessageRefRow[] = [];
  const docs: InboxDocumentRow[] = [];
  const stored: { key: string; size: number; mime: string }[] = [];
  const sent: { to: string; msgs: OutboundMessage[]; replyToken?: string }[] = [];
  const scheduled: { job: ChannelJob; delay: number }[] = [];
  const turns: Turn[] = [];
  const downloads: string[] = [];
  const left: string[] = [];
  const typing: string[] = [];
  let busy = false;
  let clock = Date.parse("2026-11-25T10:00:00Z");
  let nextId = 1;
  let sentId = 1;
  let cardSeq = 1;
  const turnEvents = [...(opts.turnEvents ?? [])];
  const codes = new Map<string, { userId: string; orgId: string; expired?: boolean; used?: boolean }>();
  const iso = () => new Date(++clock).toISOString();

  const identity = (id: string): ChatIdentityRow => ({
    id,
    provider: "line",
    externalId: `U-${id}`,
    userId: `user-${id}`,
    activeOrgId: orgs[0]?.id ?? null,
    displayName: null,
    busyUntil: null,
    createdAt: iso(),
    lastSeenAt: iso(),
  });
  if (opts.linked !== false) identities.push(identity("me"));
  identities.push(identity("other"));

  const adapter: ChannelAdapter = {
    provider: "line",
    verify: async () => true,
    parse: () => [],
    downloadMedia: async (media) => {
      downloads.push(media.id);
      return { bytes: new Uint8Array(100), mime: media.mime ?? "image/jpeg", ...(media.fileName ? { fileName: media.fileName } : {}) };
    },
    send: async (to, msgs, o) => {
      sent.push({ to, msgs, ...(o?.replyToken ? { replyToken: o.replyToken } : {}) });
      return msgs.map((m) => ({
        externalId: `out-${sentId++}`,
        snippet: m.type === "text" ? m.text : m.type === "cards" ? m.cards.map((c) => c.title).join(" / ") : m.text,
        ...(m.type === "cards" ? { cardId: m.cards[0].cardId } : {}),
      }));
    },
    showTyping: async (to) => {
      typing.push(to);
    },
    leaveGroup: async (g) => {
      left.push(g.id);
    },
  };

  const deps: DispatcherDeps = {
    adapter: () => adapter,
    db: {
      findChatIdentity: async (_p, ext) => identities.find((i) => i.externalId === ext) ?? null,
      getChatIdentity: async (id) => identities.find((i) => i.id === id) ?? null,
      touchChatIdentity: async () => {},
      setChatIdentityOrg: async (id, orgId) => {
        const i = identities.find((x) => x.id === id);
        if (i) i.activeOrgId = orgId;
      },
      deleteChatIdentity: async (id) => {
        const idx = identities.findIndex((i) => i.id === id);
        if (idx >= 0) identities.splice(idx, 1);
        return idx >= 0;
      },
      redeemChatLinkCode: async ({ code, externalId }) => {
        const c = codes.get(code);
        if (!c) return { ok: false, reason: "invalid" };
        if (c.used) return { ok: false, reason: "used" };
        if (c.expired) return { ok: false, reason: "expired" };
        c.used = true;
        const row: ChatIdentityRow = { ...identity("new"), externalId, userId: c.userId, activeOrgId: c.orgId };
        identities.push(row);
        return { ok: true, identity: row, orgId: c.orgId };
      },
      tryAcquireChatBusy: async () => {
        if (busy) return false;
        busy = true;
        return true;
      },
      releaseChatBusy: async () => {
        busy = false;
      },
      appendChatBuffer: async (input) => {
        const row: ChatBufferRow = {
          id: nextId++,
          identityId: input.identityId,
          provider: input.provider,
          externalMessageId: input.externalMessageId ?? null,
          kind: input.kind,
          text: input.text ?? null,
          documentId: input.documentId ?? null,
          quotedExternalId: input.quotedExternalId ?? null,
          receivedAt: iso(),
          consumedAt: null,
        };
        buffer.push(row);
        return row;
      },
      latestPendingBufferAt: async (id) => buffer.filter((r) => r.identityId === id && !r.consumedAt).at(-1)?.receivedAt ?? null,
      peekChatBuffer: async (id) => buffer.filter((r) => r.identityId === id && !r.consumedAt),
      markChatBufferConsumed: async (ids) => {
        for (const r of buffer) if (ids.includes(r.id)) r.consumedAt = iso();
      },
      createChatCard: async (input) => {
        const row: ChatCardRow = {
          id: `card${String(cardSeq++).padStart(6, "0")}`,
          identityId: input.identityId,
          conversationId: input.conversationId,
          toolCallIds: input.toolCallIds,
          status: "open",
          createdAt: iso(),
          expiresAt: new Date(clock + 86_400_000).toISOString(),
        };
        cards.push(row);
        return row;
      },
      getChatCard: async (id) => cards.find((c) => c.id === id) ?? null,
      closeChatCard: async (id, status = "done") => {
        const c = cards.find((x) => x.id === id && x.status === "open");
        if (!c) return false;
        c.status = status;
        return true;
      },
      listOpenChatCards: async (id) => cards.filter((c) => c.identityId === id && c.status === "open"),
      recordChatMessageRef: async (input) => {
        if (refs.some((r) => r.externalMessageId === input.externalMessageId)) return;
        refs.push({
          provider: input.provider,
          externalMessageId: input.externalMessageId,
          identityId: input.identityId,
          conversationId: input.conversationId ?? null,
          direction: input.direction,
          aiMessageId: null,
          documentId: input.documentId ?? null,
          cardId: input.cardId ?? null,
          snippet: input.snippet ?? null,
          createdAt: iso(),
        });
      },
      getChatMessageRef: async (_p, ext, identityId) =>
        refs.find((r) => r.externalMessageId === ext && r.identityId === identityId) ?? null,
      createInboxDocument: async (input) => {
        const row: InboxDocumentRow = {
          id: 100 + docs.length,
          organizationId: input.orgId,
          r2Key: input.r2Key,
          fileName: input.fileName,
          contentType: input.contentType,
          sizeBytes: input.sizeBytes,
          uploadedBy: input.uploadedBy,
          source: input.source,
          uploadedAt: iso(),
        };
        docs.push(row);
        return row;
      },
      getOrgDocuments: async (orgId, ids) => docs.filter((d) => d.organizationId === orgId && ids.includes(d.id)),
    },
    directory: {
      getOrgName: async (id) => orgs.find((o) => o.id === id)?.name ?? null,
      getUserName: async (id) => (id === "user-me" ? "Tiger" : id),
      listUserOrgs: async () => orgs.map(({ id, name }) => ({ id, name })),
    },
    getOrgRole: async (orgId) => orgs.find((o) => o.id === orgId)?.role ?? null,
    putObject: async (key, body, mime) => {
      stored.push({ key, size: body.byteLength, mime });
    },
    runTurn: async (p) => {
      turns.push(p);
      for (const e of turnEvents.shift() ?? [{ t: "msg", id: "r0" }, { t: "text", d: "好的" }]) p.emit(e as ChatEvent);
      return { conversationId: p.conversationId ?? "conv-1", title: "t", isNew: !p.conversationId };
    },
    schedule: async (job, delay) => {
      scheduled.push({ job, delay });
    },
    baseUrl: "https://internal.pathors.com",
    sleep: async () => {},
    newId: () => "uuid",
  };

  /** 把排好的 flush 依序跑完（測試裡就是「等安靜幾秒」）。 */
  async function runScheduled() {
    while (scheduled.length > 0) {
      const { job } = scheduled.shift()!;
      await processJob(job, deps);
    }
  }

  return {
    deps, identities, buffer, cards, refs, docs, stored, sent, scheduled, turns, downloads, left, typing, codes,
    runScheduled,
    setBusy: (b: boolean) => {
      busy = b;
    },
    lastText: () => {
      const m = sent.at(-1)?.msgs.find((x) => x.type === "text" || x.type === "orgPicker");
      return m && (m.type === "text" || m.type === "orgPicker") ? m.text : "";
    },
  };
}

let seq = 0;
function ev(payload: Partial<InboundEvent> & Pick<InboundEvent, "kind">, user = "U-me"): InboundEvent {
  seq += 1;
  return {
    provider: "line",
    eventId: `ev-${seq}`,
    messageId: `m-${seq}`,
    externalUserId: user,
    isGroup: false,
    replyToken: `rt-${seq}`,
    receivedAt: Date.now(),
    ...payload,
  } as InboundEvent;
}

describe("未綁定", () => {
  test("一般訊息只回綁定說明，不呼叫 AI、不下載檔案", async () => {
    const w = world({ linked: false });
    await handleEvent(ev({ kind: "text", text: "幫我記帳" }, "U-stranger"), w.deps);
    await handleEvent(ev({ kind: "media", media: { id: "img-1" } }, "U-stranger"), w.deps);
    expect(w.turns.length).toBe(0);
    expect(w.downloads.length).toBe(0);
    expect(w.buffer.length).toBe(0);
    expect(w.lastText()).toContain("https://internal.pathors.com/dashboard/settings/chat");
  });

  test("綁定成功：兩邊都知道是誰、哪個組織", async () => {
    const w = world({ linked: false });
    w.codes.set("482913", { userId: "user-me", orgId: "org-1" });
    await handleEvent(ev({ kind: "text", text: "綁定　482913" }, "U-new"), w.deps);
    expect(w.identities.some((i) => i.externalId === "U-new" && i.userId === "user-me")).toBe(true);
    expect(w.lastText()).toBe("已綁定 Tiger · 派斯科技。直接傳收據照片或打字問我；傳「說明」看我能做什麼。");
    expect(w.sent.at(-1)?.replyToken).toBeDefined();
  });

  test("過期碼、用過的碼", async () => {
    const w = world({ linked: false });
    w.codes.set("111111", { userId: "user-me", orgId: "org-1", expired: true });
    await handleEvent(ev({ kind: "text", text: "綁定111111" }, "U-new"), w.deps);
    expect(w.lastText()).toContain("過期");
    w.codes.set("222222", { userId: "user-me", orgId: "org-1", used: true });
    await handleEvent(ev({ kind: "text", text: "綁定 222222" }, "U-new"), w.deps);
    expect(w.lastText()).toContain("用過");
    await handleEvent(ev({ kind: "text", text: "綁定 999999" }, "U-new"), w.deps);
    expect(w.lastText()).toContain("不對");
  });
});

describe("群組", () => {
  test("回請私訊我並離開，不碰綁定", async () => {
    const w = world();
    await handleEvent(ev({ kind: "text", text: "hi", isGroup: true, group: { id: "C1", type: "group" } }), w.deps);
    expect(w.lastText()).toContain("請私訊我");
    expect(w.left).toEqual(["C1"]);
    expect(w.buffer.length).toBe(0);
  });
});

describe("合成一題", () => {
  test("文字先進暫存區，等 4 秒；照片等 10 秒；安靜後合成一題", async () => {
    const w = world();
    await handleEvent(ev({ kind: "media", media: { id: "img-1", mime: "image/jpeg" } }), w.deps);
    await handleEvent(ev({ kind: "text", text: "先墊的" }), w.deps);
    await handleEvent(ev({ kind: "text", text: "跟客戶吃飯" }), w.deps);
    expect(w.turns.length).toBe(0);
    expect(w.scheduled.map((s) => s.delay)).toEqual([FLUSH_DELAY_MEDIA_S, FLUSH_DELAY_TEXT_S, FLUSH_DELAY_TEXT_S]);

    // 檔案進收件匣：存 STORAGE chat/<orgId>/…、建 document（source line、uploaded_by 本人）。
    expect(w.stored).toEqual([{ key: "chat/org-1/uuid-line-img-1.jpg", size: 100, mime: "image/jpeg" }]);
    expect(w.docs[0]).toMatchObject({ organizationId: "org-1", source: "line", uploadedBy: "user-me" });

    await w.runScheduled();
    // 前兩次 flush 看到後面還有新訊息就結束，只有最後一次真的跑。
    expect(w.turns.length).toBe(1);
    const t = w.turns[0];
    expect(t.message).toBe("先墊的\n跟客戶吃飯");
    expect(t.attachments).toEqual([{ documentId: 100, fileName: "line-img-1.jpg", contentType: "image/jpeg" }]);
    expect(t.channel).toBe("line");
    expect(t.role).toBe("member");
    expect(t.owner).toEqual({ orgId: "org-1", userId: "user-me" });
    expect(w.buffer.every((r) => r.consumedAt)).toBe(true);
    expect(w.lastText()).toBe("好的");
  });

  test("搶不到鎖：5 秒後重排，不跑 AI", async () => {
    const w = world();
    await handleEvent(ev({ kind: "text", text: "查一下" }), w.deps);
    w.setBusy(true);
    const { job } = w.scheduled.shift()!;
    await handleFlush(job as Extract<ChannelJob, { kind: "flush" }>, w.deps);
    expect(w.turns.length).toBe(0);
    expect(w.scheduled[0]).toMatchObject({ delay: FLUSH_RETRY_S, job: { attempt: 1 } });
  });

  test("不支援的檔案、不支援的訊息", async () => {
    const w = world();
    await handleEvent(ev({ kind: "media", media: { id: "v", mime: "video/mp4" } }), w.deps);
    expect(w.lastText()).toContain("照片和 PDF");
    expect(w.downloads.length).toBe(0);
    await handleEvent(ev({ kind: "unsupported", what: "sticker" }), w.deps);
    expect(w.lastText()).toContain("看得懂文字、照片和 PDF");
  });

  test("檔案下載失敗：回一句話、不進暫存區，但記下這則訊息（之後引用得到）", async () => {
    const w = world();
    const real = w.deps.adapter("line")!;
    w.deps.adapter = () => ({
      ...real,
      downloadMedia: async () => {
        throw new Error("LINE API 401");
      },
    });
    const e = ev({ kind: "media", media: { id: "img-x", mime: "image/jpeg" } });
    await handleEvent(e, w.deps);
    expect(w.lastText()).toContain("下載失敗");
    expect(w.buffer.length).toBe(0);
    expect(w.scheduled.length).toBe(0);
    expect(w.refs.some((r) => r.direction === "in" && r.externalMessageId === e.messageId)).toBe(true);
  });

  test("回覆的 [[選項：…]] 變成 quick reply", async () => {
    const w = world({ turnEvents: [[{ t: "msg", id: "r0" }, { t: "text", d: "誰付的？\n[[選項：我先墊的|公司信用卡]]" }]] });
    await handleEvent(ev({ kind: "text", text: "計程車 240" }), w.deps);
    await w.runScheduled();
    const m = w.sent.at(-1)!.msgs[0];
    expect(m).toEqual({
      type: "text",
      text: "誰付的？",
      quickReplies: [
        { label: "我先墊的", text: "我先墊的" },
        { label: "公司信用卡", text: "公司信用卡" },
      ],
    });
  });
});

describe("指令", () => {
  test("切換組織：選單 → 按下去換組織", async () => {
    const w = world({
      orgs: [
        { id: "org-1", name: "派斯科技", role: "owner" },
        { id: "org-2", name: "東蜂科技", role: "member" },
      ],
    });
    await handleEvent(ev({ kind: "text", text: "切換組織" }), w.deps);
    await w.runScheduled();
    expect(w.turns.length).toBe(0);
    const picker = w.sent.at(-1)!.msgs[0];
    expect(picker).toMatchObject({ type: "orgPicker", orgs: [{ id: "org-1", current: true }, { id: "org-2" }] });

    await handleEvent(ev({ kind: "button", payload: "o:org-2" }), w.deps);
    expect(w.identities.find((i) => i.id === "me")?.activeOrgId).toBe("org-2");
    expect(w.lastText()).toBe("已切換到 東蜂科技。");

    await handleEvent(ev({ kind: "button", payload: "o:org-9" }), w.deps);
    expect(w.identities.find((i) => i.id === "me")?.activeOrgId).toBe("org-2");
  });

  test("新對話：下一題強制開新對話", async () => {
    const w = world();
    await handleEvent(ev({ kind: "text", text: "新對話" }), w.deps);
    await w.runScheduled();
    expect(w.lastText()).toBe("好，開一段新對話。");
    await handleEvent(ev({ kind: "text", text: "查應收" }), w.deps);
    await w.runScheduled();
    expect(w.turns[0]).toMatchObject({ message: "查應收", forceNewConversation: true });
  });

  test("不在組織了：不跑 AI，回選單", async () => {
    const w = world();
    w.identities[0].activeOrgId = "org-gone";
    await handleEvent(ev({ kind: "text", text: "查應收" }), w.deps);
    await w.runScheduled();
    expect(w.turns.length).toBe(0);
    expect(w.lastText()).toContain("你已不在這個組織");
  });
});

const pendingTurn: ChatEvent[] = [
  { t: "conv", id: "conv-1", title: "x" },
  { t: "msg", id: "r0" },
  { t: "text", d: "請確認" },
  {
    t: "tool",
    call: {
      id: "call-1",
      name: "submit_advance",
      status: "pending",
      level: "write",
      summary: "提交代墊 11/24 NT$1,860",
      args: { amount: 1860, currency: "TWD" },
      ruleHint: "依規則：餐廳 → 交際費",
    },
  },
];

async function withCard(turnEvents: ChatEvent[][] = []) {
  const w = world({ turnEvents: [pendingTurn, ...turnEvents] });
  await handleEvent(ev({ kind: "text", text: "先墊的 1860" }), w.deps);
  await w.runScheduled();
  return w;
}

describe("確認卡", () => {
  test("待確認的寫入變成卡片，建 chat_cards、記送出的訊息", async () => {
    const w = await withCard();
    expect(w.cards).toEqual([expect.objectContaining({ id: "card000001", toolCallIds: ["call-1"], conversationId: "conv-1" })]);
    const cardsMsg = w.sent.at(-1)!.msgs.find((m) => m.type === "cards");
    expect(cardsMsg).toMatchObject({
      cards: [{ cardId: "card000001", orgName: "派斯科技", actorName: "Tiger", ruleHint: "依規則：餐廳 → 交際費" }],
    });
    expect(w.refs.some((r) => r.direction === "out" && r.cardId === "card000001")).toBe(true);
  });

  test("卡片上的分類顯示名稱，不是 id；查不到就保留 id", async () => {
    const withCategory: ChatEvent[] = pendingTurn.map((e) =>
      e.t === "tool" ? { ...e, call: { ...e.call, args: { amount: 415, categoryId: 12 } } } : e,
    );
    const w = world({ turnEvents: [withCategory, withCategory] });
    w.deps.directory.getCategoryName = async (orgId, id) => (orgId === "org-1" && id === 12 ? "雜項支出" : null);
    await handleEvent(ev({ kind: "text", text: "記一筆" }), w.deps);
    await w.runScheduled();
    const rows = () => {
      const m = w.sent.at(-1)!.msgs.find((x) => x.type === "cards");
      return m && m.type === "cards" ? m.cards[0].rows : [];
    };
    expect(rows()).toContainEqual({ label: "分類", value: "雜項支出" });

    w.deps.directory.getCategoryName = async () => null;
    await handleEvent(ev({ kind: "text", text: "再一筆" }), w.deps);
    await w.runScheduled();
    expect(rows()).toContainEqual({ label: "分類", value: "12" });
  });

  test("按確認：用 runTurn 回覆那張卡", async () => {
    const w = await withCard([[{ t: "tool_done", id: "call-1", status: "ok" }, { t: "msg", id: "r1" }, { t: "text", d: "已提交" }]]);
    await handleEvent(ev({ kind: "button", payload: "c:card000001:confirm" }), w.deps);
    expect(w.turns[1]).toMatchObject({ conversationId: "conv-1", confirm: { toolCallId: "call-1", approve: true } });
    expect(w.cards[0].status).toBe("done");
    expect(w.lastText()).toBe("已提交");

    // 同一張卡再按一次：不再執行。
    await handleEvent(ev({ kind: "button", payload: "c:card000001:confirm" }), w.deps);
    expect(w.turns.length).toBe(2);
    expect(w.lastText()).toContain("已過期或已經處理過");
  });

  test("別人按這張卡被擋", async () => {
    const w = await withCard();
    await handleEvent(ev({ kind: "button", payload: "c:card000001:confirm" }, "U-other"), w.deps);
    expect(w.turns.length).toBe(1);
    expect(w.lastText()).toContain("不是你開的");
    expect(w.cards[0].status).toBe("open");
  });

  test("修改：取消那張卡並問要改哪裡", async () => {
    const w = await withCard([[{ t: "tool_done", id: "call-1", status: "cancelled" }]]);
    await handleEvent(ev({ kind: "button", payload: "c:card000001:edit" }), w.deps);
    expect(w.turns[1]).toMatchObject({ confirm: { toolCallId: "call-1", approve: false } });
    expect(w.lastText()).toBe("要改哪裡？直接打字告訴我。");
  });

  test("三張以上多一張全部確認，按下去逐張確認", async () => {
    const three: ChatEvent[] = [1, 2, 3].map((i) => ({
      t: "tool",
      call: { id: `call-${i}`, name: "create_transaction", status: "pending", level: "write", args: {} },
    }));
    const w = world({ turnEvents: [three, [], [], []] });
    await handleEvent(ev({ kind: "text", text: "記這三張" }), w.deps);
    await w.runScheduled();
    const cardsMsg = w.sent.at(-1)!.msgs.find((m) => m.type === "cards");
    expect(cardsMsg?.type === "cards" && cardsMsg.cards.map((c) => c.actions)).toEqual([
      ["confirm", "edit", "cancel"],
      ["confirm", "edit", "cancel"],
      ["confirm", "edit", "cancel"],
      ["all"],
    ]);
    await handleEvent(ev({ kind: "button", payload: "c:card000004:all" }), w.deps);
    expect(w.turns.slice(1).map((t) => t.confirm)).toEqual([
      { toolCallId: "call-1", approve: true },
      { toolCallId: "call-2", approve: true },
      { toolCallId: "call-3", approve: true },
    ]);
    expect(w.cards.every((c) => c.status === "done")).toBe(true);
  });

  test("問新的一題時，舊卡收掉", async () => {
    const w = await withCard();
    await handleEvent(ev({ kind: "text", text: "算了，查應收" }), w.deps);
    await w.runScheduled();
    expect(w.cards[0].status).toBe("done");
    await handleEvent(ev({ kind: "button", payload: "c:card000001:confirm" }), w.deps);
    expect(w.turns.length).toBe(2);
    expect(w.lastText()).toContain("已過期或已經處理過");
  });
});

describe("引用", () => {
  test("引用文字：被引用的那則放最前面", async () => {
    const w = world();
    const first = ev({ kind: "text", text: "11/24 計程車 240" });
    await handleEvent(first, w.deps);
    await w.runScheduled();
    await handleEvent(ev({ kind: "text", text: "這是代墊", quotedMessageId: first.messageId }), w.deps);
    await w.runScheduled();
    expect(w.turns[1].message).toBe("（回覆先前的訊息：「11/24 計程車 240」）\n這是代墊");
  });

  test("引用照片：那個檔案重新帶進這題", async () => {
    const w = world();
    const photo = ev({ kind: "media", media: { id: "img-9", mime: "image/png" } });
    await handleEvent(photo, w.deps);
    await w.runScheduled();
    await handleEvent(ev({ kind: "text", text: "這張是代墊", quotedMessageId: photo.messageId }), w.deps);
    await w.runScheduled();
    expect(w.turns[1].attachments).toEqual([{ documentId: 100, fileName: "line-img-9.png", contentType: "image/png" }]);
    expect(w.turns[1].message).toStartWith("（回覆先前傳的檔案：");
  });

  test("引用還開著的確認卡：當成修改，舊卡收掉", async () => {
    const w = await withCard();
    const cardRef = w.refs.find((r) => r.cardId === "card000001")!;
    await handleEvent(ev({ kind: "text", text: "分類改差旅", quotedMessageId: cardRef.externalMessageId }), w.deps);
    await w.runScheduled();
    expect(w.cards[0].status).toBe("done");
    expect(w.turns[1].message).toStartWith("（修改先前的確認卡：");
    expect(w.turns[1].message).toEndWith("分類改差旅");
  });

  test("引用找不到的舊訊息", async () => {
    const w = world();
    await handleEvent(ev({ kind: "text", text: "這筆呢", quotedMessageId: "ancient" }), w.deps);
    await w.runScheduled();
    expect(w.turns[0].message).toBe("（回覆了一則找不到的舊訊息）\n這筆呢");
  });
});

import { describe, expect, test } from "bun:test";
import type { AiConversationRow, AiMessageRow } from "@/db/ai";
import type { EngineDeps } from "./engine";
import type { ChatMessage, ModelTurn } from "./openrouter";
import type { RuleLike } from "./rules";
import { CHAT_IDLE_MS, runTurn, TurnNotFoundError, type RunTurnParams, type TurnDeps } from "./turn";
import type { ChatChannel, ChatEvent } from "./types";

// 記憶體裡的假 DB、假模型、假工具、假附件：跑 runTurn 不碰網路、資料庫、STORAGE。
function fakeWorld(turns: ModelTurn[], opts: { rules?: RuleLike[]; hasEmployee?: boolean; now?: Date } = {}) {
  const conversations: (AiConversationRow & { orgId: string; userId: string })[] = [];
  const rows = new Map<string, AiMessageRow[]>();
  let nextId = 1;
  const ran: { name: string; args: Record<string, unknown>; channel?: string; ctxChannel?: string }[] = [];
  const modelCalls: { messages: ChatMessage[]; tools: string[] }[] = [];
  const applied: number[][] = [];
  const readRequests: number[][] = [];
  const now = opts.now ?? new Date("2026-11-25T10:00:00Z");
  const list = (c: string) => rows.get(c) ?? [];

  const engine: EngineDeps = {
    db: {
      listAiMessages: async (c) => list(c).map((r) => ({ ...r })),
      insertAiMessage: async (c, m) => {
        const id = nextId++;
        rows.set(c, [
          ...list(c),
          {
            id,
            role: m.role,
            content: m.content ?? null,
            toolCalls: m.toolCalls ?? null,
            toolCallId: m.toolCallId ?? null,
            toolName: m.toolName ?? null,
            status: m.status ?? null,
            attachments: m.attachments ?? null,
            createdAt: now.toISOString(),
          },
        ]);
        return id;
      },
      touchAiConversation: async (_o, id) => {
        const conv = conversations.find((c) => c.id === id);
        if (conv) conv.updatedAt = now.toISOString();
      },
      resolvePendingToolMessage: async (c, id, status, content) => {
        const r = list(c).find((x) => x.toolCallId === id && x.status === "pending");
        if (!r) return false;
        r.status = status;
        r.content = content;
        return true;
      },
      claimPendingToolMessage: async (c, id) => {
        const r = list(c).find((x) => x.toolCallId === id && x.status === "pending");
        if (!r) return false;
        r.status = "ok";
        return true;
      },
      setToolMessageResult: async (c, id, status, content) => {
        const r = list(c).find((x) => x.toolCallId === id && x.role === "tool");
        if (r) {
          r.status = status;
          r.content = content;
        }
      },
    },
    runTool: async (name, args, ctx, channel) => {
      ran.push({ name, args, channel, ctxChannel: ctx.channel });
      return { ok: true, out: { id: 42 } };
    },
    model: async ({ messages, tools, onText }) => {
      modelCalls.push({ messages, tools: tools.map((t) => t.function.name) });
      const turn = turns.shift();
      if (!turn) throw new Error("model called too many times");
      if (turn.content) onText(turn.content);
      return turn;
    },
    readAttachments: async (_orgId, refs) => {
      readRequests.push(refs.map((r) => r.documentId));
      return new Map(refs.map((r) => [r.documentId, { type: "image_url" as const, image_url: { url: "data:image/jpeg;base64,AAAA" } }]));
    },
    markRulesApplied: async (ids) => {
      applied.push(ids);
    },
  };

  const deps: TurnDeps = {
    engine,
    conversations: {
      getAiConversation: async (owner, id) =>
        conversations.find((c) => c.id === id && c.orgId === owner.orgId && c.userId === owner.userId) ?? null,
      createAiConversation: async (owner, title, channel: ChatChannel = "web") => {
        const conv = {
          id: `conv${conversations.length + 1}`,
          title,
          toolGroups: [],
          channel,
          updatedAt: now.toISOString(),
          orgId: owner.orgId,
          userId: owner.userId,
        };
        conversations.push(conv);
        return conv;
      },
      findRecentAiConversation: async (owner, channel, since) =>
        conversations
          .filter((c) => c.orgId === owner.orgId && c.userId === owner.userId && c.channel === channel)
          .filter((c) => Date.parse(c.updatedAt) > since.getTime())
          .at(-1) ?? null,
      listAiMessages: async (c) => list(c).map((r) => ({ ...r })),
    },
    listRules: async () => opts.rules ?? [],
    hasEmployee: async () => opts.hasEmployee ?? true,
    now: () => now,
  };

  const events: ChatEvent[] = [];
  const params = (p: Partial<RunTurnParams>): RunTurnParams => ({
    owner: { orgId: "org_1", userId: "u_1" },
    role: "member",
    channel: "line",
    locale: "zh-TW",
    orgName: "派斯科技",
    userName: "Tiger",
    emit: (e) => events.push(e),
    deps,
    ...p,
  });
  return { conversations, rows, ran, modelCalls, applied, readRequests, events, params, deps };
}

const turn = (content: string, calls: [id: string, name: string, args: object][] = []): ModelTurn => ({
  content,
  toolCalls: calls.map(([id, name, args]) => ({ id, name, arguments: JSON.stringify(args) })),
  inputTokens: 10,
  outputTokens: 5,
});

const gwsRule: RuleLike = {
  id: 3,
  scope: "org",
  userId: null,
  kind: "category",
  match: { partyContains: "Google Workspace" },
  action: { categoryId: 7, categoryName: "軟體工具" },
  text: "以後 Google Workspace 都歸軟體工具",
};

describe("runTurn", () => {
  test("a chat question: new LINE conversation, photo read, member advance stops at a card with a rule hint", async () => {
    const w = fakeWorld(
      [
        turn("", [["r1", "list_categories", {}]]),
        turn("確認一下", [
          [
            "w1",
            "submit_advance",
            { date: "2026-11-22", amount: 3000, partyName: "Google Workspace", description: "月費", documentIds: [12], confirmSummary: "提交代墊 NT$3,000" },
          ],
        ]),
      ],
      { rules: [gwsRule] },
    );
    const res = await runTurn(
      w.params({ message: "", attachments: [{ documentId: 12, fileName: "r.jpg", contentType: "image/jpeg" }] }),
    );
    expect(res).toEqual({ conversationId: "conv1", title: "附件", isNew: true });
    expect(w.conversations[0].channel).toBe("line");
    expect(w.events[0]).toEqual({ t: "conv", id: "conv1", title: "附件" });

    // user 訊息存了附件；模型收到文字佔位＋圖片本身；有附件一定帶帳務組
    const stored = w.rows.get("conv1")!;
    expect(stored[0]).toMatchObject({ role: "user", content: "", attachments: [{ documentId: 12 }] });
    expect(w.readRequests).toEqual([[12]]); // 兩輪只讀一次
    const userMsg = w.modelCalls[0].messages[1];
    expect(Array.isArray(userMsg.content)).toBe(true);
    expect((userMsg.content as { type: string }[]).map((p) => p.type)).toEqual(["text", "image_url"]);
    expect(w.modelCalls[0].tools).toContain("submit_advance");
    expect(w.modelCalls[0].tools).not.toContain("create_transaction"); // 成員
    expect(w.modelCalls[0].tools).not.toContain("delete_transaction");

    // system prompt：聊天段落、使用者、規則
    const system = w.modelCalls[0].messages[0].content as string;
    expect(system).toContain("in LINE on their phone");
    expect(system).toContain("Current user: Tiger.");
    expect(system).toContain("[org #3]");

    // 只讀立刻跑、稽核記 line；寫入停在卡片，帶規則提示
    expect(w.ran).toEqual([{ name: "list_categories", args: { organizationId: "org_1" }, channel: "line", ctxChannel: "line" }]);
    const card = w.events.find((e) => e.t === "tool" && e.call.id === "w1");
    expect(card).toMatchObject({
      call: { status: "pending", summary: "提交代墊 NT$3,000", ruleHint: "依規則：Google Workspace → 軟體工具" },
    });
    expect(stored.find((r) => r.toolCallId === "w1")).toMatchObject({
      status: "pending",
      content: JSON.stringify({ ruleHint: "依規則：Google Workspace → 軟體工具" }),
    });
  });

  test("confirming a card runs it once on the chat channel and counts the rule only when its category was used", async () => {
    const w = fakeWorld(
      [
        turn("", [
          ["w1", "create_transaction", { type: "expense", txnDate: "2026-11-22", amount: 3000, accountId: 1, partyName: "Google Workspace", categoryId: 7, confirmSummary: "新增支出" }],
        ]),
        turn("已記帳"),
      ],
      { rules: [gwsRule] },
    );
    const first = await runTurn(w.params({ role: "owner", channel: "whatsapp", message: "記一筆 Google Workspace 3000" }));
    // 分類已經是規則的那個：不需要提示
    const card = w.events.find((e) => e.t === "tool" && e.call.id === "w1");
    expect(card && "call" in card ? card.call.ruleHint : "x").toBeUndefined();

    const second = await runTurn(
      w.params({ role: "owner", channel: "whatsapp", conversationId: first.conversationId, confirm: { toolCallId: "w1", approve: true } }),
    );
    expect(second).toEqual({ conversationId: first.conversationId, title: "記一筆 Google Workspace 3000", isNew: false });
    expect(w.ran.map((r) => [r.name, r.channel])).toEqual([["create_transaction", "whatsapp"]]);
    expect(w.applied).toEqual([[3]]);
    expect(w.rows.get(first.conversationId)!.at(-1)?.content).toBe("已記帳");
  });

  test("chat reuses the recent conversation, the new-conversation command and idle time start a new one", async () => {
    const w = fakeWorld([turn("1"), turn("2"), turn("3"), turn("4")]);
    const a = await runTurn(w.params({ message: "第一題" }));
    const b = await runTurn(w.params({ message: "第二題" }));
    expect(b).toMatchObject({ conversationId: a.conversationId, isNew: false });
    const c = await runTurn(w.params({ message: "新對話後", forceNewConversation: true }));
    expect(c.isNew).toBe(true);
    expect(c.conversationId).not.toBe(a.conversationId);
    // 閒置超過 6 小時
    for (const conv of w.conversations) {
      conv.updatedAt = new Date(Date.parse("2026-11-25T10:00:00Z") - CHAT_IDLE_MS - 1).toISOString();
    }
    const d = await runTurn(w.params({ message: "隔天" }));
    expect(d.isNew).toBe(true);
    expect(w.conversations.map((x) => x.channel)).toEqual(["line", "line", "line"]);
  });

  test("the web always starts a new conversation without an id, and an unknown id throws before any event", async () => {
    const w = fakeWorld([turn("a"), turn("b")]);
    const a = await runTurn(w.params({ channel: "web", message: "q1", page: "/dashboard/transactions" }));
    const b = await runTurn(w.params({ channel: "web", message: "q2" }));
    expect(a.conversationId).not.toBe(b.conversationId);
    expect(w.modelCalls[0].messages[0].content).toContain("/dashboard/transactions");
    expect(w.modelCalls[0].messages[0].content).not.toContain("on their phone");
    const before = w.events.length;
    await expect(runTurn(w.params({ channel: "web", conversationId: "nope", message: "x" }))).rejects.toBeInstanceOf(
      TurnNotFoundError,
    );
    await expect(runTurn(w.params({ confirm: { toolCallId: "x", approve: true } }))).rejects.toBeInstanceOf(TurnNotFoundError);
    expect(w.events.length).toBe(before);
  });

  test("red-level tools are refused in chat even if the model calls them", async () => {
    const w = fakeWorld([turn("", [["d1", "delete_transaction", { id: 1, confirmSummary: "刪除" }]]), turn("請到網頁刪除")]);
    await runTurn(w.params({ role: "owner", message: "刪掉交易 1" }));
    expect(w.ran).toEqual([]);
    const row = w.rows.get("conv1")!.find((r) => r.toolCallId === "d1");
    expect(row?.status).toBe("error");
    expect(row?.content).toContain("web app");
  });
});

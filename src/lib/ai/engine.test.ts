import { describe, expect, test } from "bun:test";
import type { AiMessageRow } from "@/db/ai";
import { resolveConfirmation, runModelLoop, type EngineDeps, type TurnContext } from "./engine";
import type { ModelTurn } from "./openrouter";
import type { ChatEvent } from "./types";
import { toUiMessages } from "./history";

// 一個記憶體裡的假 DB + 假模型 + 假工具，驗證迴圈的行為，不碰網路也不碰資料庫。
function harness(turns: ModelTurn[], role: string | null = "owner") {
  const rows: AiMessageRow[] = [];
  let nextId = 1;
  const ran: { name: string; args: Record<string, unknown>; channel?: string }[] = [];
  const seenTools: string[][] = [];
  const events: ChatEvent[] = [];
  const deps: EngineDeps = {
    db: {
      listAiMessages: async () => rows.map((r) => ({ ...r })),
      insertAiMessage: async (_c, m) => {
        const id = nextId++;
        rows.push({
          id,
          role: m.role,
          content: m.content ?? null,
          toolCalls: m.toolCalls ?? null,
          toolCallId: m.toolCallId ?? null,
          toolName: m.toolName ?? null,
          status: m.status ?? null,
          createdAt: new Date().toISOString(),
        });
        return id;
      },
      touchAiConversation: async () => {},
      resolvePendingToolMessage: async (_c, id, status, content) => {
        const r = rows.find((x) => x.toolCallId === id && x.status === "pending");
        if (!r) return false;
        r.status = status;
        r.content = content;
        return true;
      },
      claimPendingToolMessage: async (_c, id) => {
        const r = rows.find((x) => x.toolCallId === id && x.status === "pending");
        if (!r) return false;
        r.status = "ok";
        return true;
      },
      setToolMessageResult: async (_c, id, status, content) => {
        const r = rows.find((x) => x.toolCallId === id && x.role === "tool");
        if (r) {
          r.status = status;
          r.content = content;
        }
      },
    },
    runTool: async (name, args, _ctx, channel) => {
      ran.push({ name, args, channel });
      return { ok: true, out: { id: 42, name } };
    },
    model: async ({ tools, onText }) => {
      seenTools.push(tools.map((t) => t.function.name));
      const turn = turns.shift();
      if (!turn) throw new Error("model called too many times");
      if (turn.content) onText(turn.content);
      return turn;
    },
  };
  const ctx: TurnContext = {
    owner: { orgId: "org_1", userId: "u_1" },
    role,
    conversationId: "c1",
    toolGroups: [],
    systemPrompt: "sys",
    emit: (e) => events.push(e),
    deps,
  };
  const ask = async (q: string) => {
    await deps.db.insertAiMessage("c1", { role: "user", content: q });
    await runModelLoop(ctx, q);
  };
  return { rows, ran, events, seenTools, ctx, ask };
}

const turn = (content: string, calls: [id: string, name: string, args: object][] = []): ModelTurn => ({
  content,
  toolCalls: calls.map(([id, name, args]) => ({ id, name, arguments: JSON.stringify(args) })),
  inputTokens: 10,
  outputTokens: 5,
});

const ORGS = [
  { id: "org_1", name: "派斯科技", slug: "pathors", logo: null, role: "owner" },
  { id: "org_2", name: "東蜂科技", slug: "dongfeng", logo: null, role: "member" },
];

describe("multi-org", () => {
  test("an organizationId the user does not belong to is rejected, not silently replaced", async () => {
    const h = harness([
      turn("", [["c1", "list_transactions", { organizationId: "someone-else", limit: 5 }]]),
      turn("查不到"),
    ]);
    await h.ask("最近的交易");
    expect(h.ran).toEqual([]);
    const tool = h.rows.find((r) => r.role === "tool");
    expect(tool?.status).toBe("error");
    expect(tool?.content).toContain("not a member");
  });

  test("reads can target another org by slug; it runs with that org's id", async () => {
    const h = harness([
      turn("", [["c1", "list_contracts", { organizationId: "dongfeng" }]]),
      turn("東蜂的合約如下"),
    ]);
    h.ctx.orgs = ORGS;
    await h.ask("威澄的合約");
    expect(h.ran).toEqual([{ name: "list_contracts", args: { organizationId: "org_2" }, channel: "ai" }]);
  });

  test("writes are checked against the role in the target org", async () => {
    const h = harness([
      turn("", [["w1", "create_transaction", { amount: 1, organizationId: "dongfeng", confirmSummary: "x" }]]),
      turn("你在東蜂沒有寫入權限"),
    ]);
    h.ctx.orgs = ORGS;
    await h.ask("在東蜂記一筆");
    // 在東蜂只是 member：不出確認卡，直接回權限錯誤
    expect(h.rows.find((r) => r.role === "tool")?.status).toBe("error");
    expect(h.ran).toEqual([]);
  });

  test("the confirmation card can be re-targeted to another org before confirming", async () => {
    const orgs = [ORGS[0], { ...ORGS[1], role: "admin" }];
    const h = harness([
      turn("", [["w1", "create_transaction", { amount: 1, confirmSummary: "x" }]]),
      turn("已記在東蜂"),
    ]);
    h.ctx.orgs = orgs;
    const retargeted: string[] = [];
    h.ctx.deps.retargetToolCall = async (_c, _m, calls) => {
      retargeted.push(calls[0].arguments);
    };
    await h.ask("記一筆");
    expect(h.rows.find((r) => r.role === "tool")?.status).toBe("pending");
    await resolveConfirmation(h.ctx, "w1", true, "org_2");
    expect(h.ran).toEqual([{ name: "create_transaction", args: { amount: 1, organizationId: "org_2" }, channel: "ai" }]);
    expect(JSON.parse(retargeted[0]).organizationId).toBe("org_2");
  });

  test("re-targeting to an org the user is not in is refused", async () => {
    const h = harness([
      turn("", [["w1", "create_transaction", { amount: 1, confirmSummary: "x" }]]),
      turn("不能換到那個組織"),
    ]);
    h.ctx.orgs = ORGS;
    await h.ask("記一筆");
    await resolveConfirmation(h.ctx, "w1", true, "org_x");
    expect(h.ran).toEqual([]);
    expect(h.rows.find((r) => r.role === "tool")?.status).toBe("error");
  });
});

describe("runModelLoop", () => {
  test("read tools run immediately, in-process, defaulting to the current org", async () => {
    const h = harness([
      turn("", [["c1", "list_transactions", { limit: 5 }]]),
      turn("最近五筆交易如下"),
    ]);
    await h.ask("最近的交易");
    expect(h.ran).toEqual([
      { name: "list_transactions", args: { limit: 5, organizationId: "org_1" }, channel: "ai" },
    ]);
    expect(h.rows.map((r) => r.role)).toEqual(["user", "assistant", "tool", "assistant"]);
    expect(h.events.some((e) => e.t === "text" && e.d === "最近五筆交易如下")).toBe(true);
    // 帳務組的工具 + load_tool_groups；七支對外工具不在裡面
    expect(h.seenTools[0]).toContain("list_transactions");
    expect(h.seenTools[0]).toContain("load_tool_groups");
    expect(h.seenTools[0]).not.toContain("simpany_issue_invoice");
  });

  test("writes stop at a confirmation card and only run after approval", async () => {
    const h = harness([
      turn("", [
        ["r1", "list_categories", {}],
        ["w1", "create_transaction", { amount: 3000, confirmSummary: "新增支出 NT$3,000" }],
      ]),
      turn("已記帳"),
    ]);
    await h.ask("記一筆支出 3000");
    expect(h.ran.map((r) => r.name)).toEqual(["list_categories"]);
    const pending = h.rows.find((r) => r.toolCallId === "w1");
    expect(pending?.status).toBe("pending");
    const card = h.events.find((e) => e.t === "tool" && e.call.id === "w1");
    expect(card).toMatchObject({ call: { status: "pending", level: "write", summary: "新增支出 NT$3,000", args: { amount: 3000 } } });

    await resolveConfirmation(h.ctx, "w1", true);
    expect(h.ran.map((r) => r.name)).toEqual(["list_categories", "create_transaction"]);
    expect(h.ran[1].args).toEqual({ amount: 3000, organizationId: "org_1" });
    expect(h.rows.find((r) => r.toolCallId === "w1")?.status).toBe("ok");
    expect(h.rows.at(-1)?.content).toBe("已記帳");
    // 寫入成功的 tool_done 帶實際執行的工具、參數與那一列的 id（聊天的收據卡用）。
    const done = h.events.find((e) => e.t === "tool_done" && e.id === "w1" && e.status === "ok");
    expect(done).toMatchObject({
      done: { name: "create_transaction", args: { amount: 3000, organizationId: "org_1" }, recordId: 42 },
    });

    // 第二次按確認不會再執行
    await resolveConfirmation(h.ctx, "w1", true);
    expect(h.ran.length).toBe(2);
  });

  test("cancel does not run the write and does not call the model again", async () => {
    const h = harness([turn("", [["d1", "delete_category", { id: 3, confirmSummary: "刪除分類" }]])]);
    await h.ask("刪掉分類 3");
    const card = h.events.find((e) => e.t === "tool" && e.call.id === "d1");
    expect(card).toMatchObject({ call: { level: "danger" } });
    await resolveConfirmation(h.ctx, "d1", false);
    expect(h.ran).toEqual([]);
    expect(h.rows.find((r) => r.toolCallId === "d1")?.status).toBe("cancelled");
  });

  test("members never get write tools and writes they request are refused", async () => {
    const h = harness([turn("", [["w1", "create_transaction", { amount: 1 }]]), turn("沒有權限")], "member");
    await h.ask("記一筆");
    expect(h.seenTools[0]).not.toContain("create_transaction");
    expect(h.seenTools[0]).toContain("list_transactions");
    expect(h.ran).toEqual([]);
    expect(h.rows.find((r) => r.toolCallId === "w1")?.status).toBe("error");
  });

  test("excluded tools are refused even if the model calls them", async () => {
    const h = harness([turn("", [["x1", "simpany_issue_invoice", { draftId: "d" }]]), turn("不能開")]);
    await h.ask("開發票");
    expect(h.ran).toEqual([]);
    expect(h.rows.find((r) => r.toolCallId === "x1")?.status).toBe("error");
  });

  test("load_tool_groups adds tools for the next round", async () => {
    const h = harness([turn("", [["g1", "load_tool_groups", { groups: ["hr"] }]]), turn("好")]);
    await h.ask("hello");
    expect(h.seenTools[0]).not.toContain("list_employees");
    expect(h.seenTools[1]).toContain("list_employees");
  });

  test("history renders as one assistant bubble per question", async () => {
    const h = harness([turn("", [["c1", "list_transactions", {}]]), turn("答案")]);
    await h.ask("問題");
    const ui = toUiMessages(h.rows);
    expect(ui.map((m) => m.kind)).toEqual(["user", "assistant"]);
    expect(ui[1]).toMatchObject({ text: "答案", tools: [{ name: "list_transactions", status: "ok", level: "read" }] });
  });
});

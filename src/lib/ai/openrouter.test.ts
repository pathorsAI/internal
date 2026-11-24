import { describe, expect, test } from "bun:test";
import { sseData, streamModelTurn, TurnAccumulator } from "./openrouter";
import { toModelMessages } from "./history";
import type { AiMessageRow } from "@/db/ai";

function streamOf(text: string): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream({
    start(c) {
      // 故意切成碎片，模擬網路分段
      for (let i = 0; i < bytes.length; i += 7) c.enqueue(bytes.slice(i, i + 7));
      c.close();
    },
  });
}

describe("OpenRouter streaming", () => {
  test("parses SSE, skips comments, stops at [DONE]", async () => {
    const out: string[] = [];
    for await (const d of sseData(streamOf(": OPENROUTER PROCESSING\n\ndata: {\"a\":1}\n\ndata: {\"b\":2}\r\n\ndata: [DONE]\n\ndata: {\"c\":3}\n"))) out.push(d);
    expect(out).toEqual(['{"a":1}', '{"b":2}']);
  });

  test("joins tool-call fragments by index", () => {
    const acc = new TurnAccumulator();
    acc.push({ choices: [{ delta: { content: "好" } }] });
    acc.push({ choices: [{ delta: { tool_calls: [{ index: 0, id: "t1", function: { name: "list_", arguments: '{"li' } }] } }] });
    acc.push({ choices: [{ delta: { tool_calls: [{ index: 0, function: { name: "parties", arguments: 'mit":3}' } }] } }] });
    acc.push({ choices: [] , usage: { prompt_tokens: 100, completion_tokens: 7 } });
    expect(acc.result()).toEqual({
      content: "好",
      toolCalls: [{ id: "t1", name: "list_parties", arguments: '{"limit":3}' }],
      inputTokens: 100,
      outputTokens: 7,
    });
  });

  test("streamModelTurn sends the configured model and surfaces API errors", async () => {
    let sent: Record<string, unknown> = {};
    const ok = (async (_u: string, init: RequestInit) => {
      sent = JSON.parse(String(init.body));
      return new Response(streamOf('data: {"choices":[{"delta":{"content":"hi"}}]}\n\ndata: [DONE]\n'));
    }) as unknown as typeof fetch;
    const texts: string[] = [];
    const turn = await streamModelTurn({ apiKey: "k", messages: [], tools: [], onText: (d) => texts.push(d), fetchImpl: ok });
    expect(sent.model).toBe("openai/gpt-6-luna");
    expect(sent.stream).toBe(true);
    expect(turn.content).toBe("hi");
    expect(texts).toEqual(["hi"]);

    const bad = (async () => Response.json({ error: { message: "No credits" } }, { status: 402 })) as unknown as typeof fetch;
    await expect(streamModelTurn({ apiKey: "k", messages: [], tools: [], onText: () => {}, fetchImpl: bad })).rejects.toThrow("No credits");
  });
});

describe("toModelMessages", () => {
  const row = (p: Partial<AiMessageRow>): AiMessageRow => ({
    id: 0, role: "user", content: null, toolCalls: null, toolCallId: null, toolName: null, status: null, createdAt: "", ...p,
  });
  test("every tool call gets an answer; unconfirmed writes are reported as not executed", () => {
    const msgs = toModelMessages([
      row({ id: 1, role: "user", content: "記一筆" }),
      row({ id: 2, role: "assistant", toolCalls: [{ id: "a", name: "create_transaction", arguments: "{}" }, { id: "b", name: "list_categories", arguments: "" }] }),
      row({ id: 3, role: "tool", toolCallId: "a", status: "pending" }),
      row({ id: 4, role: "user", content: "算了" }),
    ]);
    expect(msgs.map((m) => m.role)).toEqual(["user", "assistant", "tool", "tool", "user"]);
    const tools = msgs.filter((m) => m.role === "tool") as { content: string; tool_call_id: string }[];
    expect(tools.every((t) => t.content.includes("not_confirmed"))).toBe(true);
  });
});

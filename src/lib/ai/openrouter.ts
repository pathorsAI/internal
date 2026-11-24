import { AI_MODEL, MAX_OUTPUT_TOKENS, OPENROUTER_CHAT_URL } from "./config";

/** OpenAI 相容的 chat 訊息（OpenRouter 照收）。 */
export type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | {
      role: "assistant";
      content: string | null;
      tool_calls?: {
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }[];
    }
  | { role: "tool"; tool_call_id: string; content: string };

export type ChatTool = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

export type ModelToolCall = { id: string; name: string; arguments: string };

export type ModelTurn = {
  content: string;
  toolCalls: ModelToolCall[];
  inputTokens: number | null;
  outputTokens: number | null;
};

type StreamChunk = {
  choices?: {
    delta?: {
      content?: string | null;
      tool_calls?: {
        index?: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }[];
    };
  }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string };
};

/**
 * 把 SSE 的位元組流切成一個個 `data:` 的內容。OpenRouter 會穿插 `: OPENROUTER PROCESSING`
 * 這種註解行保持連線，直接略過；`[DONE]` 代表結束。
 */
export async function* sseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, nl).replace(/\r$/, "");
        buffer = buffer.slice(nl + 1);
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") return;
        if (data) yield data;
      }
    }
    const rest = buffer.trim();
    if (rest.startsWith("data:")) {
      const data = rest.slice(5).trim();
      if (data && data !== "[DONE]") yield data;
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * 把串流 chunk 累積成一輪完整回覆。tool_calls 是分段送的：同一個 index 的 name / arguments
 * 會拆在好幾個 chunk，要依 index 接起來。
 */
export class TurnAccumulator {
  content = "";
  private calls = new Map<number, ModelToolCall>();
  inputTokens: number | null = null;
  outputTokens: number | null = null;

  /** 吃一個 chunk，回傳這個 chunk 帶來的新文字（沒有就是空字串）。 */
  push(chunk: StreamChunk): string {
    if (chunk.error?.message) throw new Error(chunk.error.message);
    if (chunk.usage) {
      this.inputTokens = chunk.usage.prompt_tokens ?? this.inputTokens;
      this.outputTokens = chunk.usage.completion_tokens ?? this.outputTokens;
    }
    const delta = chunk.choices?.[0]?.delta;
    if (!delta) return "";
    for (const tc of delta.tool_calls ?? []) {
      const index = tc.index ?? 0;
      const cur = this.calls.get(index) ?? { id: "", name: "", arguments: "" };
      if (tc.id) cur.id = tc.id;
      if (tc.function?.name) cur.name += tc.function.name;
      if (tc.function?.arguments) cur.arguments += tc.function.arguments;
      this.calls.set(index, cur);
    }
    const text = delta.content ?? "";
    this.content += text;
    return text;
  }

  result(): ModelTurn {
    const toolCalls = [...this.calls.entries()]
      .sort(([a], [b]) => a - b)
      .map(([index, c]) => ({ ...c, id: c.id || `call_${index}_${crypto.randomUUID().slice(0, 8)}` }))
      .filter((c) => c.name);
    return {
      content: this.content,
      toolCalls,
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
    };
  }
}

export class ModelError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
  }
}

/** 呼叫 OpenRouter（串流），每收到一段文字就呼叫 onText。回傳整輪的文字與工具呼叫。 */
export async function streamModelTurn(opts: {
  apiKey: string;
  messages: ChatMessage[];
  tools: ChatTool[];
  signal?: AbortSignal;
  onText: (delta: string) => void;
  fetchImpl?: typeof fetch;
}): Promise<ModelTurn> {
  const res = await (opts.fetchImpl ?? fetch)(OPENROUTER_CHAT_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      "Content-Type": "application/json",
      "X-Title": "Pathors Internal",
    },
    body: JSON.stringify({
      model: AI_MODEL,
      messages: opts.messages,
      tools: opts.tools.length > 0 ? opts.tools : undefined,
      tool_choice: opts.tools.length > 0 ? "auto" : undefined,
      stream: true,
      max_tokens: MAX_OUTPUT_TOKENS,
      usage: { include: true },
    }),
    signal: opts.signal,
  });
  if (!res.ok || !res.body) {
    let detail = "";
    try {
      const body = (await res.json()) as { error?: { message?: string } };
      detail = body.error?.message ?? "";
    } catch {
      // 沒有 JSON 就只回狀態碼
    }
    throw new ModelError(detail || `OpenRouter HTTP ${res.status}`, res.status);
  }
  const acc = new TurnAccumulator();
  for await (const data of sseData(res.body)) {
    let chunk: StreamChunk;
    try {
      chunk = JSON.parse(data) as StreamChunk;
    } catch {
      continue;
    }
    const text = acc.push(chunk);
    if (text) opts.onText(text);
  }
  return acc.result();
}

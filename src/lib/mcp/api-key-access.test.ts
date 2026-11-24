import { describe, expect, test } from "bun:test";
import { buildOpenApi, restToolList } from "@/lib/api/rest";
import {
  API_KEY_EXCLUDED_TOOLS,
  handleMcpRequest,
  isReadOnlyTool,
  runToolWithAudit,
  toolAllowedFor,
  toolNamesFor,
} from "./handler";
import type { ToolContext } from "./shared";
import { tools } from "./tools";

// 這些測試都停在 execute 之前（權限判斷）或只讀註冊表，不碰 DB。

const readKey: ToolContext = {
  userId: "u1",
  apiKey: { id: 1, name: "腳本", organizationId: "org1", scope: "read" },
};
const writeKey: ToolContext = {
  userId: "u1",
  apiKey: { id: 2, name: "排程", organizationId: "org1", scope: "write" },
};
const oauth: ToolContext = { userId: "u1" };

describe("API key scope", () => {
  test("OAuth / in-app callers see every tool", () => {
    expect(toolNamesFor(oauth)).toEqual(Object.keys(tools));
  });

  test("a read-only key only sees [read] tools", () => {
    const names = toolNamesFor(readKey);
    expect(names.length).toBeGreaterThan(20);
    for (const n of names) expect(isReadOnlyTool(n)).toBe(true);
    expect(names).toContain("list_integrations");
    expect(names).toContain("get_cloud_billing_scope");
    expect(names).not.toContain("create_transaction");
    expect(names).not.toContain("set_integration_enabled");
    expect(names).not.toContain("disconnect_integration");
  });

  test("a write key sees everything except account-level tools", () => {
    const names = toolNamesFor(writeKey);
    expect(names).toContain("create_transaction");
    expect(names).toContain("set_integration_enabled");
    for (const n of API_KEY_EXCLUDED_TOOLS) {
      expect(names).not.toContain(n);
      expect(toolAllowedFor(n, writeKey)).toBe(false);
      expect(toolAllowedFor(n, oauth)).toBe(true);
    }
  });

  test("runToolWithAudit refuses a write tool for a read key before executing it", async () => {
    const res = await runToolWithAudit("create_transaction", { amount: 1 }, readKey);
    expect(res).toEqual({
      ok: false,
      code: "forbidden",
      error: expect.stringContaining("read-only"),
    });
  });

  test("runToolWithAudit refuses account-level tools for any key", async () => {
    const res = await runToolWithAudit("accept_invitation", { invitationId: "x" }, writeKey);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("forbidden");
  });

  test("unknown tools are reported as such", async () => {
    const res = await runToolWithAudit("no_such_tool", {}, writeKey);
    expect(res).toEqual({ ok: false, code: "unknown_tool", error: "Unknown tool: no_such_tool" });
  });

  test("MCP tools/list over an API key is filtered the same way", async () => {
    const req = new Request("https://internal.pathors.com/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    const res = await handleMcpRequest(req, { userId: "u1", apiKey: readKey.apiKey });
    const body = (await res.json()) as { result: { tools: { name: string }[] } };
    expect(body.result.tools.map((t) => t.name)).toEqual(toolNamesFor(readKey));
  });

  test("MCP tools/call with a read key on a write tool returns the scope error", async () => {
    const req = new Request("https://internal.pathors.com/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "set_integration_enabled", arguments: { provider: "gcp", enabled: true } },
      }),
    });
    const res = await handleMcpRequest(req, { userId: "u1", apiKey: readKey.apiKey });
    const body = (await res.json()) as { result: { isError: boolean; content: { text: string }[] } };
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0].text).toContain("read-only");
  });
});

describe("REST is generated from the MCP registry", () => {
  test("GET /api/v1/tools lists exactly the tools the key may call, with their schemas", () => {
    const list = restToolList(readKey);
    expect(list.map((t) => t.name)).toEqual(toolNamesFor(readKey));
    for (const entry of list) {
      expect(entry.inputSchema).toBe(tools[entry.name].inputSchema);
      expect(entry.path).toBe(`/api/v1/tools/${entry.name}`);
      expect(entry.readOnly).toBe(true);
    }
  });

  test("OpenAPI has one POST path per tool, sharing the tool's input schema", () => {
    const doc = buildOpenApi("https://internal.example");
    expect(doc.openapi).toBe("3.1.0");
    const paths = doc.paths as Record<string, { post?: { operationId: string; requestBody: { content: { "application/json": { schema: unknown } } } } }>;
    for (const name of Object.keys(tools)) {
      const op = paths[`/api/v1/tools/${name}`]?.post;
      expect(op?.operationId).toBe(name);
      expect(op?.requestBody.content["application/json"].schema).toBe(tools[name].inputSchema);
    }
    expect(Object.keys(paths)).toHaveLength(Object.keys(tools).length + 1);
  });
});

import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";
import { handleMcpRequest, withOrgMeta } from "./handler";
import { tools } from "./tools";
import { MCP_SERVER_ICONS } from "./mcp-icons";

// initialize 不碰 DB，所以這裡直接打 handleMcpRequest，不需要 mock。
async function initialize() {
  const req = new Request("https://internal.pathors.com/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "test", version: "0.0.0" },
      },
    }),
  });
  const res = await handleMcpRequest(req, { userId: "test-user" });
  expect(res.status).toBe(200);
  return (await res.json()) as {
    result: { serverInfo: { name: string; icons?: typeof MCP_SERVER_ICONS } };
  };
}

describe("initialize serverInfo.icons", () => {
  test("advertises the Internal logo as PNG + SVG data URIs", async () => {
    const { result } = await initialize();
    const icons = result.serverInfo.icons;

    expect(result.serverInfo.name).toBe("pathors-internal");
    expect(icons).toEqual(MCP_SERVER_ICONS);
    expect(icons?.map((i) => i.mimeType)).toEqual(["image/png", "image/svg+xml"]);
    for (const icon of icons ?? []) {
      expect(icon.src.startsWith(`data:${icon.mimeType};base64,`)).toBe(true);
      expect(icon.sizes.length).toBeGreaterThan(0);
    }
  });

  test("the SVG icon is the same file as src/app/icon.svg", async () => {
    const { result } = await initialize();
    const svg = result.serverInfo.icons?.find((i) => i.mimeType === "image/svg+xml");
    const decoded = Buffer.from(svg!.src.split(",")[1], "base64").toString("utf8");
    const onDisk = readFileSync(new URL("../../app/icon.svg", import.meta.url), "utf8");
    expect(decoded).toBe(onDisk);
  });
});

describe("tools/call carries the organization it ran in", () => {
  test("adds _meta and a last text item without touching structuredContent", async () => {
    // 臨時註冊一支不碰 DB 的工具；組織查詢用 opts 換掉（正式版查 DB）。
    tools.__test_echo = {
      description: "[read] test",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      outputSchema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] },
      execute: async () => ({ ok: true }),
    };
    const seen: unknown[] = [];
    try {
      const req = new Request("https://internal.pathors.com/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([
          { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "__test_echo", arguments: {} } },
          { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "__test_echo", arguments: {} } },
        ]),
      });
      const res = await handleMcpRequest(
        req,
        { userId: "u1" },
        {
          toolCallOrg: async (args) => {
            seen.push(args);
            return { id: "org_d", name: "東蜂科技", slug: "dongfeng" };
          },
        },
      );
      const body = (await res.json()) as {
        result: {
          structuredContent: unknown;
          content: { type: string; text: string }[];
          _meta: Record<string, unknown>;
        };
      }[];
      for (const { result } of body) {
        expect(result.structuredContent).toEqual({ ok: true });
        expect(result._meta["pathors/organization"]).toEqual({ id: "org_d", name: "東蜂科技", slug: "dongfeng" });
        expect(result.content.at(-1)).toEqual({ type: "text", text: "Organization: 東蜂科技" });
        expect(JSON.parse(result.content[0].text)).toEqual({ ok: true });
      }
      // 同一個 request 裡同一個組織只查一次
      expect(seen.length).toBe(1);
    } finally {
      delete tools.__test_echo;
    }
  });

  test("no org (e.g. not in any organization yet) leaves the result unchanged", () => {
    const r = { content: [{ type: "text", text: "{}" }] };
    expect(withOrgMeta(r, null)).toBe(r);
  });
});

describe("instructions", () => {
  test("default to the current org instead of asking", async () => {
    const req = new Request("https://internal.pathors.com/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } }),
    });
    const res = await handleMcpRequest(req, { userId: "u1" });
    const { result } = (await res.json()) as { result: { instructions: string } };
    expect(result.instructions).toContain("current organization");
    expect(result.instructions).toContain("Do not ask the user which organization to use.");
    expect(result.instructions).not.toContain("Never guess the organization");
    expect(result.instructions).not.toContain("ambiguous");
    expect(result.instructions).toContain("list_my_invitations");
  });
});

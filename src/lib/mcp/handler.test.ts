import { readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";
import { handleMcpRequest } from "./handler";
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

import { describe, expect, test } from "bun:test";
import { claudeCodeCommand, cursorConfig } from "./agent-connect-row";

describe("agent connect snippets", () => {
  const url = "https://internal.pathors.com/mcp?org=demo";
  test("Cursor mcp.json entry", () => {
    expect(JSON.parse(cursorConfig(url))).toEqual({ mcpServers: { "pathors-internal": { url } } });
  });
  test("Claude Code command", () => {
    expect(claudeCodeCommand(url)).toBe(`claude mcp add --transport http pathors-internal ${url}`);
  });
});

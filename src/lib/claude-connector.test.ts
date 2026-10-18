import { describe, expect, test } from "bun:test";
import { claudeConnectorUrl, internalConnectorName, orgMcpUrl } from "./claude-connector";

describe("claudeConnectorUrl", () => {
  test("builds the add-custom-connector deep link", () => {
    const link = claudeConnectorUrl({ name: "Pathors Internal", url: "https://internal.pathors.com/mcp" });
    const u = new URL(link);
    expect(u.origin + u.pathname).toBe("https://claude.ai/customize/connectors");
    expect(u.searchParams.get("modal")).toBe("add-custom-connector");
    expect(u.searchParams.get("connectorName")).toBe("Pathors Internal");
    expect(u.searchParams.get("connectorUrl")).toBe("https://internal.pathors.com/mcp");
  });

  test("encodes query strings, spaces, parentheses and CJK in values", () => {
    const name = "Pathors Internal (派斯科技 & Co)";
    const url = "https://internal.pathors.com/mcp?org=pathors&x=1";
    const link = claudeConnectorUrl({ name, url });
    // the inner ? and & must not leak into the outer query
    expect(link).not.toContain("?org=");
    expect(link).not.toContain("&x=1");
    const u = new URL(link);
    expect(u.searchParams.get("connectorName")).toBe(name);
    expect(u.searchParams.get("connectorUrl")).toBe(url);
  });
});

describe("orgMcpUrl / internalConnectorName", () => {
  test("prefers slug, falls back to id", () => {
    expect(orgMcpUrl("https://x/mcp", { id: "abc", slug: "pathors" })).toBe("https://x/mcp?org=pathors");
    expect(orgMcpUrl("https://x/mcp", { id: "abc", slug: null })).toBe("https://x/mcp?org=abc");
  });

  test("names the connector after the org", () => {
    expect(internalConnectorName("派斯科技")).toBe("Pathors Internal (派斯科技)");
  });
});

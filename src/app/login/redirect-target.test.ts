import { describe, expect, test } from "bun:test";
import {
  authPageHref,
  resolveRedirectTarget,
  sanitizeRedirect,
  survivesExtraDecode,
} from "./redirect-target";

const MCP_QUERY =
  "client_id=abc&response_type=code&redirect_uri=https%3A%2F%2Fclaude.ai%2Fapi%2Fmcp%2Fauth_callback&code_challenge=xyz&state=s1";

describe("sanitizeRedirect", () => {
  test("keeps a same-origin path", () => {
    expect(sanitizeRedirect("/dashboard")).toBe("/dashboard");
    expect(sanitizeRedirect("/dashboard/reports?year=2026")).toBe("/dashboard/reports?year=2026");
  });

  test("rejects protocol-relative URLs", () => {
    expect(sanitizeRedirect("//evil.com")).toBe("/dashboard");
  });

  test("rejects a backslash right after the slash (browsers read it as //)", () => {
    expect(sanitizeRedirect("/\\evil.com")).toBe("/dashboard");
  });

  test("rejects percent-encoded slashes after the first slash", () => {
    expect(sanitizeRedirect("/%2Fevil.com")).toBe("/dashboard");
  });

  test("rejects absolute URLs and other schemes", () => {
    expect(sanitizeRedirect("https://evil.com")).toBe("/dashboard");
    expect(sanitizeRedirect("javascript:alert(1)")).toBe("/dashboard");
  });

  test("rejects whitespace that browsers strip out of URLs", () => {
    expect(sanitizeRedirect("/\t/evil.com")).toBe("/dashboard");
  });

  test("missing value falls back to /dashboard", () => {
    expect(sanitizeRedirect(null)).toBe("/dashboard");
    expect(sanitizeRedirect("")).toBe("/dashboard");
  });

  test("keeps an MCP authorize path", () => {
    const path = `/api/auth/mcp/authorize?${MCP_QUERY}`;
    expect(sanitizeRedirect(path)).toBe(path);
  });
});

describe("resolveRedirectTarget", () => {
  test("an MCP OAuth query goes back to the authorize endpoint", () => {
    expect(resolveRedirectTarget(new URLSearchParams(MCP_QUERY))).toBe(
      `/api/auth/mcp/authorize?${MCP_QUERY}`,
    );
  });

  test("our own params never leak into the authorize URL", () => {
    const params = new URLSearchParams(`${MCP_QUERY}&email=amy%40example.com&error=SSO_REQUIRED`);
    expect(resolveRedirectTarget(params)).toBe(`/api/auth/mcp/authorize?${MCP_QUERY}`);
  });

  test("otherwise uses a sanitized ?redirect=", () => {
    expect(resolveRedirectTarget(new URLSearchParams("redirect=%2Fdashboard%2Fbilling"))).toBe(
      "/dashboard/billing",
    );
    expect(resolveRedirectTarget(new URLSearchParams("redirect=https%3A%2F%2Fevil.com"))).toBe(
      "/dashboard",
    );
  });

  test("no params at all goes to /dashboard", () => {
    expect(resolveRedirectTarget(new URLSearchParams())).toBe("/dashboard");
  });
});

describe("authPageHref", () => {
  test("carries the original query and prefills email", () => {
    expect(
      authPageHref("/signup", new URLSearchParams("redirect=%2Fdashboard%2Fbilling"), {
        email: "amy@example.com",
      }),
    ).toBe("/signup?redirect=%2Fdashboard%2Fbilling&email=amy%40example.com");
  });

  test("drops a stale error and skips an empty email", () => {
    expect(authPageHref("/login", new URLSearchParams("error=INVALID_TOKEN"), { email: "" })).toBe(
      "/login",
    );
  });
});

describe("survivesExtraDecode", () => {
  // better-auth 的 /magic-link/verify 會對 URL 解析完的值再 decodeURIComponent 一次。
  test("one extra decodeURIComponent gives back the original URL", () => {
    const authorize = `/api/auth/mcp/authorize?${MCP_QUERY}`;
    expect(decodeURIComponent(survivesExtraDecode(authorize))).toBe(authorize);

    const setPassword = `/signup/password?redirect=${encodeURIComponent(authorize)}`;
    expect(decodeURIComponent(survivesExtraDecode(setPassword))).toBe(setPassword);
  });

  test("leaves URLs without percent-escapes untouched", () => {
    expect(survivesExtraDecode("/dashboard")).toBe("/dashboard");
  });
});

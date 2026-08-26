import { NextRequest, NextResponse } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

// Next 16 把 `middleware` 這個 file convention 改名為 `proxy`（檔名與匯出的函式名
// 都要改），因為「middleware」容易跟 Express 的中介層混淆，而它實際上是跑在應用程式
// 前面的一層網路邊界。行為完全沒變：config.matcher 的語意、NextRequest / NextResponse
// 都一樣。見 https://nextjs.org/docs/messages/middleware-to-proxy

export function proxy(request: NextRequest) {
  // 根目錄是公開的 landing page（internal.pathors.com），任何人都看得到；
  // 系統本身掛在 /dashboard 底下，那才需要登入。
  if (request.nextUrl.pathname === "/") return NextResponse.next();

  const sessionCookie = getSessionCookie(request);
  if (!sessionCookie) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("redirect", request.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }
  return NextResponse.next();
}

// Protect everything except the landing page and its assets, the legal
// documents, auth pages, the auth API, static assets, and the public MCP
// surface: the OAuth discovery docs (.well-known) and the MCP endpoint (/mcp),
// which must be reachable without a session cookie so MCP clients can discover
// OAuth and receive a proper 401 (not an HTML login redirect). /mcp does its own
// bearer-token auth via withMcpAuth. The MCP management UI lives at
// /dashboard/settings/mcp and stays protected.
//
// /privacy and /terms must stay public: they are linked from the landing page
// and published as `resource_policy_uri` / `resource_tos_uri` in the RFC 9728
// metadata, where OpenAI's plugin review fetches them without any session.
export const config = {
  matcher: [
    "/((?!login|signup|landing|privacy|terms|api/auth|mcp|.well-known|_next/static|_next/image|favicon.ico).*)",
  ],
};

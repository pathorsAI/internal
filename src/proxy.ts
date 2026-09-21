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
//
// /flags 是 public/flags 那套國旗圖示（幣別與語系切換器都吃它）。正式環境其實碰不到
// 這裡 —— Cloudflare 的 assets binding 會在 Worker 之前就把 public/ 的檔案送出去 ——
// 但 `next dev` 沒有那一層，於是同一張圖在本機會被導去 /login，公開頁面的語系切換器
// 在開發時就少了旗子。列進來讓本機跟線上看到的是同一件事。
export const config = {
  matcher: [
    "/((?!login|signup|landing|privacy|terms|flags|api/auth|mcp|.well-known|_next/static|_next/image|favicon.ico).*)",
  ],
};

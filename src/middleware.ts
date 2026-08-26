import { NextRequest, NextResponse } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

export function middleware(request: NextRequest) {
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

// Protect everything except the landing page and its assets, auth pages, the
// auth API, static assets, and the public MCP surface: the OAuth discovery docs
// (.well-known) and the MCP endpoint (/mcp), which must be reachable without a
// session cookie so MCP clients can discover OAuth and receive a proper 401
// (not an HTML login redirect). /mcp does its own bearer-token auth via
// withMcpAuth. The MCP management UI lives at /dashboard/settings/mcp and stays
// protected.
export const config = {
  matcher: [
    "/((?!login|signup|landing|api/auth|mcp|.well-known|_next/static|_next/image|favicon.ico).*)",
  ],
};

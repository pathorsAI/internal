import { NextRequest, NextResponse } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

export function middleware(request: NextRequest) {
  const sessionCookie = getSessionCookie(request);
  if (!sessionCookie) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("redirect", request.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }
  return NextResponse.next();
}

// Protect everything except auth pages, the auth API, static assets, and the
// public MCP surface: the OAuth discovery docs (.well-known) and the MCP
// endpoint (/api/mcp), which must be reachable without a session cookie so MCP
// clients can discover OAuth and receive a proper 401 (not an HTML login
// redirect). /api/mcp does its own bearer-token auth via withMcpAuth.
export const config = {
  matcher: [
    "/((?!login|signup|api/auth|api/mcp|.well-known|_next/static|_next/image|favicon.ico).*)",
  ],
};

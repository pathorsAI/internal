import { NextRequest, NextResponse } from "next/server";
import { getSessionCookie } from "better-auth/cookies";
import { USAGE_ROUTE_HEADER } from "@/lib/usage/record-header";
import { normalizeDashboardPath } from "@/lib/usage/routes";

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
  return NextResponse.next({ request: { headers: usageRequestHeaders(request) } });
}

/**
 * 功能使用紀錄（docs/usage-tracking.md）：這裡只做不碰 DB 的那一半 —— 把 pathname 正規化成
 * 路由 pattern（`/dashboard/ai/42` → `/dashboard/ai/[id]`）放進 request header，真正的寫入在
 * requireOrg()（src/lib/session.ts）解析出組織之後、回應送出後才做。
 *
 * 只標 GET、不是瀏覽器 prefetch、不是 server action 的請求。外部送來的同名
 * header 一律先刪掉，不讓人偽造。
 */
function usageRequestHeaders(request: NextRequest): Headers {
  const headers = new Headers(request.headers);
  headers.delete(USAGE_ROUTE_HEADER);
  // 瀏覽器層的 prefetch（<link rel=prefetch>）在這裡就擋；App Router 自己的 prefetch header
  // （next-router-prefetch）Next 不讓 proxy 看到，靠只在頁面本身的 requireOrg() 記錄來排除（見 src/lib/session.ts）。
  const purpose = headers.get("sec-purpose") ?? headers.get("purpose");
  const isBrowserPrefetch = purpose?.includes("prefetch") ?? false;
  if (request.method !== "GET" || isBrowserPrefetch || headers.has("next-action")) return headers;
  const route = normalizeDashboardPath(request.nextUrl.pathname);
  if (route) headers.set(USAGE_ROUTE_HEADER, route);
  return headers;
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
// /api/cron 是 Cloudflare Cron Trigger 的內部進入點（worker.ts 的 scheduled() 在同一個
// isolate 裡直接呼叫，沒有 session cookie）；它自己用一次性 token 驗證，外部請求一律 404。
// 見 src/lib/cron-token.ts。
//
// /api/channels 是 LINE／WhatsApp bot：兩個 webhook 由平台直接打（沒有 session cookie，自己驗簽），
// /api/channels/process 只給 worker.ts 的 queue() 用一次性 token 呼叫，外部請求一律 404。
// 見 src/lib/channels/ 與 docs/chat-channels.md。
//
// /api/simpany-tax-uploads/<token> 是 MCP 開的一次性上傳網址（本機 `curl -T` 傳檔，沒有
// session cookie）。網址裡 256-bit 的 token 就是憑證：30 分鐘、只能 PUT 一次，route 自己驗，
// 無效一律 404。見 src/lib/simpany-tax-upload.ts。
//
// /api/v1 是 REST API（src/app/api/v1）：用組織 API key（Authorization: Bearer pik_…）驗證，
// 不吃 session cookie；route 自己驗，沒金鑰一律 401 JSON（不是導去 /login）。見 docs/api.md。
//
// /flags 是 public/flags 那套國旗圖示（幣別與語系切換器都吃它）。正式環境其實碰不到
// 這裡 —— Cloudflare 的 assets binding 會在 Worker 之前就把 public/ 的檔案送出去 ——
// 但 `next dev` 沒有那一層，於是同一張圖在本機會被導去 /login，公開頁面的語系切換器
// 在開發時就少了旗子。列進來讓本機跟線上看到的是同一件事。
//
// /line 是 public/line 的圖片（LINE 說明卡、rich menu 圖）。LINE 與 Meta 的伺服器抓圖時沒有
// session cookie，被導去 /login 圖就破了。正式環境跟 /flags 一樣由 assets binding 先送出，
// 列進來是讓本機與任何沒有那一層的環境都一樣公開。注意要寫 `line/`（含斜線）：只排除這個資料夾，
// 不會連帶排除哪天出現的 /lineup 之類的頁面。
//
// signup / forgot-password / reset-password 是公開註冊與忘記密碼的頁面，給還沒有
// （或登不進）帳號的人用，當然不能要求 session。注意這裡的排除是**前綴**比對：
// `signup` 也把 /signup/password（新帳號設密碼）排除在外了。那一頁確實需要登入，
// 但它自己在 server component 裡檢查 session 並導去 /login（見
// src/app/signup/password/page.tsx），刻意不靠這裡——這層只看 cookie 存不存在，
// 那頁要的是真的去查 session 與 credential account。
export const config = {
  matcher: [
    "/((?!login|signup|forgot-password|reset-password|landing|privacy|terms|flags|line/|api/auth|api/version|api/cron|api/channels|api/simpany-tax-uploads|api/v1|mcp|.well-known|_next/static|_next/image|favicon.ico).*)",
  ],
};

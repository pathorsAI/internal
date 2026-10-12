/**
 * 登入／註冊／忘記密碼這幾頁共用的「完成之後要去哪」。
 *
 * 三個入口都可能是被 MCP 的 OAuth 流程（ChatGPT / Claude / Codex）帶進來的：
 * better-auth 的 mcp plugin 把沒登入的人導去 /login 時，會把原本 authorize 的整串
 * query（client_id、redirect_uri、code_challenge、state…）原封不動接在後面。登入頁
 * 再連去 /signup 或 /forgot-password 時也要把同一串 query 帶過去，否則人在註冊頁
 * 完成註冊，OAuth 流程卻已經斷了——這就是為什麼這段邏輯不能只留在 login/page.tsx。
 *
 * 純函式、沒有 "use client"：client 元件與 server component（/signup/password）
 * 都會 import 它。
 */

/** 沒有可用的目的地時的預設落點。org-less 的新使用者會被 requireOrg() 再導去 /onboarding。 */
export const DEFAULT_REDIRECT = "/dashboard";

/**
 * 這幾個 key 是我們自己加在網址上的（預填 email、錯誤／提示訊息），不屬於原本的
 * OAuth query。組 MCP authorize 網址或往下一頁傳遞時都要拿掉：留著的話，`email=`
 * 會被原樣送進 /api/auth/mcp/authorize，而 `error=` 會讓下一頁以為又出錯了一次。
 */
const OWN_PARAMS = ["email", "error", "error_description", "notice"] as const;

function withoutOwnParams(params: URLSearchParams): URLSearchParams {
  const copy = new URLSearchParams(params);
  for (const key of OWN_PARAMS) copy.delete(key);
  return copy;
}

/**
 * better-auth 對「相對路徑的 callbackURL」只放行這個字元集（better-auth
 * auth/trusted-origins 的 matchesOriginPattern，allowRelativePaths 那條）。
 *
 * 我們的 sanitizer 刻意用同一個字元集，而不是只擋 `//` 與 `/\`：magic link 會把
 * redirect 目標當 callbackURL 交給 better-auth，一個我們放行、它卻拒絕的值會讓
 * /sign-in/magic-link 回 403 INVALID_CALLBACK_URL——而註冊頁為了不洩漏帳號存在
 * 與否，除了限流與 SSO 之外的錯誤一律顯示「請去收信」，結果就是信永遠不會來。
 * 用同一套規則，被拒的值就在這裡先退回 /dashboard。
 *
 * 這條規則本身也就是 open redirect 的防線：開頭必須是單一個 `/`，第二個字元不能是
 * `/`、`\` 或它們的百分比編碼；整串不允許空白、控制字元、`:`（所以沒有
 * `https://…`、`javascript:`）。瀏覽器會把網址裡的 tab / 換行直接刪掉，
 * `/\t/evil.com` 會變成 `//evil.com`——這也是為什麼用白名單而不是黑名單。
 */
const SAFE_RELATIVE_URL = /^\/(?!\/|\\|%2f|%5c)[\w\-.+/@]*(?:\?[\w\-.+/=&%@]*)?$/i;

/** `redirect` 參數只接受同源的相對路徑；其他一律退回 /dashboard。 */
export function sanitizeRedirect(value: string | null | undefined): string {
  if (!value || !SAFE_RELATIVE_URL.test(value)) return DEFAULT_REDIRECT;
  return value;
}

/**
 * When better-auth's MCP plugin sends an unauthenticated user here, it appends
 * the original OAuth query (client_id, redirect_uri, code_challenge, …). After
 * sign-in we must return to the authorize endpoint so the flow can issue a code.
 */
function mcpAuthorizeCallback(params: URLSearchParams): string | null {
  if (!params.get("client_id") || params.get("response_type") !== "code") {
    return null;
  }
  return `/api/auth/mcp/authorize?${withoutOwnParams(params).toString()}`;
}

/**
 * 這次登入／註冊完成後要去的地方：MCP authorize（若是被 OAuth 流程帶進來的）→
 * `?redirect=`（proxy 擋下未登入請求時寫的原路徑）→ /dashboard。
 *
 * ⚠️ 每一種登入方式都必須用這個值。MCP 的 authorize query 只要有一條路徑沒接上，
 * ChatGPT / Claude / Codex 的 OAuth 流程就會在登入後斷掉。
 */
export function resolveRedirectTarget(params: URLSearchParams): string {
  return mcpAuthorizeCallback(params) ?? sanitizeRedirect(params.get("redirect"));
}

/**
 * 連去另一個登入相關頁面時，把原本的 query（MCP 的 OAuth 參數或 `redirect`）一起帶過去。
 * `extra` 會覆蓋同名參數，用來預填 email。
 */
export function authPageHref(
  path: string,
  params: URLSearchParams,
  extra: Record<string, string> = {},
): string {
  const query = withoutOwnParams(params);
  for (const [key, value] of Object.entries(extra)) {
    if (value) query.set(key, value);
  }
  const qs = query.toString();
  return qs ? `${path}?${qs}` : path;
}

/**
 * 讓一個網址在 better-auth magic link 的「多解碼一次」之後還原成原樣。
 *
 * /magic-link/verify 對 callbackURL / newUserCallbackURL / errorCallbackURL 都做了
 * `decodeURIComponent(ctx.query.x)`，但 ctx.query 本來就已經被 URL 解析解碼過一次
 * （better-auth plugins/magic-link）。結果是我們交出去的網址被解碼了兩次：MCP
 * authorize 裡的 `redirect_uri=https%3A%2F%2Fclaude.ai…` 會變成 `https://claude.ai…`，
 * 接著同一個 endpoint 的 originCheck 看到 `:` 就回 403；`/signup/password?redirect=`
 * 後面那串則會被拆成好幾個參數。
 *
 * 把 `%` 先換成 `%25`：對任何字串 s，`decodeURIComponent(s.replaceAll("%", "%25"))`
 * 恆等於 s，而且換完的結果仍落在 better-auth 對相對路徑放行的字元集裡（`%`、數字），
 * /sign-in/magic-link 收件時的 origin check 一樣過得去。
 */
export function survivesExtraDecode(url: string): string {
  return url.replaceAll("%", "%25");
}

/** Next 的 server component 拿到的 searchParams 物件 → URLSearchParams。 */
export function toSearchParams(
  record: Record<string, string | string[] | undefined>,
): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(record)) {
    if (Array.isArray(value)) {
      for (const v of value) params.append(key, v);
    } else if (value !== undefined) {
      params.append(key, value);
    }
  }
  return params;
}

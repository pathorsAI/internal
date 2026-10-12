/**
 * 登入頁上方要顯示的提示：從網址上的 `?error=` / `?notice=` 決定。
 *
 * 會帶這些參數回來的路徑：
 * - Google 登入的 OAuth callback 失敗。登入頁把 errorCallbackURL 指回 /login，
 *   better-auth 會接上 `?error=<code>`（oauth2/errors 的 redirectOnError）。
 *   SSO 網域的人第一次用 Google 登入時，databaseHooks.user.create 擋下來的就是
 *   `SSO_REQUIRED`（見 src/lib/auth.ts）。
 * - magic link 失效或已用過：/magic-link/verify 導去 errorCallbackURL 並帶
 *   `?error=INVALID_TOKEN`。
 * - 重設密碼完成：/reset-password 導回來時帶 `?notice=password-updated`。
 *
 * 不認得的 error code 一律給通用訊息，**不把 code 原樣印在畫面上**：這個參數誰都
 * 能在網址上亂填，直接顯示等於讓任何人在我們的登入頁上放一行自訂文字。
 */
export type LoginNotice = "ssoRequired" | "linkInvalid" | "passwordUpdated" | "failed" | null;

export function loginNotice(params: URLSearchParams): LoginNotice {
  const error = params.get("error");
  if (error === "SSO_REQUIRED") return "ssoRequired";
  if (error === "INVALID_TOKEN") return "linkInvalid";
  if (error) return "failed";
  if (params.get("notice") === "password-updated") return "passwordUpdated";
  return null;
}

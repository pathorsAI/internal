/**
 * 「填 email、我們寄信」這類請求（註冊的 magic link、忘記密碼）回來之後，要不要
 * 顯示錯誤。
 *
 * 只有三種情況會讓使用者看到錯誤，其餘一律當成功、顯示「請去收信」：
 * - 429：被限流。說出來不洩漏任何事，而且不說的話，人會一直按、一直等不到信。
 * - 403 + SSO_REQUIRED：網域歸公司 SSO 管（src/lib/auth.ts 的 hooks）。這是網域層級
 *   的資訊，登入頁的 SSO 查詢本來就會透露，不涉及個別帳號。
 * - 請求本身丟了例外（網路錯誤）：呼叫端在 catch 裡直接給 "network"，不經過這裡。
 *
 * 其他錯誤（含 5xx）刻意不講：伺服器的回應不能成為「這個 email 有沒有帳號」的
 * 線索，而寄信失敗本身在伺服器端已經被吞掉、寫進 log（auth.ts 的 deliver）。
 */
export type EmailRequestError = "rateLimited" | "ssoRequired" | "network";

export function emailRequestError(
  error: { status?: number; code?: string } | null | undefined,
): Exclude<EmailRequestError, "network"> | null {
  if (!error) return null;
  if (error.status === 429) return "rateLimited";
  if (error.status === 403 && error.code === "SSO_REQUIRED") return "ssoRequired";
  return null;
}

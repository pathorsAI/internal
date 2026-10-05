/**
 * email 那一步送出後要去哪：查 SSO 的結果 → 下一步。
 *
 * 密碼登入一律開著，所以 SSO 查詢只要沒成功導去 IdP，不管是 404（這個網域沒有
 * provider）、500、被限流還是網路錯誤，都要讓人走到密碼那一步。只停在 email 那一步
 * 的話，SSO 一壞，密碼帳號就全部被鎖在門外。
 */

/** null = 查詢成功，plugin 正在導去 IdP；status 為 undefined = 請求本身丟了例外（網路錯誤）。 */
export type SsoLookupResult = null | { status?: number };

/** 密碼那一步上方的提示。null = 不需要提示（404 是正常情況，不該讓人以為出錯）。 */
export type AfterSsoLookupNote = "ssoUnavailable" | null;

export type AfterSsoLookup = { step: "redirecting" } | { step: "password"; note: AfterSsoLookupNote };

export function afterSsoLookup(result: SsoLookupResult): AfterSsoLookup {
  if (result === null) return { step: "redirecting" };
  return { step: "password", note: result.status === 404 ? null : "ssoUnavailable" };
}

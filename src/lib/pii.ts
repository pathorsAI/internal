// 員工個資的共用處理（data minimization）：
// - 高敏感識別欄位（身分證字號、薪轉帳戶）經 MCP 回傳前一律遮罩，
//   完整值只在網頁端使用（勞健保申報、薪轉作業才需要）。
// - Email 寫入前做格式檢查，網頁 action 與 MCP tool 共用同一套規則。

/** 身分證字號等識別碼：保留前 3 碼，其餘遮罩（A12*******）。 */
export function maskNationalId(v: string | null): string | null {
  if (!v) return v;
  return v.slice(0, 3) + "*".repeat(Math.max(v.length - 3, 0));
}

/** 銀行帳號：只留末 5 碼（****12345）。 */
export function maskBankAccount(v: string | null): string | null {
  if (!v) return v;
  return "*".repeat(Math.max(v.length - 5, 0)) + v.slice(-5);
}

// 等價於原本的 /^[^\s@]+@[^\s@]+\.[^\s@]+$/，但改寫成線性、不會災難性回溯的形式。
// 原式的 `[^\s@]+\.[^\s@]+` 兩個量詞都吃得下「.」，網域每多一個點就多一組切法，
// 驗證失敗的長字串會退化成 O(n²)（ReDoS，typescript:S5852）。
// 這裡把網域拆成「首字元 + 非點字元 + 第一個點 + 至少一個字元」，每一步都只有一種走法：
//   [^\s@]      網域第一個字元（原式第一組 `+` 至少吃一個，且點不能落在開頭）
//   [^.\s@]*\.  推進到第一個點（不含點，所以位置唯一）
//   [^\s@]+$    點後面至少還要有一個字元（等價於原式「點不能落在結尾」）
// 接受／拒絕的字串集合與原式完全相同。
const EMAIL_RE = /^[^\s@]+@[^\s@][^.\s@]*\.[^\s@]+$/;

export function isValidEmail(v: string): boolean {
  return EMAIL_RE.test(v);
}

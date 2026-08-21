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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(v: string): boolean {
  return EMAIL_RE.test(v);
}

/**
 * 密碼長度下限，伺服器端（src/lib/auth.ts 的 minPasswordLength）與表單的即時檢查
 * 共用這一個數字。兩邊各寫一份遲早會不一致，而不一致的方向通常是「表單說可以、
 * 送出去才被伺服器打回來」。
 *
 * 12 而不是 better-auth 預設的 8：這是能看到整個組織帳務的後台。
 */
export const MIN_PASSWORD_LENGTH = 12;

export type NewPasswordProblem = "tooShort" | "mismatch" | null;

/** 設定／重設密碼表單送出前的檢查。長度先報：兩個都錯時，先改長度才有意義。 */
export function checkNewPassword(password: string, confirm: string): NewPasswordProblem {
  if (password.length < MIN_PASSWORD_LENGTH) return "tooShort";
  if (password !== confirm) return "mismatch";
  return null;
}

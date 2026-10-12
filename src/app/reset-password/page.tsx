import { ResetPasswordForm } from "./reset-password-form";

/**
 * 重設密碼信的落點。better-auth 的 /api/auth/reset-password/:token 先驗過 token，
 * 有效就導來這裡帶 `?token=`，過期或不存在就帶 `?error=INVALID_TOKEN`。
 *
 * token 有效與否在這裡只是「先擋明顯不行的」：真正的檢查在送出新密碼時
 * （better-auth 的 POST /reset-password 會再驗一次），所以頁面停留太久、token
 * 在填表期間過期，送出時一樣會得到 INVALID_TOKEN，表單會切到失效畫面。
 */
export default async function ResetPasswordPage({
  searchParams,
}: Readonly<{ searchParams: Promise<{ token?: string | string[]; error?: string | string[] }> }>) {
  const { token, error } = await searchParams;
  const validToken = typeof token === "string" && token !== "" && error === undefined ? token : null;
  return <ResetPasswordForm token={validToken} />;
}

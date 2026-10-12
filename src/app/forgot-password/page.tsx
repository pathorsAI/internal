import { toSearchParams } from "@/app/login/redirect-target";
import { ForgotPasswordForm } from "./forgot-password-form";

/**
 * 忘記密碼：填 email → better-auth 寄重設信（src/lib/auth.ts 的 sendResetPassword）
 * → 信裡的連結經 /api/auth/reset-password/:token 驗過 token，導到 /reset-password。
 *
 * searchParams 以字串傳給表單的理由同 /signup。
 */
export default async function ForgotPasswordPage({
  searchParams,
}: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>) {
  const params = toSearchParams(await searchParams);
  return <ForgotPasswordForm query={params.toString()} />;
}

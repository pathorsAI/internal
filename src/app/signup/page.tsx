import { toSearchParams } from "@/app/login/redirect-target";
import { SignupForm } from "./signup-form";

/**
 * 公開註冊。流程是「先驗證 email、再設密碼」，理由見 src/lib/auth.ts 的
 * emailAndPassword 註解：
 *
 *   /signup 填 email + 名字 → 先做跟登入頁一樣的 SSO 查詢（SSO 網域直接導去 IdP）
 *   → 寄 magic link → 點信裡的連結 → 新 user 被帶去 /signup/password 設密碼，
 *   既有 user 直接登入。
 *
 * searchParams 在這裡讀、以字串傳給表單，而不是在表單裡 useSearchParams：
 * 表單因此是個只吃 props 的 client 元件，測試可以直接 render，不必 mock
 * next/navigation（那個 mock 是整個 test process 共用的，會跟登入頁的測試互相干擾）。
 */
export default async function SignupPage({
  searchParams,
}: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>) {
  const params = toSearchParams(await searchParams);
  return <SignupForm query={params.toString()} />;
}

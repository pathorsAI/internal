import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { account } from "@/db/auth-schema";
import { auth } from "@/lib/auth";
import { sanitizeRedirect } from "@/app/login/redirect-target";
import { SetPasswordForm } from "./set-password-form";

async function hasCredentialAccount(userId: string): Promise<boolean> {
  const rows = await getDb()
    .select({ id: account.id })
    .from(account)
    .where(and(eq(account.userId, userId), eq(account.providerId, "credential")))
    .limit(1);
  return rows.length > 0;
}

/**
 * 新帳號設定密碼。magic link 驗證完、建好 user 的人會被 newUserCallbackURL 帶到
 * 這裡（見 src/app/signup/signup-form.tsx），此時已經有 session。
 *
 * 這頁不在 proxy 的保護範圍內（matcher 的 `signup` 前綴把 /signup/password 一起
 * 排除了），所以 session 在這裡自己檢查。
 *
 * 已經有密碼（credential account）的人直接放行到目的地：例如重新整理了這頁、
 * 或是從瀏覽器紀錄點回來。better-auth 的 setPassword 對已有密碼的人只會回
 * PASSWORD_ALREADY_SET，這頁對他們沒有用處。
 *
 * `?redirect=` 只信同源相對路徑（sanitizeRedirect）：這個網址是從 email 連結一路
 * 帶過來的，任何人都能偽造一條「設完密碼就跳去釣魚站」的連結。
 */
export default async function SetPasswordPage({
  searchParams,
}: Readonly<{ searchParams: Promise<{ redirect?: string | string[] }> }>) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/login");

  const { redirect: rawRedirect } = await searchParams;
  const redirectTo = sanitizeRedirect(typeof rawRedirect === "string" ? rawRedirect : null);

  if (await hasCredentialAccount(session.user.id)) redirect(redirectTo);

  return <SetPasswordForm redirectTo={redirectTo} />;
}

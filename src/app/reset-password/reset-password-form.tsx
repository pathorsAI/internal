"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { authClient } from "@/lib/auth-client";
import { AuthShell } from "@/components/auth/auth-shell";
import { formText } from "@/components/auth/form-text";
import { NewPasswordFields } from "@/components/auth/new-password-fields";
import { Button } from "@/components/ui/button";
import { useHydrated } from "@/hooks/use-hydrated";
import { checkNewPassword, type NewPasswordProblem } from "@/lib/password-policy";

type SubmitError = "rateLimited" | "network" | "failed";

/** `token` 為 null 代表連結無效（過期、用過、或網址根本沒帶 token）。 */
export function ResetPasswordForm({ token }: Readonly<{ token: string | null }>) {
  const t = useTranslations("auth.resetPassword");
  const ts = useTranslations("auth.shared");
  const [invalid, setInvalid] = useState(token === null);
  const [problem, setProblem] = useState<NewPasswordProblem>(null);
  const [error, setError] = useState<SubmitError | null>(null);
  const [pending, setPending] = useState(false);
  const hydrated = useHydrated();

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!token) return;
    const form = new FormData(e.currentTarget);
    const newPassword = formText(form, "password");
    const check = checkNewPassword(newPassword, formText(form, "confirm"));
    setProblem(check);
    setError(null);
    if (check) return;

    setPending(true);
    let outcome: SubmitError | "invalid" | null;
    try {
      const { error: resetError } = await authClient.resetPassword({ newPassword, token });
      if (!resetError) outcome = null;
      else if (resetError.code === "INVALID_TOKEN") outcome = "invalid";
      else if (resetError.status === 429) outcome = "rateLimited";
      else outcome = "failed";
    } catch {
      outcome = "network";
    }
    if (outcome === null) {
      // 成功時 better-auth 已經把這個人所有的 session 都刪了
      // （revokeSessionsOnPasswordReset），回登入頁用新密碼登入。
      globalThis.location.href = "/login?notice=password-updated";
      return;
    }
    setPending(false);
    if (outcome === "invalid") setInvalid(true);
    else setError(outcome);
  }

  if (invalid) {
    return (
      <AuthShell title={t("invalid.title")}>
        <div className="space-y-4">
          <p className="text-sm">{t("invalid.body")}</p>
          <Button asChild className="h-11 w-full">
            <Link href="/forgot-password">{t("invalid.action")}</Link>
          </Button>
          <div className="text-center text-sm">
            <Link href="/login" className="text-muted-foreground underline-offset-4 hover:underline">
              {ts("backToLogin")}
            </Link>
          </div>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell title={t("title")} description={t("description")}>
      <form method="post" onSubmit={onSubmit} className="space-y-4">
        <NewPasswordFields problem={problem} />
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error === "failed" ? t("failed") : ts(error)}
          </p>
        )}
        <Button type="submit" className="h-11 w-full" disabled={pending || !hydrated}>
          {pending ? t("submitting") : t("submit")}
        </Button>
      </form>
    </AuthShell>
  );
}

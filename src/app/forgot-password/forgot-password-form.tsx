"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { authClient } from "@/lib/auth-client";
import { AuthCard } from "@/components/auth/auth-card";
import { emailRequestError, type EmailRequestError } from "@/components/auth/email-request-error";
import { formText } from "@/components/auth/form-text";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useHydrated } from "@/hooks/use-hydrated";
import { authPageHref } from "@/app/login/redirect-target";

export function ForgotPasswordForm({ query }: Readonly<{ query: string }>) {
  const t = useTranslations("auth.forgotPassword");
  const ts = useTranslations("auth.shared");
  const params = useMemo(() => new URLSearchParams(query), [query]);
  // 「回到登入」保留原本的 query：從 MCP 的 OAuth 流程過來的人，想起密碼之後
  // 回登入頁還能接著完成授權。
  const loginHref = authPageHref("/login", params);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<EmailRequestError | null>(null);
  const [pending, setPending] = useState(false);
  const hydrated = useHydrated();

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const email = formText(new FormData(e.currentTarget), "email").trim();
    setPending(true);
    setError(null);
    let outcome: EmailRequestError | null;
    try {
      // redirectTo 是相對路徑：better-auth 驗完 token 後用 baseURL 組成絕對網址，
      // 帶 ?token=（或過期時 ?error=INVALID_TOKEN）導過去。
      const { error: requestError } = await authClient.requestPasswordReset({
        email,
        redirectTo: "/reset-password",
      });
      outcome = emailRequestError(requestError);
    } catch {
      outcome = "network";
    }
    setPending(false);
    if (outcome) {
      setError(outcome);
      return;
    }
    // 有沒有這個帳號，畫面都一樣（better-auth 對不存在的 email 也回 200）。
    setSent(true);
  }

  if (sent) {
    return (
      <AuthCard title={t("sent.title")}>
        <div className="space-y-4">
          <p className="text-sm">{t("sent.body")}</p>
          <Link href={loginHref} className="text-sm text-muted-foreground underline-offset-4 hover:underline">
            {ts("backToLogin")}
          </Link>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard title={t("title")} description={t("description")}>
      <form method="post" onSubmit={onSubmit} className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="email">{ts("emailLabel")}</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            defaultValue={params.get("email") ?? ""}
            placeholder={ts("emailPlaceholder")}
          />
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {ts(error)}
          </p>
        )}
        <Button type="submit" className="w-full" disabled={pending || !hydrated}>
          {pending ? t("submitting") : t("submit")}
        </Button>
        <div className="text-center text-sm">
          <Link href={loginHref} className="text-muted-foreground underline-offset-4 hover:underline">
            {ts("backToLogin")}
          </Link>
        </div>
      </form>
    </AuthCard>
  );
}

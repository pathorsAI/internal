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
import { afterSsoLookup, type SsoLookupResult } from "@/app/login/sso-lookup";
import {
  authPageHref,
  resolveRedirectTarget,
  survivesExtraDecode,
} from "@/app/login/redirect-target";

export function SignupForm({ query }: Readonly<{ query: string }>) {
  const t = useTranslations("auth.signup");
  const ts = useTranslations("auth.shared");
  const params = useMemo(() => new URLSearchParams(query), [query]);
  // 註冊完成（點了信裡的連結）之後要去的地方，跟登入頁同一套規則——被 MCP 的
  // OAuth 流程帶進來的人，註冊完要回得去 authorize。
  const redirectTo = resolveRedirectTarget(params);
  const loginHref = authPageHref("/login", params);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [error, setError] = useState<EmailRequestError | null>(null);
  const [pending, setPending] = useState(false);
  const hydrated = useHydrated();

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const email = formText(form, "email").trim();
    const name = formText(form, "name").trim();
    setPending(true);
    setError(null);

    // 先問 SSO：網域歸公司 IdP 管的人直接導過去，跟登入頁一模一樣（plugin 對
    // 沒有帳號的人會在 IdP 回來時建 user）。查詢失敗不擋路，交給下一步——
    // 伺服器的 hooks 會再擋一次 SSO 網域，回 SSO_REQUIRED。
    const lookup: SsoLookupResult = await authClient.signIn
      .sso({ email, callbackURL: redirectTo })
      .then(({ error: lookupError }) => (lookupError ? { status: lookupError.status } : null))
      .catch(() => ({}));
    if (afterSsoLookup(lookup).step === "redirecting") return; // 正在導去 IdP，不重設 pending。

    let outcome: EmailRequestError | null;
    try {
      // 三個網址都先過 survivesExtraDecode：better-auth 的 /magic-link/verify 會對
      // 它們多做一次 decodeURIComponent，不處理的話 MCP authorize 的 query 會被解壞
      // （細節見 redirect-target.ts）。
      const { error: requestError } = await authClient.signIn.magicLink({
        email,
        name,
        // 這個 email 早就有帳號：點連結就是登入，直接回原本要去的地方。
        callbackURL: survivesExtraDecode(redirectTo),
        // 新帳號：先去設密碼，設完再回原本要去的地方。
        newUserCallbackURL: survivesExtraDecode(
          `/signup/password?redirect=${encodeURIComponent(redirectTo)}`,
        ),
        // 連結過期或用過：回登入頁顯示說明，並保留原本的 query。
        errorCallbackURL: survivesExtraDecode(loginHref),
      });
      outcome = emailRequestError(requestError);
    } catch {
      // better-fetch 只把 HTTP 錯誤包成 { error }；網路錯誤會直接丟例外。
      outcome = "network";
    }
    setPending(false);
    if (outcome) {
      setError(outcome);
      return;
    }
    // 不管這個 email 原本有沒有帳號，畫面都一樣——差別只寫在信裡（auth-emails.ts）。
    setSentTo(email);
  }

  if (sentTo) {
    return (
      <AuthCard title={t("sent.title")}>
        <div className="space-y-4">
          <p className="text-sm">{t("sent.body", { email: sentTo })}</p>
          <p className="text-sm text-muted-foreground">{t("sent.hint")}</p>
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <Button
              type="button"
              variant="link"
              size="sm"
              className="h-auto p-0"
              onClick={() => setSentTo(null)}
            >
              {t("sent.retry")}
            </Button>
            <Link href={loginHref} className="text-muted-foreground underline-offset-4 hover:underline">
              {ts("backToLogin")}
            </Link>
          </div>
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
        <div className="space-y-1.5">
          <Label htmlFor="name">{t("nameLabel")}</Label>
          <Input
            id="name"
            name="name"
            type="text"
            autoComplete="name"
            required
            placeholder={t("namePlaceholder")}
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
            {t("haveAccount")}
          </Link>
        </div>
      </form>
    </AuthCard>
  );
}

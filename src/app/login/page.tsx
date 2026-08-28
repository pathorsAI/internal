"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { KeyRound } from "lucide-react";
import { authClient, signIn } from "@/lib/auth-client";
import { LogoMark } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

function GoogleIcon() {
  return (
    <svg className="size-4" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.76h3.56c2.08-1.92 3.28-4.74 3.28-8.09Z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.56-2.76c-.98.66-2.23 1.06-3.72 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84Z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.06l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38Z"
      />
    </svg>
  );
}

// When better-auth's MCP plugin sends an unauthenticated user here, it appends
// the original OAuth query (client_id, redirect_uri, code_challenge, …). After
// sign-in we must return to the authorize endpoint so the flow can issue a code.
function mcpAuthorizeCallback(params: URLSearchParams): string | null {
  if (!params.get("client_id") || params.get("response_type") !== "code") {
    return null;
  }
  return `/api/auth/mcp/authorize?${params.toString()}`;
}

function SignInMethods() {
  const t = useTranslations("auth.login");
  const params = useSearchParams();
  // ⚠️ 三種登入方式共用同一個 redirectTo。MCP 的 authorize query 只要有一條路徑
  // 沒接上，ChatGPT / Claude / Codex 的 OAuth 流程就會在登入後斷在這裡。
  const redirectTo = mcpAuthorizeCallback(params) || params.get("redirect") || "/dashboard";
  // 帳密表單常駐在最上面（目錄審核帳號與自架者的主要入口，打開就能填）；
  // SSO 要另外收一個公司 email，所以維持「點了才展開」，展開時把 email 欄叫出來。
  const [ssoOpen, setSsoOpen] = useState(false);
  const [pending, setPending] = useState(false);

  async function onGoogle() {
    setPending(true);
    const { error } = await signIn.social({
      provider: "google",
      callbackURL: redirectTo,
    });
    if (error) {
      setPending(false);
      toast.error(error.message || t("toast.failed"));
    }
    // On success the browser is redirected to Google, so no need to reset.
  }

  async function onSso(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const emailEntry = form.get("ssoEmail");
    const email = typeof emailEntry === "string" ? emailEntry.trim() : "";
    setPending(true);
    const { error } = await authClient.signIn.sso({ email, callbackURL: redirectTo });
    if (error) {
      setPending(false);
      // plugin 對「這個網域沒有註冊 IdP」回的是 404 "No provider found for the
      // issuer" —— 直接顯示那句話對使用者毫無意義，換成看得懂的說法。
      toast.error(
        error.status === 404 ? t("toast.ssoNotConfigured") : error.message || t("toast.failed"),
      );
    }
    // 成功時 better-auth 的 client 會自己導去 IdP，不必重設 pending。
  }

  async function onPassword(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const emailEntry = form.get("email");
    const passwordEntry = form.get("password");
    const email = typeof emailEntry === "string" ? emailEntry.trim() : "";
    const password = typeof passwordEntry === "string" ? passwordEntry : "";
    setPending(true);
    // ⚠️ 不能傳 callbackURL。better-auth 的 email 登入是走 fetch，帶 callbackURL
    // 時伺服器會回 302，fetch 自動跟著 redirect 一路走；當 callbackURL 是 MCP 的
    // /api/auth/mcp/authorize（ChatGPT / Claude / Codex 的授權入口）時，它下一跳
    // 會 302 到 claude.ai/api/mcp/auth_callback（跨網域），fetch 撞 CORS 直接
    // Failed to fetch，按鈕永遠卡在 submitting、OAuth 斷掉。Google / SSO 沒這問題
    // 是因為它們走整頁跳轉。所以這裡只用 email 登入「建立 session」，成功後由我們
    // 自己做整頁導頁——top-level navigation 跟著 302 到 claude.ai 不受 CORS 限制。
    const { error } = await signIn.email({ email, password });
    if (error) {
      setPending(false);
      // 401 一律講「email 或密碼不正確」，不區分哪一個錯 —— 分開講就成了帳號探測。
      toast.error(
        error.status === 401 ? t("toast.badCredentials") : error.message || t("toast.failed"),
      );
      return;
    }
    // session 已建立，整頁導去 redirectTo（可能是 MCP authorize，會再 302 去 claude.ai）。
    globalThis.location.href = redirectTo;
  }

  return (
    <div className="space-y-4">
      {/* 主要入口：email + 密碼，常駐可見，打開即可填。 */}
      <form onSubmit={onPassword} className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="email">{t("password.emailLabel")}</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            placeholder={t("password.emailPlaceholder")}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="password">{t("password.passwordLabel")}</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
          />
        </div>
        <Button type="submit" className="w-full" disabled={pending}>
          {pending ? t("password.submitting") : t("password.submit")}
        </Button>
      </form>

      <div className="flex items-center gap-3">
        <span className="h-px flex-1 bg-border" />
        <span className="text-xs text-muted-foreground">{t("or")}</span>
        <span className="h-px flex-1 bg-border" />
      </div>

      {/* 次要方式：Google 與 SSO。 */}
      <div className="space-y-3">
        <Button
          type="button"
          variant="outline"
          className="w-full"
          onClick={onGoogle}
          disabled={pending}
        >
          <GoogleIcon />
          {t("signInWithGoogle")}
        </Button>

        {ssoOpen ? (
          <form onSubmit={onSso} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="ssoEmail">{t("sso.emailLabel")}</Label>
              <Input
                id="ssoEmail"
                name="ssoEmail"
                type="email"
                autoComplete="email"
                required
                autoFocus
                placeholder={t("sso.emailPlaceholder")}
              />
            </div>
            <Button type="submit" className="w-full" disabled={pending}>
              {pending ? t("sso.submitting") : t("sso.submit")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full"
              onClick={() => setSsoOpen(false)}
              disabled={pending}
            >
              {t("sso.cancel")}
            </Button>
          </form>
        ) : (
          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={() => setSsoOpen(true)}
            disabled={pending}
          >
            <KeyRound className="size-4" />
            {t("sso.button")}
          </Button>
        )}
      </div>
    </div>
  );
}

export default function LoginPage() {
  const t = useTranslations("auth.login");
  return (
    <div className="flex min-h-full flex-1 items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <LogoMark className="size-10 mb-2" />
          <CardTitle>{t("title")}</CardTitle>
          <CardDescription>{t("description")}</CardDescription>
        </CardHeader>
        <CardContent>
          <Suspense fallback={null}>
            <SignInMethods />
          </Suspense>
        </CardContent>
      </Card>
    </div>
  );
}

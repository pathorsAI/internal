"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { AuthCard } from "@/components/auth/auth-card";
import { formText } from "@/components/auth/form-text";
import { NewPasswordFields } from "@/components/auth/new-password-fields";
import { Button } from "@/components/ui/button";
import { useHydrated } from "@/hooks/use-hydrated";
import { checkNewPassword, type NewPasswordProblem } from "@/lib/password-policy";
import { setInitialPassword } from "./actions";

/** `redirectTo` 已經在 server 端過了 sanitizeRedirect。 */
export function SetPasswordForm({ redirectTo }: Readonly<{ redirectTo: string }>) {
  const t = useTranslations("auth.setPassword");
  const [problem, setProblem] = useState<NewPasswordProblem>(null);
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState(false);
  const hydrated = useHydrated();

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const newPassword = formText(form, "password");
    const check = checkNewPassword(newPassword, formText(form, "confirm"));
    setProblem(check);
    setFailed(false);
    if (check) return;

    setPending(true);
    const result = await setInitialPassword(newPassword).catch(
      () => ({ ok: false, code: "NETWORK" }) as const,
    );
    // PASSWORD_ALREADY_SET：同一個帳號在另一個分頁先設好了，目的已經達成，照常往下走。
    if (result.ok || result.code === "PASSWORD_ALREADY_SET") {
      // ⚠️ 整頁導頁，不用 router.push：redirectTo 可能是 MCP 的
      // /api/auth/mcp/authorize，它會 302 到 claude.ai 之類的外站。client 端的
      // router 走 fetch，跟著跨網域 302 會撞 CORS（同樣的問題見 login/page.tsx
      // 密碼登入那段）；top-level navigation 不受這個限制。
      globalThis.location.href = redirectTo;
      return;
    }
    // session 不見了（過期、在別處登出）：回登入頁，不然再按幾次都一樣。
    if (result.code === "UNAUTHORIZED") {
      globalThis.location.href = "/login";
      return;
    }
    setPending(false);
    setFailed(true);
  }

  return (
    <AuthCard title={t("title")} description={t("description")}>
      <form method="post" onSubmit={onSubmit} className="space-y-3">
        <NewPasswordFields problem={problem} />
        {failed && (
          <p role="alert" className="text-sm text-destructive">
            {t("failed")}
          </p>
        )}
        <Button type="submit" className="w-full" disabled={pending || !hydrated}>
          {pending ? t("submitting") : t("submit")}
        </Button>
      </form>
    </AuthCard>
  );
}

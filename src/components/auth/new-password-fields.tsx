"use client";

import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MIN_PASSWORD_LENGTH, type NewPasswordProblem } from "@/lib/password-policy";

/**
 * 新密碼 + 確認密碼兩個欄位，/reset-password 與 /signup/password 共用。
 *
 * minLength 讓瀏覽器在 hydration 前也有基本檢查；真正的判斷在送出時跑
 * checkNewPassword（瀏覽器的 minLength 不檢查「兩次一樣」），結果用 `problem`
 * 傳回來顯示。autoComplete="new-password" 讓密碼管理器提議產生一組新的。
 */
export function NewPasswordFields({ problem }: Readonly<{ problem: NewPasswordProblem }>) {
  const t = useTranslations("auth.passwordForm");
  return (
    <>
      <div className="space-y-1.5">
        <Label htmlFor="password">{t("password")}</Label>
        <Input
          className="h-11"
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={MIN_PASSWORD_LENGTH}
          required
          autoFocus
          aria-describedby="password-hint"
        />
        <p id="password-hint" className="text-xs text-muted-foreground">
          {t("hint", { min: MIN_PASSWORD_LENGTH })}
        </p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="confirm">{t("confirm")}</Label>
        <Input
          className="h-11"
          id="confirm"
          name="confirm"
          type="password"
          autoComplete="new-password"
          minLength={MIN_PASSWORD_LENGTH}
          required
        />
      </div>
      {problem && (
        <p role="alert" className="text-sm text-destructive">
          {t(problem, { min: MIN_PASSWORD_LENGTH })}
        </p>
      )}
    </>
  );
}

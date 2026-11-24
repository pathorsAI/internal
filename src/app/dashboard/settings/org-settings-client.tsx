"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { Building2 } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { GlowButton } from "@/components/ds/glow-button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/form-field";
import { PartyAvatar } from "@/components/party-avatar";
import { AvatarUploadField, avatarFieldLabels, type AvatarMode } from "@/components/avatar-upload-field";
import { saveOrgLogo } from "./actions";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/**
 * 組織名稱與角色一律由 server 傳進來，這裡不再用 useActiveOrganization() /
 * useActiveMember() 取。
 *
 * 原本用 client hook 有三個連帶問題，都源自同一件事 —— SSR 時 better-auth 的
 * client store 是空的，hydration 時卻可能已經被 sidebar 的組織切換器填好了：
 *
 * 1. hydration mismatch（React #418）：伺服器渲染「載入中」，客戶端第一次渲染
 *    卻是完整卡片。
 * 2. 載入那幾秒 `activeMember` 還是 null，擁有者會看到「只有擁有者或管理員可以
 *    修改組織資料」、欄位變灰 —— 看起來像權限壞掉。
 * 3. 卡片高度在載入前後差 80px 左右，資料一到整頁往下跳，把下面那張卡的按鈕擠走。
 *
 * 這一頁本來就是 server component，orgId / 名稱 / 角色都拿得到，沒有理由繞一圈
 * 從客戶端再要一次。
 */
export function OrgSettingsClient({
  orgId,
  orgName,
  orgLogo,
  canEdit,
}: Readonly<{ orgId: string; orgName: string; orgLogo: string | null; canEdit: boolean }>) {
  const t = useTranslations("settings");
  const tLogo = useTranslations("settings.org.logo");
  const router = useRouter();
  // logo 欄位：mode 給「儲存」按鈕判斷有沒有變更；存檔成功換 fieldKey 讓欄位重掛回 keep。
  const [logoMode, setLogoMode] = useState<AvatarMode>("keep");
  const [fieldKey, setFieldKey] = useState(0);
  // 目前的 logo：存檔後直接換成回傳的新網址。不能只靠 router.refresh() 帶回新的 orgLogo prop ——
  // 欄位在那之前就重掛了，會先畫回舊值（原本沒有 logo 就是字母頭像）。
  const [logo, setLogo] = useState(orgLogo);

  // `draft` 在使用者真的打字前都是 null，欄位只是「顯示」server 傳來的名稱。
  // 存檔後清掉 draft，就會自動同步成伺服器回來的值。
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const name = draft ?? orgName;

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const value = name.trim();
    if (!value) {
      toast.error(t("org.toast.nameRequired"));
      return;
    }
    const nameChanged = value !== orgName;
    if (!nameChanged && logoMode === "keep") return;
    setSaving(true);
    try {
      if (nameChanged) {
        const { error } = await authClient.organization.update({
          organizationId: orgId,
          data: { name: value },
        });
        if (error) {
          toast.error(error.message || t("org.toast.updateFailed"));
          return;
        }
      }
      if (logoMode !== "keep") {
        const res = await saveOrgLogo(new FormData(e.currentTarget));
        if (res.ok && res.url !== undefined) setLogo(res.url);
        if (!res.ok) {
          toast.error(res.error ?? t("org.toast.updateFailed"));
          return;
        }
      }
      toast.success(t("org.toast.updated"));
      setDraft(null);
      setLogoMode("keep");
      setFieldKey((k) => k + 1);
      // 側欄的組織切換器吃 better-auth 的組織清單，叫它重抓才會換上新 logo
      authClient.$store.notify("$listOrg");
      authClient.$store.notify("$activeOrgSignal");
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Building2 className="size-5 text-muted-foreground" />
          {t("org.title")}
        </CardTitle>
        <CardDescription>
          {canEdit ? t("org.descriptionEditable") : t("org.descriptionReadOnly")}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="max-w-md space-y-4">
          <Field label={t("org.logoLabel")}>
            <AvatarUploadField
              key={fieldKey}
              hasCurrent={Boolean(logo)}
              disabled={!canEdit || saving}
              onModeChange={setLogoMode}
              labels={avatarFieldLabels((k) => tLogo(k as never))}
              renderAvatar={({ mode, src }) => (
                <PartyAvatar name={orgName} size="lg" src={src ?? (mode === "keep" ? logo : null)} />
              )}
            />
          </Field>
          <Field label={t("org.nameLabel")} htmlFor="org-name">
            <Input
              id="org-name"
              value={name}
              onChange={(e) => setDraft(e.target.value)}
              disabled={!canEdit || saving}
              required
            />
          </Field>
          {canEdit && (
            <GlowButton type="submit" disabled={saving || (name.trim() === orgName && logoMode === "keep")}>
              {saving ? t("org.saving") : t("org.save")}
            </GlowButton>
          )}
        </form>
      </CardContent>
    </Card>
  );
}

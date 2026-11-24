"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { UserRound } from "lucide-react";
import { authClient } from "@/lib/auth-client";
import { GlowButton } from "@/components/ds/glow-button";
import { PartyAvatar } from "@/components/party-avatar";
import { AvatarUploadField, avatarFieldLabels, type AvatarMode } from "@/components/avatar-upload-field";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { saveMyAvatar } from "./actions";

export function AccountClient({
  name,
  email,
  image,
}: Readonly<{ name: string; email: string; image: string | null }>) {
  const t = useTranslations("account");
  const tAvatar = useTranslations("account.avatar");
  const router = useRouter();
  const [mode, setMode] = useState<AvatarMode>("keep");
  const [fieldKey, setFieldKey] = useState(0);
  // 存檔後直接換成回傳的新網址，不等 router.refresh() 帶回新的 image prop（見 org-settings-client）
  const [current, setCurrent] = useState(image);
  const [saving, setSaving] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (mode === "keep") return;
    setSaving(true);
    try {
      const res = await saveMyAvatar(new FormData(e.currentTarget));
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      if (res.url !== undefined) setCurrent(res.url);
      toast.success(mode === "remove" ? t("toast.removed") : t("toast.updated"));
      setMode("keep");
      setFieldKey((k) => k + 1);
      // 左下角使用者選單吃 better-auth 的 session，叫它重抓才會換上新頭像
      authClient.$store.notify("$sessionSignal");
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <UserRound className="size-5 text-muted-foreground" />
          {t("profile.title")}
        </CardTitle>
        <CardDescription>{t("profile.description")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-5">
          <AvatarUploadField
            key={fieldKey}
            hasCurrent={Boolean(current)}
            disabled={saving}
            onModeChange={setMode}
            labels={avatarFieldLabels((k) => tAvatar(k as never))}
            renderAvatar={({ mode: m, src }) => (
              <PartyAvatar name={name} size="lg" className="rounded-full" src={src ?? (m === "keep" ? current : null)} />
            )}
          />
          <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-sm">
            <dt className="text-muted-foreground">{t("profile.nameLabel")}</dt>
            <dd className="min-w-0 truncate">{name}</dd>
            <dt className="text-muted-foreground">{t("profile.emailLabel")}</dt>
            <dd className="min-w-0 truncate">{email}</dd>
          </dl>
          <GlowButton type="submit" disabled={saving || mode === "keep"}>
            {saving ? t("saving") : t("save")}
          </GlowButton>
        </form>
      </CardContent>
    </Card>
  );
}

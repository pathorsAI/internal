"use client";

import { useTranslations } from "next-intl";
import { PartyAvatar } from "@/components/party-avatar";
import { AvatarUploadField, avatarFieldLabels } from "@/components/avatar-upload-field";

/**
 * 編輯交易對象表單最上面的頭像欄位。選檔、縮圖、預覽都在共用的 AvatarUploadField；
 * 按「儲存變更」時 updateParty 讀 avatarAction / avatar 兩個欄位。
 */
export function PartyAvatarField({
  partyId,
  name,
  avatarVersion,
}: Readonly<{ partyId: number; name: string; avatarVersion: string | null }>) {
  const t = useTranslations("parties.avatar");
  return (
    <AvatarUploadField
      className="sm:col-span-2"
      hasCurrent={Boolean(avatarVersion)}
      labels={avatarFieldLabels((k) => t(k as never))}
      renderAvatar={({ mode, src }) => (
        <PartyAvatar
          name={name}
          size="lg"
          partyId={mode === "keep" ? partyId : null}
          avatarVersion={mode === "keep" ? avatarVersion : null}
          src={src}
        />
      )}
    />
  );
}

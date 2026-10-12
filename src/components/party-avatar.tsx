"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { avatarColorClass, avatarInitial, partyAvatarUrl } from "@/lib/party-avatar";
import { cn } from "@/lib/utils";

const SIZE_CLASS = {
  sm: "size-5",
  md: "size-7",
  lg: "size-14",
} as const;
const TEXT_CLASS: Record<keyof typeof SIZE_CLASS, string> = {
  sm: "text-[10px]",
  md: "text-xs",
  lg: "text-xl",
};

/**
 * 交易對象頭像。有上傳圖就顯示圖（圓角方形 —— logo 多半是方的，切成圓形會切掉字），
 * 沒有或載入失敗就顯示首字 + 依名稱決定的底色（同一個名稱在哪裡都是同一個顏色）。
 *
 * - `partyId` + `avatarVersion`：組出 /api/parties/<id>/avatar?v=<version>；version 為 null = 沒有頭像。
 * - `src`：直接給網址（上傳前的 blob: 預覽用），優先於 partyId。
 */
export function PartyAvatar({
  name,
  partyId,
  avatarVersion,
  src,
  size = "md",
  className,
}: Readonly<{
  name: string;
  partyId?: number | null;
  avatarVersion?: string | null;
  src?: string | null;
  size?: keyof typeof SIZE_CLASS;
  className?: string;
}>) {
  const url = src ?? (partyId == null ? null : partyAvatarUrl(partyId, avatarVersion));
  return (
    <Avatar
      // key：換圖時讓 Radix 重新走一次載入狀態，不會先閃一下舊的 fallback 判斷
      key={url ?? "fallback"}
      // 圓角用百分比：這個主題的 --radius 很大，rounded-md 套在小頭像上會變成圓形
      className={cn("rounded-[25%] border border-border/60 bg-background", SIZE_CLASS[size], className)}
      aria-hidden
    >
      {url ? <AvatarImage src={url} alt="" className="object-cover" /> : null}
      <AvatarFallback
        className={cn(
          "rounded-[inherit] font-semibold leading-none",
          TEXT_CLASS[size],
          avatarColorClass(name),
        )}
      >
        {avatarInitial(name)}
      </AvatarFallback>
    </Avatar>
  );
}

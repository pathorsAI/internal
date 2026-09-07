"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { authClient, useListOrganizations } from "@/lib/auth-client";
import { useRefreshPending } from "@/components/refresh-pending";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/** 由 server layout 一次撈好丟進來的組織，形狀要能序列化。 */
export type OrgOption = {
  id: string;
  name: string;
  slug: string;
};

/**
 * 側邊欄的組織切換器。
 *
 * 初始資料一律來自 server layout（session 本來就知道 active org，不必等 client fetch），
 * client hook 只負責在首次繪製之後把清單保持新鮮 —— 這樣就不會再出現「一開始是空的、
 * 而且還 disabled」那一瞬間。選擇後先樂觀更新本地的 selectedId，畫面立刻換成新組織，
 * 真正的 setActive + router.refresh() 在背景跑，期間由 RefreshPendingOverlay 給回饋。
 */
export function OrgSwitcher({
  initialOrganizations,
  initialActiveOrgId,
}: Readonly<{
  initialOrganizations: OrgOption[];
  initialActiveOrgId: string | null;
}>) {
  const t = useTranslations("common");
  const router = useRouter();
  const { data: organizations } = useListOrganizations();
  const [selectedId, setSelectedId] = useState(initialActiveOrgId ?? "");
  // transition 開在 RefreshPendingProvider，這樣 pending 會一路撐到 router.refresh()
  // 帶回新組織的畫面為止，主內容區才有辦法在整段等待期間給回饋。
  const { pending, startPending } = useRefreshPending();

  // hook 還沒回來之前用 server 給的清單；回來之後才換成最新的（有人新建組織就會更新）。
  const orgs: OrgOption[] = organizations ?? initialOrganizations;

  function onChange(organizationId: string) {
    if (!organizationId || organizationId === selectedId) return;
    const previousId = selectedId;
    // 先樂觀切過去：下拉選單立刻顯示新組織，不用等 setActive 回來。
    setSelectedId(organizationId);
    startPending(async () => {
      const { error } = await authClient.organization.setActive({ organizationId });
      if (error) {
        setSelectedId(previousId);
        toast.error(error.message || t("orgSwitcher.toast.switchFailed"));
        return;
      }
      // force-dynamic 的頁面要重新由 server 產出才會換成新組織的資料。
      router.refresh();
    });
  }

  // 真的什麼都還不知道時才給骨架；只要拿得到組織名稱就不該顯示空的下拉選單。
  if (orgs.length === 0 && !selectedId) {
    return <Skeleton className="h-9 w-full" />;
  }

  return (
    <Select value={selectedId} onValueChange={onChange} disabled={pending}>
      <SelectTrigger className="w-full" size="default">
        {pending ? (
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        ) : (
          <Building2 className="size-4 text-muted-foreground" />
        )}
        <SelectValue placeholder={t("orgSwitcher.placeholder")} />
      </SelectTrigger>
      <SelectContent>
        {orgs.map((o) => (
          <SelectItem key={o.id} value={o.id}>
            {o.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

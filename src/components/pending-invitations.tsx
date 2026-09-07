"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate } from "@/lib/format";

export type UserInvite = {
  id: string;
  organizationId: string;
  organizationName: string;
  role: string;
  expiresAt: string | Date;
};

export type UserInvitations = {
  invites: UserInvite[];
  acceptable: UserInvite[];
  expired: UserInvite[];
  loading: boolean;
  refresh: () => Promise<void>;
};

/**
 * 這位使用者收到、還沒處理的組織邀請。
 *
 * listUserInvitations 只 filter status === "pending"，不管 expiresAt，而過期的邀請在 DB 裡
 * status 仍然是 pending。所以後端回來的清單裡可能夾著一按就必定失敗（INVITATION_NOT_FOUND，
 * 訊息看起來像「找不到邀請」）的邀請，得在前端自己分開。
 *
 * 只在 mount 時取一次，另外把 refresh() 交出去讓呼叫端自己決定何時重取（例如選單打開時），
 * 不做持續輪詢。
 */
export function useUserInvitations(): UserInvitations {
  const [invites, setInvites] = useState<UserInvite[]>([]);
  const [loading, setLoading] = useState(true);
  // 取清單的當下記一次「現在」：在 render 裡直接讀 Date.now() 是不純的，而邀請的到期
  // 是以天為單位，不需要跟著時間跳動。
  const [now, setNow] = useState(() => Date.now());

  const refresh = useCallback(async () => {
    const { data, error } = await authClient.organization.listUserInvitations();
    setInvites(!error && data ? (data as unknown as UserInvite[]) : []);
    setNow(Date.now());
    setLoading(false);
  }, []);

  useEffect(() => {
    (async () => {
      await refresh();
    })();
  }, [refresh]);

  return useMemo(() => {
    const isExpired = (inv: UserInvite) => new Date(inv.expiresAt).getTime() < now;
    return {
      invites,
      acceptable: invites.filter((i) => !isExpired(i)),
      expired: invites.filter(isExpired),
      loading,
      refresh,
    };
  }, [invites, loading, now, refresh]);
}

/**
 * 邀請清單本體（onboarding 與 user menu 的邀請對話框共用）。
 * 資料由呼叫端用 useUserInvitations() 取好傳進來，避免同一頁重複請求。
 */
export function PendingInvitations({
  invitations,
  onAccepted,
}: Readonly<{
  invitations: UserInvitations;
  /** 接受成功、準備跳轉前呼叫（例如關掉對話框）。 */
  onAccepted?: () => void;
}>) {
  const t = useTranslations("auth.invites");
  const router = useRouter();
  const { acceptable, expired, loading, refresh } = invitations;
  const [busyId, setBusyId] = useState<string | null>(null);

  async function onAccept(inv: UserInvite) {
    setBusyId(inv.id);
    const { error } = await authClient.organization.acceptInvitation({
      invitationId: inv.id,
    });
    if (error) {
      setBusyId(null);
      toast.error(error.message || t("toast.acceptFailed"));
      return;
    }
    toast.success(t("toast.joined", { name: inv.organizationName }));
    onAccepted?.();
    await authClient.organization.setActive({ organizationId: inv.organizationId });
    router.push("/dashboard");
    router.refresh();
  }

  async function onDecline(inv: UserInvite) {
    setBusyId(inv.id);
    const { error } = await authClient.organization.rejectInvitation({
      invitationId: inv.id,
    });
    setBusyId(null);
    if (error) {
      toast.error(error.message || t("toast.declineFailed"));
      return;
    }
    toast.success(t("toast.declined", { name: inv.organizationName }));
    await refresh();
  }

  if (loading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
      </div>
    );
  }

  if (acceptable.length === 0 && expired.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("empty")}</p>;
  }

  return (
    <div className="space-y-2">
      {acceptable.map((inv) => (
        <div
          key={inv.id}
          className="flex items-center justify-between gap-3 rounded-md border px-3 py-2"
        >
          <div className="min-w-0">
            <div className="truncate font-medium">{inv.organizationName}</div>
            <div className="text-xs text-muted-foreground">
              {t("role", { role: inv.role })} ·{" "}
              {t("expiresAt", { date: formatDate(inv.expiresAt) })}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onDecline(inv)}
              disabled={busyId !== null}
            >
              {t("decline")}
            </Button>
            <Button size="sm" onClick={() => onAccept(inv)} disabled={busyId !== null}>
              {busyId === inv.id ? t("accepting") : t("accept")}
            </Button>
          </div>
        </div>
      ))}
      {/* 過期的只顯示、不給按鈕 —— 接受一定會失敗，給按鈕只是騙人。 */}
      {expired.map((inv) => (
        <div
          key={inv.id}
          className="flex items-center justify-between gap-3 rounded-md border border-dashed px-3 py-2 opacity-60"
        >
          <div className="min-w-0">
            <div className="truncate font-medium text-muted-foreground">
              {inv.organizationName}
            </div>
            <div className="text-xs text-muted-foreground">{t("expiredHint")}</div>
          </div>
          <span className="shrink-0 text-xs text-muted-foreground">{t("expired")}</span>
        </div>
      ))}
    </div>
  );
}

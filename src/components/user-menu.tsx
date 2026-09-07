"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronsUpDown, LogOut, MailCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { signOut, useActiveOrganization, useSession } from "@/lib/auth-client";
import {
  PendingInvitations,
  useUserInvitations,
} from "@/components/pending-invitations";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

/**
 * 側邊欄底部的使用者選單。
 *
 * 之前這顆按鈕按下去就直接登出 —— 沒有選單、也沒有確認，手滑一次就掉出去。改成
 * DropdownMenu 之後登出變成要先開選單再選，同時多了一個到得了的邀請入口：待處理的
 * 邀請本來只有 /onboarding 看得到，而那頁只有「還沒有任何組織」的人進得去。
 */
export function UserMenu() {
  const t = useTranslations("common");
  const router = useRouter();
  const { data: session } = useSession();
  const { data: activeOrg } = useActiveOrganization();
  const invitations = useUserInvitations();
  const [invitesOpen, setInvitesOpen] = useState(false);
  const user = session?.user;
  const pendingCount = invitations.acceptable.length;

  async function onSignOut() {
    await signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu
          onOpenChange={(open) => {
            // 選單打開時順手重取一次，不做持續輪詢。
            if (open) void invitations.refresh();
          }}
        >
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton size="lg">
              <div className="relative bg-muted flex aspect-square size-8 items-center justify-center rounded-lg text-xs font-medium">
                {user?.name?.[0]?.toUpperCase() ?? "?"}
                {pendingCount > 0 ? (
                  <span
                    aria-hidden
                    className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full bg-primary ring-2 ring-sidebar"
                  />
                ) : null}
              </div>
              <div className="flex flex-1 flex-col gap-0.5 overflow-hidden text-left leading-none">
                <span className="truncate font-medium">
                  {user?.name ?? t("userMenu.notSignedIn")}
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {user?.email ?? ""}
                </span>
              </div>
              <ChevronsUpDown className="size-4 text-muted-foreground" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>

          <DropdownMenuContent align="start" side="top" className="min-w-56">
            <DropdownMenuLabel className="font-normal">
              <div className="flex flex-col gap-0.5">
                <span className="truncate text-sm font-medium">
                  {user?.name ?? t("userMenu.notSignedIn")}
                </span>
                <span className="truncate text-xs text-muted-foreground">
                  {user?.email ?? ""}
                </span>
                {activeOrg?.name ? (
                  <span className="truncate text-xs text-muted-foreground">
                    {t("userMenu.currentOrg", { name: activeOrg.name })}
                  </span>
                ) : null}
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => setInvitesOpen(true)}>
              <MailCheck className="size-4" />
              <span className="flex-1">{t("userMenu.invitations")}</span>
              {pendingCount > 0 ? (
                <Badge className="h-5 min-w-5 px-1.5">{pendingCount}</Badge>
              ) : null}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={onSignOut}>
              <LogOut className="size-4" />
              {t("userMenu.signOut")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Dialog open={invitesOpen} onOpenChange={setInvitesOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{t("userMenu.invitationsTitle")}</DialogTitle>
              <DialogDescription>
                {t("userMenu.invitationsDescription")}
              </DialogDescription>
            </DialogHeader>
            <PendingInvitations
              invitations={invitations}
              onAccepted={() => setInvitesOpen(false)}
            />
          </DialogContent>
        </Dialog>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

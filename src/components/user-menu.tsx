"use client";

import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { signOut, useSession } from "@/lib/auth-client";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

export function UserMenu() {
  const router = useRouter();
  const { data: session } = useSession();
  const user = session?.user;

  async function onSignOut() {
    await signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton size="lg" onClick={onSignOut} title="登出">
          <div className="bg-muted flex aspect-square size-8 items-center justify-center rounded-lg text-xs font-medium">
            {user?.name?.[0]?.toUpperCase() ?? "?"}
          </div>
          <div className="flex flex-1 flex-col gap-0.5 leading-none">
            <span className="font-medium">{user?.name ?? "未登入"}</span>
            <span className="text-xs text-muted-foreground">
              {user?.email ?? ""}
            </span>
          </div>
          <LogOut className="size-4 text-muted-foreground" />
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

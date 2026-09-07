import { headers } from "next/headers";
import { AppSidebar } from "@/components/app-sidebar";
import { HeaderBreadcrumb } from "@/components/header-breadcrumb";
import type { OrgOption } from "@/components/org-switcher";
import {
  RefreshPendingOverlay,
  RefreshPendingProvider,
} from "@/components/refresh-pending";
import { Separator } from "@/components/ui/separator";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { auth } from "@/lib/auth";
import { getSession } from "@/lib/session";

export default async function DashboardLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // 側邊欄的組織切換器需要的資料在這裡一次撈好。session 本來就帶著 active org，
  // 組織清單也只是一次查詢 —— 交給 client hook 現抓的話，第一次繪製只會是一個
  // 空白又不能按的下拉選單。這裡不擋權限（各頁自己 requireOrg()），撈不到就給空的。
  const reqHeaders = await headers();
  const session = await getSession();
  const organizations = session
    ? ((await auth.api.listOrganizations({ headers: reqHeaders })) ?? [])
    : [];
  const initialOrganizations: OrgOption[] = organizations.map((o) => ({
    id: o.id,
    name: o.name,
    slug: o.slug,
  }));
  const initialActiveOrgId = session?.session.activeOrganizationId ?? null;

  return (
    <RefreshPendingProvider>
      <SidebarProvider>
        <AppSidebar
          initialOrganizations={initialOrganizations}
          initialActiveOrgId={initialActiveOrgId}
        />
        <SidebarInset>
          <header className="sticky top-0 z-20 flex h-16 shrink-0 items-center gap-2 border-b bg-background px-4">
            <SidebarTrigger className="-ml-1" />
            <Separator
              orientation="vertical"
              className="mr-2 data-[orientation=vertical]:h-4"
            />
            <HeaderBreadcrumb />
          </header>
          <RefreshPendingOverlay className="flex min-w-0 flex-1 flex-col gap-6 p-6">
            {children}
          </RefreshPendingOverlay>
        </SidebarInset>
      </SidebarProvider>
    </RefreshPendingProvider>
  );
}

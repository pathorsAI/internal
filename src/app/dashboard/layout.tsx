import { headers } from "next/headers";
import { AiCommand } from "@/components/ai/ai-command";
import { AppSidebar } from "@/components/app-sidebar";
import { PageEnter } from "@/components/ds/page-enter";
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
import { getSession, resolveSessionOrgId } from "@/lib/session";
import { getDb } from "@/db";
import { countPendingLinks } from "@/lib/linking/pending";

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
    logo: o.logo ?? null,
  }));
  // 以使用者「目前的組織」為準（在別台裝置、LINE、MCP 切過也一樣），第一屏就畫對；
  // 與 session 不一致時 resolveSessionOrgId 會順手改 session。頁面的 requireOrg 用同一個值。
  const initialActiveOrgId = session ? await resolveSessionOrgId(session) : null;
  // 左下角使用者列第一屏就畫出本人，不等 client 端的 useSession 回來（否則會先閃「未登入」）
  const initialUser = session
    ? { name: session.user.name, email: session.user.email, image: session.user.image ?? null }
    : null;
  // 側欄「待連結」的筆數徽章。查不到（還沒 migrate、DB 暫時連不上）就不顯示，不擋整個版面。
  const pendingLinks = initialActiveOrgId
    ? await countPendingLinks(getDb(), initialActiveOrgId).catch(() => 0)
    : 0;

  return (
    <RefreshPendingProvider>
      <SidebarProvider>
        <AppSidebar
          initialOrganizations={initialOrganizations}
          initialActiveOrgId={initialActiveOrgId}
          initialUser={initialUser}
          badges={{ links: pendingLinks }}
        />
        {/* min-w-0：SidebarInset 是 flex 子項，沒有它寬表格會把整頁撐寬（表格應在自己的容器裡捲動） */}
        <SidebarInset className="min-w-0">
          <header className="sticky top-0 z-20 flex h-14 shrink-0 items-center gap-2 border-b bg-background/80 px-4 backdrop-blur-md">
            <SidebarTrigger className="-ml-1" />
            <Separator
              orientation="vertical"
              className="mr-2 data-[orientation=vertical]:h-4"
            />
            <HeaderBreadcrumb />
          </header>
          <RefreshPendingOverlay className="flex min-w-0 flex-1 flex-col p-6">
            <PageEnter className="flex min-w-0 flex-1 flex-col gap-6">{children}</PageEnter>
          </RefreshPendingOverlay>
        </SidebarInset>
        <AiCommand />
      </SidebarProvider>
    </RefreshPendingProvider>
  );
}

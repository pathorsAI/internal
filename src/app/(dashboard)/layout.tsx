import { AppSidebar } from "@/components/app-sidebar";
import { LogoMark } from "@/components/logo";
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-16 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger className="-ml-1" />
          <LogoMark className="size-6" />
          <span className="text-sm font-medium text-muted-foreground">
            內部管理後台
          </span>
        </header>
        <main className="flex min-w-0 flex-1 flex-col gap-6 p-6">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}

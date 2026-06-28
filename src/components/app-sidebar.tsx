"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  ArrowLeftRight,
  Landmark,
  Truck,
  Scale,
  Users,
  ReceiptText,
  BellRing,
  Tags,
  FolderKanban,
  Repeat,
  FileSignature,
  BarChart3,
  UserCog,
  Settings,
  Plug,
  History,
} from "lucide-react";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import { OrgSwitcher } from "@/components/org-switcher";
import { UserMenu } from "@/components/user-menu";
import { Logo } from "@/components/logo";

const nav = [
  { title: "總覽", href: "/", icon: LayoutDashboard },
  { title: "內外帳", href: "/transactions", icon: ArrowLeftRight },
  { title: "交易對象", href: "/parties", icon: Truck },
  { title: "分類", href: "/categories", icon: Tags },
  { title: "代墊", href: "/advances", icon: ReceiptText },
  { title: "待通知會計師", href: "/accountant-notices", icon: BellRing },
  { title: "銀行帳戶", href: "/bank-accounts", icon: Landmark },
  { title: "對帳", href: "/reconciliation", icon: Scale },
];

const clients = [
  { title: "專案", href: "/projects", icon: FolderKanban },
  { title: "訂閱 / 月費", href: "/subscriptions", icon: Repeat },
  { title: "合約", href: "/contracts", icon: FileSignature },
  { title: "報表", href: "/reports", icon: BarChart3 },
];

const hr = [
  { title: "員工", href: "/employees", icon: Users },
  { title: "薪資", href: "/payroll", icon: ReceiptText },
];

const org = [
  { title: "成員", href: "/members", icon: UserCog },
  { title: "操作紀錄", href: "/activity", icon: History },
  { title: "MCP", href: "/settings/mcp", icon: Plug },
  { title: "組織設定", href: "/settings", icon: Settings },
];

export function AppSidebar() {
  const pathname = usePathname();

  const isActive = (href: string) => {
    if (href === "/") return pathname === "/";
    // /settings is a prefix of /settings/mcp — match it exactly so only the
    // specific sub-page (e.g. MCP) highlights, not both.
    if (href === "/settings") return pathname === "/settings";
    return pathname.startsWith(href);
  };

  return (
    <Sidebar>
      <SidebarHeader>
        <Logo className="px-1 py-1.5" />
        <OrgSwitcher />
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>會計</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {nav.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    isActive={isActive(item.href)}
                    render={<Link href={item.href} />}
                  >
                    <item.icon />
                    <span>{item.title}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>客戶 / 營運</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {clients.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    isActive={isActive(item.href)}
                    render={<Link href={item.href} />}
                  >
                    <item.icon />
                    <span>{item.title}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>人事</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {hr.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    isActive={isActive(item.href)}
                    render={<Link href={item.href} />}
                  >
                    <item.icon />
                    <span>{item.title}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>組織</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {org.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    isActive={isActive(item.href)}
                    render={<Link href={item.href} />}
                  >
                    <item.icon />
                    <span>{item.title}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <UserMenu />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

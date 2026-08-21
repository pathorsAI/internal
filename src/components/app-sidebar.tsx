"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
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
  CalendarClock,
  Receipt,
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
import { LocaleSwitcher } from "@/components/locale-switcher";
import { Logo } from "@/components/logo";

// 每天都會開的兩頁放最上面。請款看板是收入循環的日常操作面 —— 請款、開票、
// 收款都在那一頁就地推進，不該埋在「客戶 / 營運」底下跟不常動的資源頁並列。
// title 改用 nav.items.<key> 在 component 內用 t() 查表，key/href/icon 留在 code。
/** 對應 common.nav.items 的鍵；header-breadcrumb 用同一組鍵維持頁名一致。 */
export type NavItemKey =
  | "dashboard"
  | "billing"
  | "transactions"
  | "parties"
  | "categories"
  | "advances"
  | "accountantNotices"
  | "bankAccounts"
  | "reconciliation"
  | "projects"
  | "subscriptions"
  | "contracts"
  | "invoices"
  | "reports"
  | "employees"
  | "payroll"
  | "members"
  | "activity"
  | "mcp"
  | "settings";

const daily = [
  { key: "dashboard", href: "/", icon: LayoutDashboard },
  { key: "billing", href: "/billing", icon: CalendarClock },
] as const satisfies { key: NavItemKey; href: string; icon: typeof LayoutDashboard }[];

const nav = [
  { key: "transactions", href: "/transactions", icon: ArrowLeftRight },
  { key: "parties", href: "/parties", icon: Truck },
  { key: "categories", href: "/categories", icon: Tags },
  { key: "advances", href: "/advances", icon: ReceiptText },
  { key: "accountantNotices", href: "/accountant-notices", icon: BellRing },
  { key: "bankAccounts", href: "/bank-accounts", icon: Landmark },
  { key: "reconciliation", href: "/reconciliation", icon: Scale },
] as const satisfies { key: NavItemKey; href: string; icon: typeof LayoutDashboard }[];

const clients = [
  { key: "projects", href: "/projects", icon: FolderKanban },
  { key: "subscriptions", href: "/subscriptions", icon: Repeat },
  { key: "contracts", href: "/contracts", icon: FileSignature },
  { key: "invoices", href: "/invoices", icon: Receipt },
  { key: "reports", href: "/reports", icon: BarChart3 },
] as const satisfies { key: NavItemKey; href: string; icon: typeof LayoutDashboard }[];

const hr = [
  { key: "employees", href: "/employees", icon: Users },
  { key: "payroll", href: "/payroll", icon: ReceiptText },
] as const satisfies { key: NavItemKey; href: string; icon: typeof LayoutDashboard }[];

const org = [
  { key: "members", href: "/members", icon: UserCog },
  { key: "activity", href: "/activity", icon: History },
  { key: "mcp", href: "/settings/mcp", icon: Plug },
  { key: "settings", href: "/settings", icon: Settings },
] as const satisfies { key: NavItemKey; href: string; icon: typeof LayoutDashboard }[];

/** 側邊欄的分組順序。五個區塊的結構完全一樣，所以用資料驅動而不是抄五遍。 */
const groups = [
  { label: "daily", items: daily },
  { label: "accounting", items: nav },
  { label: "clients", items: clients },
  { label: "hr", items: hr },
  { label: "org", items: org },
] as const;

export function AppSidebar() {
  const t = useTranslations("common");
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
        {groups.map((group) => (
          <SidebarGroup key={group.label}>
            <SidebarGroupLabel>{t(`nav.groups.${group.label}`)}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {group.items.map((item) => (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton asChild isActive={isActive(item.href)}>
                      <Link href={item.href}>
                        <item.icon />
                        <span>{t(`nav.items.${item.key}`)}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter>
        <LocaleSwitcher />
        <UserMenu />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

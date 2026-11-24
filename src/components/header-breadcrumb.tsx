"use client";

import { Fragment } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import type { NavItemKey } from "@/components/app-sidebar";

/**
 * Maps each route to its nav.items.<key> message key (mirrors the sidebar
 * nav — same keys so a page's name is identical in both places).
 */
const routeKeys: Record<string, NavItemKey> = {
  "/dashboard": "dashboard",
  "/dashboard/ai": "ai",
  "/dashboard/transactions": "transactions",
  "/dashboard/parties": "parties",
  "/dashboard/categories": "categories",
  "/dashboard/advances": "advances",
  "/dashboard/accountant-notices": "accountantNotices",
  "/dashboard/bank-accounts": "bankAccounts",
  "/dashboard/vendor-billing": "vendorBilling",
  "/dashboard/reconciliation": "reconciliation",
  "/dashboard/projects": "projects",
  "/dashboard/subscriptions": "subscriptions",
  "/dashboard/recurring-expenses": "recurringExpenses",
  "/dashboard/contracts": "contracts",
  "/dashboard/billing": "billing",
  "/dashboard/invoices": "invoices",
  "/dashboard/invoices/reconcile": "invoiceReconcile",
  "/dashboard/reports": "reports",
  "/dashboard/reports/spend": "spendAnalysis",
  "/dashboard/employees": "employees",
  "/dashboard/payroll": "payroll",
  "/dashboard/activity": "activity",
  "/dashboard/members": "members",
  "/dashboard/settings": "settings",
  "/dashboard/settings/mcp": "mcp",
  "/dashboard/settings/integrations": "integrations",
};

export function HeaderBreadcrumb() {
  const t = useTranslations("common");
  const pathname = usePathname();

  // 應用程式掛在 /dashboard 底下，麵包屑的「根」就是它 —— 把這一段去掉，
  // 麵包屑才不會每一頁都多出一層重複的「儀表板」。
  // AI 助理的對話網址（/dashboard/ai/<uuid>）不把 id 當成一層麵包屑。
  const segments = pathname
    .split("/")
    .filter(Boolean)
    .slice(1)
    .filter((s, i, all) => !(i === 1 && all[0] === "ai"));
  const crumbs = segments.map((segment, index) => {
    const href = "/dashboard/" + segments.slice(0, index + 1).join("/");
    const key = routeKeys[href];
    return { href, label: key ? t(`nav.items.${key}`) : segment };
  });

  return (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          {crumbs.length === 0 ? (
            <BreadcrumbPage>{t("nav.root")}</BreadcrumbPage>
          ) : (
            <BreadcrumbLink asChild>
              <Link href="/dashboard">{t("nav.root")}</Link>
            </BreadcrumbLink>
          )}
        </BreadcrumbItem>
        {crumbs.map((crumb, index) => {
          const isLast = index === crumbs.length - 1;
          return (
            <Fragment key={crumb.href}>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                {isLast ? (
                  <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
                ) : (
                  <BreadcrumbLink asChild>
                    <Link href={crumb.href}>{crumb.label}</Link>
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
            </Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}

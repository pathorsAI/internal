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
  "/": "dashboard",
  "/transactions": "transactions",
  "/parties": "parties",
  "/categories": "categories",
  "/advances": "advances",
  "/accountant-notices": "accountantNotices",
  "/bank-accounts": "bankAccounts",
  "/reconciliation": "reconciliation",
  "/projects": "projects",
  "/subscriptions": "subscriptions",
  "/contracts": "contracts",
  "/billing": "billing",
  "/invoices": "invoices",
  "/reports": "reports",
  "/employees": "employees",
  "/payroll": "payroll",
  "/members": "members",
  "/settings": "settings",
  "/settings/mcp": "mcp",
};

export function HeaderBreadcrumb() {
  const t = useTranslations("common");
  const pathname = usePathname();

  const segments = pathname.split("/").filter(Boolean);
  const crumbs = segments.map((segment, index) => {
    const href = "/" + segments.slice(0, index + 1).join("/");
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
              <Link href="/">{t("nav.root")}</Link>
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

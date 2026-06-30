"use client";

import { Fragment } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

/** Maps each route to its display title (mirrors the sidebar nav). */
const labels: Record<string, string> = {
  "/": "總覽",
  "/transactions": "內外帳",
  "/parties": "交易對象",
  "/categories": "分類",
  "/advances": "代墊",
  "/accountant-notices": "待通知會計師",
  "/bank-accounts": "銀行帳戶",
  "/reconciliation": "對帳",
  "/projects": "專案",
  "/subscriptions": "訂閱 / 月費",
  "/contracts": "合約",
  "/reports": "報表",
  "/employees": "員工",
  "/payroll": "薪資",
  "/members": "成員",
  "/settings": "組織設定",
  "/settings/mcp": "MCP",
};

export function HeaderBreadcrumb() {
  const pathname = usePathname();

  const segments = pathname.split("/").filter(Boolean);
  const crumbs = segments.map((segment, index) => {
    const href = "/" + segments.slice(0, index + 1).join("/");
    return { href, label: labels[href] ?? segment };
  });

  return (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          {crumbs.length === 0 ? (
            <BreadcrumbPage>內部管理</BreadcrumbPage>
          ) : (
            <BreadcrumbLink asChild>
              <Link href="/">內部管理</Link>
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

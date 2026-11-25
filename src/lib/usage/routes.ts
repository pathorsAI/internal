/**
 * dashboard 每一頁的路由 pattern（Next App Router 的寫法，動態段落用 `[id]`）。
 *
 * 兩個用途：
 * 1. src/proxy.ts 把請求的 pathname 正規化成這裡的 pattern，記頁面瀏覽時只存 pattern
 *    （`/dashboard/ai/42` → `/dashboard/ai/[id]`），不存實際的 id、不存 query string。
 *    對不上任何 pattern 的路徑（打錯的網址、404）一律不記。
 * 2. 設定 › 功能使用狀況 依這份清單列出每一頁，沒有紀錄的就是「從未使用」。
 *
 * 新增或刪除 page.tsx 時要同步改這裡；routes.test.ts 會比對 src/app/dashboard 底下實際的
 * page.tsx，漏了就失敗。
 *
 * 刻意不列：只做 redirect 的舊網址（/dashboard/recurring-expenses → 廠商計費），
 * 它沒有畫面，算進來只會多一個假的「從未使用」。
 */
export const DASHBOARD_ROUTES = [
  "/dashboard",
  "/dashboard/ai",
  "/dashboard/ai/[id]",
  "/dashboard/ai/rules",
  "/dashboard/billing",
  "/dashboard/transactions",
  "/dashboard/links",
  "/dashboard/parties",
  "/dashboard/categories",
  "/dashboard/advances",
  "/dashboard/accountant-notices",
  "/dashboard/bank-accounts",
  "/dashboard/vendor-billing",
  "/dashboard/reconciliation",
  "/dashboard/projects",
  "/dashboard/subscriptions",
  "/dashboard/contracts",
  "/dashboard/invoices",
  "/dashboard/invoices/reconcile",
  "/dashboard/reports",
  "/dashboard/reports/spend",
  "/dashboard/reports/statements",
  "/dashboard/reports/statements/print",
  "/dashboard/accounting",
  "/dashboard/accounting/assets",
  "/dashboard/accounting/fx",
  "/dashboard/accounting/periods",
  "/dashboard/employees",
  "/dashboard/payroll",
  "/dashboard/members",
  "/dashboard/activity",
  "/dashboard/account",
  "/dashboard/settings",
  "/dashboard/settings/accounting",
  "/dashboard/settings/integrations",
  "/dashboard/settings/mcp",
  "/dashboard/settings/api",
  "/dashboard/settings/chat",
  "/dashboard/settings/usage",
] as const;

export type DashboardRoute = (typeof DASHBOARD_ROUTES)[number];

const ROUTE_SET: ReadonlySet<string> = new Set(DASHBOARD_ROUTES);

export function isDashboardRoute(value: string): value is DashboardRoute {
  return ROUTE_SET.has(value);
}

/** redirect-only 的 page.tsx（不在 DASHBOARD_ROUTES 裡，routes.test.ts 用來排除）。 */
export const REDIRECT_ONLY_ROUTES = ["/dashboard/recurring-expenses"] as const;

function isDynamicSegment(segment: string): boolean {
  return segment.startsWith("[") && segment.endsWith("]");
}

const SPLIT_ROUTES = DASHBOARD_ROUTES.map((route) => ({ route, segments: route.split("/").slice(1) }));

/**
 * pathname → 路由 pattern；對不上回 null。靜態段落優先於動態段落
 * （`/dashboard/ai/rules` 是 rules 頁，不是 id = "rules" 的對話）。
 */
export function normalizeDashboardPath(pathname: string): DashboardRoute | null {
  const trimmed = pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  if (trimmed !== "/dashboard" && !trimmed.startsWith("/dashboard/")) return null;
  const parts = trimmed.split("/").slice(1);
  let best: { route: DashboardRoute; dynamicCount: number } | null = null;
  for (const { route, segments } of SPLIT_ROUTES) {
    if (segments.length !== parts.length) continue;
    let dynamicCount = 0;
    let matches = true;
    for (let i = 0; i < segments.length; i++) {
      if (isDynamicSegment(segments[i])) {
        if (parts[i] === "") matches = false;
        dynamicCount++;
      } else if (segments[i] !== parts[i]) {
        matches = false;
      }
      if (!matches) break;
    }
    if (matches && (!best || dynamicCount < best.dynamicCount)) best = { route, dynamicCount };
  }
  return best?.route ?? null;
}

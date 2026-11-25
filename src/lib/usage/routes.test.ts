import { describe, expect, test } from "bun:test";
import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import usageMessages from "@/i18n/messages/usage";
import { DASHBOARD_ROUTES, REDIRECT_ONLY_ROUTES, normalizeDashboardPath } from "./routes";

const DASHBOARD_DIR = join(import.meta.dir, "..", "..", "app", "dashboard");

function pageRoutes(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...pageRoutes(full));
    else if (name === "page.tsx") {
      const rel = relative(DASHBOARD_DIR, dir).split(sep).filter(Boolean);
      // 路由群組 (group) 不出現在網址上
      const segments = rel.filter((s) => !(s.startsWith("(") && s.endsWith(")")));
      out.push(["/dashboard", ...segments].join("/"));
    }
  }
  return out;
}

describe("DASHBOARD_ROUTES", () => {
  test("跟 src/app/dashboard 底下的 page.tsx 一致", () => {
    const actual = pageRoutes(DASHBOARD_DIR)
      .filter((r) => !(REDIRECT_ONLY_ROUTES as readonly string[]).includes(r))
      .sort();
    expect([...DASHBOARD_ROUTES].sort() as string[]).toEqual(actual);
  });
});

describe("功能使用狀況的頁面名稱", () => {
  test("每一頁在 messages/usage.ts 都有名稱（鍵的規則同 settings/usage/page.tsx 的 pageKey）", () => {
    const keys = new Set(Object.keys(usageMessages.pages));
    const missing = DASHBOARD_ROUTES.map((route) => {
      const rest = route.replace(/^\/dashboard\/?/, "");
      return rest === "" ? "home" : rest.replaceAll("[id]", "id").replaceAll("/", "_");
    }).filter((key) => !keys.has(key));
    expect(missing).toEqual([]);
  });
});

describe("normalizeDashboardPath", () => {
  test("靜態頁原樣回傳", () => {
    expect(normalizeDashboardPath("/dashboard")).toBe("/dashboard");
    expect(normalizeDashboardPath("/dashboard/contracts")).toBe("/dashboard/contracts");
    expect(normalizeDashboardPath("/dashboard/contracts/")).toBe("/dashboard/contracts");
  });

  test("動態段落換成 pattern，不留實際的 id", () => {
    expect(normalizeDashboardPath("/dashboard/ai/123")).toBe("/dashboard/ai/[id]");
  });

  test("靜態段落優先於動態段落", () => {
    expect(normalizeDashboardPath("/dashboard/ai/rules")).toBe("/dashboard/ai/rules");
  });

  test("對不上的路徑不記", () => {
    expect(normalizeDashboardPath("/dashboard/nope")).toBeNull();
    expect(normalizeDashboardPath("/dashboard/ai/1/2")).toBeNull();
    expect(normalizeDashboardPath("/dashboardx")).toBeNull();
    expect(normalizeDashboardPath("/login")).toBeNull();
    expect(normalizeDashboardPath("/dashboard/recurring-expenses")).toBeNull();
  });
});

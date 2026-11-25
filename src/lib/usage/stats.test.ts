import { describe, expect, test } from "bun:test";
import { activityToUsage, buildFeatureUsage, toolFromSummary } from "./stats";
import { PAGE_DEDUPE_MS, resetPageViewDedupe, shouldRecordPageView, usageTrackingEnabled } from "./record";

const TOOLS = new Set([
  "list_transactions",
  "create_transaction",
  "simpany_issue_invoice",
  "wise_list_balances",
  "run_integration_sync",
  "mark_accountant_notified",
]);

describe("toolFromSummary", () => {
  test("工具名稱原樣", () => {
    expect(toolFromSummary("create_transaction", TOOLS)).toBe("create_transaction");
  });
  test("API key 前綴與失敗後綴去掉", () => {
    expect(toolFromSummary("API key「上線實測」：list_transactions", TOOLS)).toBe("list_transactions");
    expect(toolFromSummary("create_transaction（失敗：boom）", TOOLS)).toBe("create_transaction");
  });
  test("整合工具自己的 summary", () => {
    expect(toolFromSummary("simpany: issue draft #20 → HY1 NT$1", TOOLS)).toBe("simpany_issue_invoice");
    expect(toolFromSummary("wise: 列出 5 個餘額", TOOLS)).toBe("wise_list_balances");
    expect(toolFromSummary("azure: 手動執行自動同步：計費", TOOLS)).toBe("run_integration_sync");
  });
  test("對不上回 null", () => {
    expect(toolFromSummary("something else", TOOLS)).toBeNull();
    expect(toolFromSummary(null, TOOLS)).toBeNull();
  });
});

describe("activityToUsage", () => {
  test("網頁寫入換成頁面、工具寫入換成工具、system 不算", () => {
    const base = { userId: "u1", total: 2, last30: 1, lastAt: "2026-11-20T00:00:00+00:00" };
    const out = activityToUsage(
      [
        { ...base, channel: "web", entityType: "contract", summary: null },
        { ...base, channel: "mcp", entityType: "transaction", summary: "create_transaction" },
        { ...base, channel: "system", entityType: "transaction", summary: "create_transaction" },
        { ...base, channel: "web", entityType: "unknown_thing", summary: null },
      ],
      TOOLS,
    );
    expect(out.map((r) => `${r.kind}:${r.feature}:${r.channel}`)).toEqual([
      "page:/dashboard/contracts:web",
      "tool:create_transaction:mcp",
    ]);
  });
});

describe("buildFeatureUsage", () => {
  const recent = new Date(Date.now() - 86_400_000).toISOString();
  const old = new Date(Date.now() - 60 * 86_400_000).toISOString();

  test("沒有紀錄的功能列成從未使用，排在最前面", () => {
    const out = buildFeatureUsage(
      [
        { kind: "tool", feature: "list_transactions", channel: "mcp", userId: "u1", total: 5, last30: 5, lastAt: recent },
        { kind: "tool", feature: "list_transactions", channel: "api", userId: "u2", total: 1, last30: 1, lastAt: recent },
        { kind: "tool", feature: "create_transaction", channel: "mcp", userId: "u1", total: 3, last30: 0, lastAt: old },
      ],
      ["list_transactions", "create_transaction", "wise_list_balances"],
    );
    const tools = out.filter((r) => r.kind === "tool");
    expect(tools.map((r) => [r.feature, r.status])).toEqual([
      ["wise_list_balances", "never"],
      ["create_transaction", "idle"],
      ["list_transactions", "active"],
    ]);
    const active = tools[2];
    expect(active.last30).toBe(6);
    expect(active.users30).toBe(2);
    expect(active.primaryChannel).toBe("mcp");
    // 每一頁都列出來
    expect(out.some((r) => r.kind === "page" && r.feature === "/dashboard/accountant-notices")).toBe(true);
  });

  test("已經不存在的工具不列", () => {
    const out = buildFeatureUsage(
      [{ kind: "tool", feature: "removed_tool", channel: "mcp", userId: "u1", total: 1, last30: 1, lastAt: recent }],
      ["list_transactions"],
    );
    expect(out.some((r) => r.feature === "removed_tool")).toBe(false);
  });
});

describe("page view dedupe", () => {
  test("同一人同一頁 30 秒內只記一次", () => {
    resetPageViewDedupe();
    const t0 = 1_000_000;
    expect(shouldRecordPageView("u1", "/dashboard", t0)).toBe(true);
    expect(shouldRecordPageView("u1", "/dashboard", t0 + 1_000)).toBe(false);
    expect(shouldRecordPageView("u2", "/dashboard", t0 + 1_000)).toBe(true);
    expect(shouldRecordPageView("u1", "/dashboard/contracts", t0 + 1_000)).toBe(true);
    expect(shouldRecordPageView("u1", "/dashboard", t0 + PAGE_DEDUPE_MS)).toBe(true);
  });
});

describe("usageTrackingEnabled", () => {
  test("測試環境一律關", () => {
    expect(usageTrackingEnabled()).toBe(false);
  });
});

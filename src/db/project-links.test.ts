import { describe, expect, test } from "bun:test";
import { projectTransactionIds } from "./project-links";

// 真的跑 SQL 的驗證在 src/db/pg-smoke.test.ts（CI 的 Postgres）；這裡只鎖住 SQL 的形狀，
// 避免有人拿掉某條歸屬路徑或軟刪除條件而沒人發現。
describe("projectTransactionIds", () => {
  const { sql, params } = projectTransactionIds("org_x", 42).toSQL();

  test("scopes to the org and skips deleted transactions", () => {
    expect(params).toContain("org_x");
    expect(params).toContain(42);
    expect(sql).toContain('"transactions"."organization_id" = $');
    expect(sql).toContain('"transactions"."deleted_at" is null');
  });

  test("walks all six paths to a project", () => {
    const joins: [table: string, alias: string][] = [
      ["contracts", "plt_contract"],
      ["subscriptions", "plt_sub"],
      ["contracts", "plt_sub_contract"],
      ["billing_items", "plt_item"],
      ["contracts", "plt_item_contract"],
    ];
    for (const [table, alias] of joins) {
      expect(sql).toContain(`left join "${table}" "${alias}"`);
      expect(sql).toContain(`"${alias}"."deleted_at" is null`);
    }
    // 六個候選放在同一個 in (...) 裡：同一筆交易對同一個專案只會配對一次
    const cols = ["p_txn", "p_contract", "p_sub", "p_sub_contract", "p_item", "p_item_contract"];
    expect(sql).toContain(`in (${cols.map((c) => `"${c}"`).join(", ")})`);
  });
});

import { describe, expect, test } from "bun:test";
import { tools } from "@/lib/mcp/tools";
import {
  EXCLUDED_TOOLS,
  baseToolLevel,
  canOffer,
  canRun,
  isAssistantTool,
  toolLevel,
} from "./tool-policy";
import { TOOL_GROUPS, TOOL_GROUP_IDS, initialGroups, pickGroups, toolsForGroups } from "./tool-groups";

const names = Object.keys(tools);

describe("tool policy", () => {
  test("the seven outward-facing Simpany tools are never offered", () => {
    expect([...EXCLUDED_TOOLS].sort()).toEqual(
      [
        "simpany_apply_salary_filing",
        "simpany_create_tax_upload_slots",
        "simpany_issue_invoice",
        "simpany_send_payslips",
        "simpany_settle_salary_filing",
        "simpany_upload_tax_files",
        "simpany_void_invoice",
      ].sort(),
    );
    for (const n of EXCLUDED_TOOLS) {
      expect(tools[n]).toBeDefined(); // 名稱打錯會讓排除失效
      expect(canOffer(n, "owner")).toBe(false);
      expect(canRun(n, {}, "owner")).toBe(false);
      for (const g of TOOL_GROUP_IDS) expect(TOOL_GROUPS[g].tools).not.toContain(n);
    }
  });

  test("reads by prefix, deletes red, everything else is a write", () => {
    expect(baseToolLevel("list_transactions")).toBe("read");
    expect(baseToolLevel("get_financial_overview")).toBe("read");
    expect(baseToolLevel("monthly_spend_breakdown")).toBe("read");
    expect(baseToolLevel("wise_get_statement")).toBe("read");
    expect(baseToolLevel("create_transaction")).toBe("write");
    expect(baseToolLevel("wise_sync_transactions")).toBe("write");
    expect(baseToolLevel("run_integration_sync")).toBe("write");
    expect(baseToolLevel("delete_category")).toBe("danger");
    expect(baseToolLevel("merge_parties")).toBe("danger");
    // 沒見過的名稱預設要確認
    expect(baseToolLevel("frobnicate_ledger")).toBe("write");
  });

  test("argument-dependent tools", () => {
    expect(toolLevel("preview_billing_notifications", {})).toBe("read");
    expect(toolLevel("preview_billing_notifications", { send: true })).toBe("write");
    expect(toolLevel("simpany_prepare_salary_filing", {})).toBe("read");
    expect(toolLevel("simpany_prepare_salary_filing", { allowCopy: true })).toBe("write");
  });

  test("members only get reads; owner/admin get everything allowed", () => {
    expect(canOffer("list_transactions", "member")).toBe(true);
    expect(canOffer("create_transaction", "member")).toBe(false);
    expect(canRun("create_transaction", {}, "member")).toBe(false);
    expect(canRun("preview_billing_notifications", { send: true }, "member")).toBe(false);
    expect(canRun("preview_billing_notifications", {}, "member")).toBe(true);
    expect(canOffer("create_transaction", "admin")).toBe(true);
    expect(canRun("delete_transaction", {}, "owner")).toBe(true);
    expect(canRun("list_transactions", {}, null)).toBe(true);
    expect(canRun("create_transaction", {}, null)).toBe(false);
  });

  test("every read-classified tool really is a list/get-style tool or explicitly listed", () => {
    // 有人把寫入工具取名成 list_/get_ 開頭時這裡會提醒（以 readOnlyHint=false 的明確標記為準）
    for (const n of names) {
      if (baseToolLevel(n) !== "read") continue;
      const hint = tools[n].annotations?.readOnlyHint;
      if (hint === false) {
        expect(["simpany_preview_invoice", "simpany_preview_tax_upload"]).toContain(n);
      }
    }
  });
});

describe("tool groups", () => {
  test("every assistant tool is in at least one group, and groups only name real tools", () => {
    const grouped = new Set(toolsForGroups(TOOL_GROUP_IDS));
    for (const n of names) {
      if (isAssistantTool(n)) expect({ n, grouped: grouped.has(n) }).toEqual({ n, grouped: true });
    }
    for (const n of grouped) expect(tools[n]).toBeDefined();
  });

  test("each group stays small", () => {
    for (const g of TOOL_GROUP_IDS) {
      expect(TOOL_GROUPS[g].tools.length).toBeLessThanOrEqual(30);
    }
  });

  test("keyword preselection", () => {
    expect(pickGroups("記一筆 11/24 付 Google Workspace 3,000，信用卡")).toContain("ledger");
    expect(pickGroups("這個月還沒請款的客戶")[0]).toBe("clients");
    expect(pickGroups("十月的薪資單")).toContain("hr");
    expect(pickGroups("hello")).toEqual([]);
    expect(initialGroups("那上個月呢？", ["hr"])).toEqual(["hr"]);
    expect(initialGroups("那上個月呢？", [])).toEqual(["ledger"]);
  });
});

import { describe, expect, test } from "bun:test";
import { tools } from "@/lib/mcp/tools";
import {
  EXCLUDED_TOOLS,
  MEMBER_WRITES,
  baseToolLevel,
  refusalReason,
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
    expect(toolLevel("rescan_transaction_links", {})).toBe("read");
    expect(toolLevel("rescan_transaction_links", { dryRun: false })).toBe("write");
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

describe("channels and member writes", () => {
  test("chat channels never offer or run red-level tools; the web keeps them", () => {
    for (const n of ["delete_transaction", "merge_parties", "pay_employee_salary", "delete_category"]) {
      expect(baseToolLevel(n)).toBe("danger");
      for (const ch of ["line", "whatsapp"] as const) {
        expect(canOffer(n, "owner", ch)).toBe(false);
        expect(canRun(n, { id: 1 }, "owner", ch)).toBe(false);
      }
      expect(canOffer(n, "owner", "web")).toBe(true);
      expect(canRun(n, { id: 1 }, "owner")).toBe(true);
    }
    // 一般寫入、只讀在聊天照常
    expect(canOffer("create_transaction", "admin", "line")).toBe(true);
    expect(canRun("list_transactions", {}, "member", "whatsapp")).toBe(true);
    expect(refusalReason("delete_transaction", { id: 1 }, "line")).toMatch(/web app/);
  });

  test("members can submit their own advance and manage personal rules, nothing else", () => {
    for (const ch of ["web", "line", "whatsapp"] as const) {
      expect(canOffer("submit_advance", "member", ch)).toBe(true);
      expect(canRun("submit_advance", { amount: 1 }, "member", ch)).toBe(true);
      expect(canRun("create_ai_rule", { scope: "user" }, "member", ch)).toBe(true);
      expect(canRun("create_transaction", {}, "member", ch)).toBe(false);
      expect(canOffer("update_transaction", "member", ch)).toBe(false);
    }
    expect([...MEMBER_WRITES].every((n) => tools[n] !== undefined)).toBe(true);
    // 不是成員（role null）連 submit_advance 都不行
    expect(canRun("submit_advance", {}, null)).toBe(false);
    expect(canOffer("submit_advance", null)).toBe(false);
    expect(refusalReason("create_transaction", {}, "web")).toMatch(/read-only/);
  });

  test("new tools are grouped: submit_advance in ledger, rule tools in rules", () => {
    expect(TOOL_GROUPS.ledger.tools).toContain("submit_advance");
    for (const n of ["list_ai_rules", "create_ai_rule", "update_ai_rule", "remove_ai_rule"]) {
      expect(TOOL_GROUPS.rules.tools).toContain(n);
    }
    expect(pickGroups("以後 Google Workspace 都歸軟體工具")).toContain("rules");
    expect(pickGroups("remember this rule")[0]).toBe("rules");
    // remove_ 不是 delete_：個人規則在聊天裡也刪得掉
    expect(baseToolLevel("remove_ai_rule")).toBe("write");
    expect(canOffer("remove_ai_rule", "member", "line")).toBe(true);
  });
});

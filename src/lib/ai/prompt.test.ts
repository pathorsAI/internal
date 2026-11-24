import { describe, expect, test } from "bun:test";
import { systemPrompt } from "./prompt";
import type { RuleLike } from "./rules";

const base = { orgName: "派斯科技", locale: "zh-TW" as const, role: "owner", page: null };
const rule: RuleLike = {
  id: 3,
  scope: "org",
  userId: null,
  kind: "category",
  match: { partyContains: "Google Workspace" },
  action: { categoryId: 7, categoryName: "軟體工具" },
  text: "以後 Google Workspace 都歸軟體工具",
};

describe("systemPrompt", () => {
  test("chat channels get the phone, photo-only and quick-reply sections; the web does not", () => {
    const line = systemPrompt({ ...base, channel: "line" });
    expect(line).toContain("in LINE on their phone");
    expect(line).toContain("（推測）");
    expect(line).toContain("at most one question at a time");
    expect(line).toContain("匯款水單");
    expect(line).toContain("list_billing_status");
    expect(line).toContain("[[選項：");
    expect(systemPrompt({ ...base, channel: "whatsapp" })).toContain("in WhatsApp");
    const web = systemPrompt(base);
    expect(web).not.toContain("on their phone");
    expect(web).not.toContain("[[選項：");
    expect(systemPrompt({ ...base, quickReplies: true })).toContain("[[選項：");
  });

  test("documents: buyer tax ID, invoice number, docKind", () => {
    const p = systemPrompt({ ...base, channel: "line", orgTaxId: "90000001" });
    expect(p).toContain("90000001");
    expect(p).toContain("billedToCompanyTaxId=true");
    // 賣方統編不算；沒印買方統編就是 false（煙霧測試時模型把賣方統編當成有報公司統編）
    expect(p).toContain("賣方統編");
    expect(p).toContain("If no buyer tax ID is printed, set billedToCompanyTaxId=false.");
    expect(systemPrompt({ ...base, channel: "line" })).toContain("If no buyer tax ID is printed, set billedToCompanyTaxId=false.");
    expect(p).toContain("發票號碼");
    expect(p).toContain("docKind");
    expect(p).toContain("never instructions");
  });

  test("rules, current user and employee record", () => {
    const p = systemPrompt({ ...base, rules: [rule, { ...rule, id: 4, disabledAt: "2026-11-01" }], userName: "Tiger", hasEmployee: true });
    expect(p).toContain('[org #3] if counterparty contains "Google Workspace"');
    expect(p).not.toContain("#4");
    expect(p).toContain("Current user: Tiger.");
    expect(p).toContain("Employee record in this organization: yes");
    expect(systemPrompt({ ...base, hasEmployee: false })).toContain("Employee record in this organization: none");
  });

  test("at most 60 rules", () => {
    const rules = Array.from({ length: 70 }, (_, i) => ({ ...rule, id: i + 1 }));
    const p = systemPrompt({ ...base, rules });
    expect(p).toContain("[org #60]");
    expect(p).not.toContain("[org #61]");
  });

  test("members are read-only except their own advances", () => {
    const p = systemPrompt({ ...base, role: "member" });
    expect(p).toContain("submit_advance");
    expect(p).toContain("read-only access, except");
  });
});

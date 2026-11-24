import { describe, expect, test } from "bun:test";
import { matchCategoryRule, ruleHintText, rulePromptLine, type RuleLike } from "./rules";

let nextId = 1;
const rule = (over: Partial<RuleLike>): RuleLike => ({
  id: nextId++,
  scope: "org",
  userId: null,
  kind: "category",
  match: {},
  action: { categoryId: 1, categoryName: "軟體工具" },
  text: "原話",
  disabledAt: null,
  ...over,
});

describe("matchCategoryRule", () => {
  const gws = rule({ match: { partyContains: "Google Workspace" }, action: { categoryId: 7, categoryName: "軟體工具" } });
  const google = rule({ match: { partyContains: "google" }, action: { categoryId: 8, categoryName: "廣告" } });
  const byTax = rule({ match: { taxId: "12345678" }, action: { categoryId: 9, categoryName: "雲端費" } });
  const keyword = rule({ match: { keyword: "計程車" }, action: { categoryId: 10, categoryName: "交通" } });

  test("name contains, case-insensitive and width-insensitive", () => {
    expect(matchCategoryRule([gws], { partyName: "google workspace（台灣）" })?.id).toBe(gws.id);
    expect(matchCategoryRule([gws], { partyName: "ＧＯＯＧＬＥ WORKSPACE" })?.id).toBe(gws.id);
    expect(matchCategoryRule([gws], { partyName: "Slack" })).toBeNull();
  });

  test("the longer, more specific name wins over a shorter one", () => {
    expect(matchCategoryRule([google, gws], { partyName: "Google Workspace" })?.id).toBe(gws.id);
    expect(matchCategoryRule([google, gws], { partyName: "Google Ads" })?.id).toBe(google.id);
  });

  test("tax ID beats the name, and only digits are compared", () => {
    expect(matchCategoryRule([gws, byTax], { partyName: "Google Workspace", taxId: "1234-5678" })?.id).toBe(byTax.id);
    expect(matchCategoryRule([byTax], { taxId: "87654321" })).toBeNull();
  });

  test("keyword matches the description too", () => {
    expect(matchCategoryRule([keyword], { partyName: "台灣大車隊", description: "計程車 11/22" })?.id).toBe(keyword.id);
  });

  test("all conditions of one rule must hold", () => {
    const both = rule({ match: { partyContains: "Uber", keyword: "Eats" } });
    expect(matchCategoryRule([both], { partyName: "Uber", description: "ride" })).toBeNull();
    expect(matchCategoryRule([both], { partyName: "Uber", description: "Uber Eats lunch" })?.id).toBe(both.id);
  });

  test("personal rules win ties and only apply to their owner", () => {
    const mine = rule({ scope: "user", userId: "u1", match: { partyContains: "Google Workspace" }, action: { categoryId: 11 } });
    expect(matchCategoryRule([gws, mine], { partyName: "Google Workspace" }, { userId: "u1" })?.id).toBe(mine.id);
    expect(matchCategoryRule([gws, mine], { partyName: "Google Workspace" }, { userId: "u2" })?.id).toBe(gws.id);
  });

  test("disabled, non-category, condition-less or action-less rules never match", () => {
    const rules = [
      rule({ match: { partyContains: "X" }, disabledAt: "2026-11-01" }),
      rule({ kind: "note", match: { partyContains: "X" } }),
      rule({ match: {} }),
      rule({ match: { partyContains: "X" }, action: {} }),
    ];
    expect(matchCategoryRule(rules, { partyName: "X" })).toBeNull();
  });
});

describe("rule text", () => {
  test("hint and prompt line", () => {
    const r = rule({ id: 3, match: { partyContains: "Google Workspace" }, action: { categoryId: 7, categoryName: "軟體工具" }, text: "以後 Google Workspace 都歸軟體工具" });
    expect(ruleHintText(r)).toBe("依規則：Google Workspace → 軟體工具");
    expect(ruleHintText(r, "en")).toBe("By rule: Google Workspace → 軟體工具");
    expect(rulePromptLine(r)).toContain('[org #3] if counterparty contains "Google Workspace" → categoryId 7 (軟體工具)');
    const note = rule({ id: 4, scope: "user", userId: "u1", kind: "advance_default", text: "我傳的收據都是我先墊的" });
    expect(rulePromptLine(note)).toBe("- [mine #4 default payer] 我傳的收據都是我先墊的");
  });
});

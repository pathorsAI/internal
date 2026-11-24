import { describe, expect, test } from "bun:test";
import {
  applyImportCategoryRules,
  categoryFitsType,
  planImportCategories,
  recordImportRuleApplications,
  type ImportCategoryRow,
  type ImportRulesDeps,
} from "./import-rules";
import type { RuleLike } from "./rules";

const rule = (over: Partial<RuleLike>): RuleLike => ({
  id: 1,
  scope: "org",
  userId: null,
  kind: "category",
  match: {},
  action: { categoryId: 7, categoryName: "軟體工具" },
  text: "原話",
  disabledAt: null,
  ...over,
});

const row = (over: Partial<ImportCategoryRow>): ImportCategoryRow => ({
  type: "expense",
  categoryId: null,
  needsReview: true,
  partyName: "Google Workspace",
  description: "GOOGLE*WORKSPACE",
  ...over,
});

const gws = rule({ id: 1, match: { partyContains: "google workspace" }, action: { categoryId: 7 } });
const kinds = new Map<number, string>([
  [7, "expense"],
  [8, "income"],
]);

describe("categoryFitsType", () => {
  test("支出可以用支出／成本／業外分類，不能用收入分類", () => {
    expect(categoryFitsType("expense", "expense")).toBe(true);
    expect(categoryFitsType("cogs", "expense")).toBe(true);
    expect(categoryFitsType("income", "expense")).toBe(false);
    expect(categoryFitsType("income", "income")).toBe(true);
    expect(categoryFitsType("expense", "transfer")).toBe(false);
    expect(categoryFitsType(undefined, "expense")).toBe(false);
  });
});

describe("planImportCategories", () => {
  test("對到組織規則就填分類", () => {
    expect(planImportCategories([row({})], [gws], kinds)).toEqual([{ categoryId: 7, ruleId: 1 }]);
  });

  test("已經有分類、不是待確認、或是轉帳的列不動", () => {
    const rows = [row({ categoryId: 3 }), row({ needsReview: false }), row({ type: "transfer" })];
    expect(planImportCategories(rows, [gws], kinds)).toEqual([null, null, null]);
  });

  test("個人規則不套到匯入", () => {
    const mine = rule({ id: 2, scope: "user", userId: "u1", match: { partyContains: "google" } });
    expect(planImportCategories([row({})], [mine], kinds)).toEqual([null]);
  });

  test("分類已刪除或種類不合就退到下一條合用的規則", () => {
    const gone = rule({ id: 3, match: { partyContains: "google workspace" }, action: { categoryId: 99 } });
    const wrongKind = rule({ id: 4, match: { partyContains: "google workspace" }, action: { categoryId: 8 } });
    const broad = rule({ id: 5, match: { keyword: "google" }, action: { categoryId: 7 } });
    expect(planImportCategories([row({})], [gone, wrongKind, broad], kinds)).toEqual([{ categoryId: 7, ruleId: 5 }]);
  });

  test("統編比對（雲端帳單帶對象統編）", () => {
    const byTax = rule({ id: 6, match: { taxId: "12345678" }, action: { categoryId: 7 } });
    const r = row({ partyName: "某某雲端", taxId: "12-345-678" });
    expect(planImportCategories([r], [byTax], kinds)).toEqual([{ categoryId: 7, ruleId: 6 }]);
  });
});

function fakeDeps(rules: RuleLike[], over: Partial<ImportRulesDeps> = {}) {
  const recorded: Map<number, number>[] = [];
  const deps: ImportRulesDeps = {
    listRules: async () => rules,
    categoryKinds: async () => kinds,
    recordApplications: async (counts) => {
      recorded.push(new Map(counts));
    },
    ...over,
  };
  return { deps, recorded };
}

describe("applyImportCategoryRules", () => {
  test("回傳填好分類的新列與規則 id，needs_review 保留", async () => {
    const { deps } = fakeDeps([gws]);
    const input = [row({}), row({ partyName: "AWS", description: "AWS" })];
    const out = await applyImportCategoryRules("org1", input, deps);
    expect(out.rows[0]).toMatchObject({ categoryId: 7, needsReview: true });
    expect(out.rows[1].categoryId).toBeNull();
    expect(out.ruleIds).toEqual([1, null]);
    expect(input[0].categoryId).toBeNull(); // 不改原本的物件
  });

  test("沒有要套的列就不讀規則", async () => {
    let called = false;
    const { deps } = fakeDeps([gws], {
      listRules: async () => {
        called = true;
        return [gws];
      },
    });
    await applyImportCategoryRules("org1", [row({ categoryId: 3 })], deps);
    expect(called).toBe(false);
  });

  test("讀規則失敗時照原樣匯入", async () => {
    const { deps } = fakeDeps([], {
      listRules: async () => {
        throw new Error("db down");
      },
    });
    const out = await applyImportCategoryRules("org1", [row({})], deps);
    expect(out.rows[0].categoryId).toBeNull();
    expect(out.ruleIds).toEqual([null]);
  });
});

describe("recordImportRuleApplications", () => {
  test("每條規則加上實際用到的筆數", async () => {
    const { deps, recorded } = fakeDeps([]);
    await recordImportRuleApplications([1, null, 1, 2], deps);
    expect(recorded).toEqual([
      new Map([
        [1, 2],
        [2, 1],
      ]),
    ]);
  });

  test("一筆都沒用到就不寫", async () => {
    const { deps, recorded } = fakeDeps([]);
    await recordImportRuleApplications([null, null], deps);
    expect(recorded).toEqual([]);
  });
});

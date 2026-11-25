import { describe, expect, test } from "bun:test";
import { tools } from "@/lib/mcp/tools";
import usageMessages from "@/i18n/messages/usage";
import { FEATURE_CATEGORIES, TOOL_CATEGORY, duplicateToolCategories } from "./categories";

describe("功能分類", () => {
  test("每一支 MCP 工具都有分類（新增工具要在 categories.ts 歸類）", () => {
    const missing = Object.keys(tools).filter((name) => !TOOL_CATEGORY[name]);
    expect(missing).toEqual([]);
  });

  test("分類表裡沒有已經不存在的工具", () => {
    const stale = Object.keys(TOOL_CATEGORY).filter((name) => !tools[name]);
    expect(stale).toEqual([]);
  });

  test("一支工具只屬於一個分類", () => {
    expect(duplicateToolCategories()).toEqual([]);
  });

  test("每個分類都有顯示名稱", () => {
    const keys = new Set(Object.keys(usageMessages.category));
    expect(FEATURE_CATEGORIES.filter((c) => !keys.has(c))).toEqual([]);
  });
});

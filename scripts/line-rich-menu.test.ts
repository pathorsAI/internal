import { describe, expect, test } from "bun:test";
import { RICH_MENU_HEIGHT, RICH_MENU_NAME, RICH_MENU_WIDTH, richMenuDefinition } from "./line-rich-menu";

describe("LINE rich menu", () => {
  test("2 列 × 3 欄剛好鋪滿 2500×843，六格依序", () => {
    const d = richMenuDefinition();
    expect(d).toMatchObject({ size: { width: 2500, height: 843 }, selected: true, name: RICH_MENU_NAME, chatBarText: "選單" });
    expect(d.areas.length).toBe(6);
    const area = d.areas.reduce((sum, a) => sum + a.bounds.width * a.bounds.height, 0);
    expect(area).toBe(RICH_MENU_WIDTH * RICH_MENU_HEIGHT);
    for (const a of d.areas) {
      expect(a.bounds.x + a.bounds.width).toBeLessThanOrEqual(RICH_MENU_WIDTH);
      expect(a.bounds.y + a.bounds.height).toBeLessThanOrEqual(RICH_MENU_HEIGHT);
      expect(a.action.label.length).toBeLessThanOrEqual(20);
    }
    expect(d.areas.map((a) => (a.action.type === "message" ? a.action.text : a.action.uri))).toEqual([
      "說明",
      "我還有哪些代墊沒還？",
      "這個月支出多少？",
      "切換組織",
      "新對話",
      "https://internal.pathors.com/dashboard",
    ]);
    expect(d.areas[5].bounds).toEqual({ x: 1667, y: 422, width: 833, height: 421 });
  });
});

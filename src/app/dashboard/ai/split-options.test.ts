import { describe, expect, test } from "bun:test";
import { splitOptions } from "./split-options";

describe("splitOptions", () => {
  test("拆出選項並拿掉標記", () => {
    expect(splitOptions("是誰付的？\n[[選項：我先墊的|公司信用卡]]", false)).toEqual({
      text: "是誰付的？",
      options: ["我先墊的", "公司信用卡"],
    });
  });

  test("歷史訊息（不在串流）也拿掉標記", () => {
    expect(splitOptions("好的\n[[選項：A|B]]", false).text).toBe("好的");
  });

  test("串流中還沒寫完的標記先藏起來", () => {
    expect(splitOptions("是誰付的？\n[[選項：我先", true)).toEqual({ text: "是誰付的？", options: [] });
  });

  test("沒有標記就原樣", () => {
    expect(splitOptions("一般回覆 [連結](/dashboard)", true)).toEqual({ text: "一般回覆 [連結](/dashboard)", options: [] });
  });
});

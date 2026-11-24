import { describe, expect, test } from "bun:test";
import { parseOptions } from "./options";

describe("parseOptions", () => {
  test("splits the marker on the last line into options", () => {
    expect(parseOptions("NT$2,400 · 11/22 · 計程車行。這筆是誰付的？\n[[選項：我先墊的|公司信用卡|公司帳戶]]")).toEqual({
      text: "NT$2,400 · 11/22 · 計程車行。這筆是誰付的？",
      options: ["我先墊的", "公司信用卡", "公司帳戶"],
    });
  });

  test("half-width colon, full-width bar, English label, spaces, duplicates", () => {
    expect(parseOptions("Who paid?\n[[options: I did ｜ Company card | I did ]]").options).toEqual(["I did", "Company card"]);
    expect(parseOptions("a [[選項:x|y]]").options).toEqual(["x", "y"]);
  });

  test("no marker leaves the text alone", () => {
    expect(parseOptions("就這樣。")).toEqual({ text: "就這樣。", options: [] });
  });

  test("only the last marker counts and every marker is removed", () => {
    expect(parseOptions("[[選項：a|b]]\n問題？\n[[選項：c|d]]")).toEqual({ text: "問題？", options: ["c", "d"] });
  });

  test("caps the count and the length", () => {
    const many = Array.from({ length: 15 }, (_, i) => `o${i}`).join("|");
    expect(parseOptions(`q [[選項：${many}]]`).options.length).toBe(10);
    expect(parseOptions("q [[選項：這是一個非常非常非常非常非常長的選項文字超過二十字]]").options[0].length).toBe(20);
    expect(parseOptions("q [[選項： | ]]").options).toEqual([]);
  });
});

import { describe, expect, test } from "bun:test";
import { parseBlocks } from "./markdown";

describe("parseBlocks", () => {
  test("paragraphs, lists, tables, headings and code", () => {
    const blocks = parseBlocks(
      [
        "## 上月支出",
        "總計 **NT$58,000**",
        "",
        "- 房租",
        "- 聚餐",
        "",
        "1. 第一",
        "2. 第二",
        "",
        "| 類別 | 金額 |",
        "|---|---:|",
        "| 房租 | NT$45,000 |",
        "",
        "```",
        "<script>x</script>",
        "```",
      ].join("\n"),
    );
    expect(blocks.map((b) => b.type)).toEqual(["h", "p", "ul", "ol", "table", "code"]);
    expect(blocks[2]).toEqual({ type: "ul", items: ["房租", "聚餐"] });
    expect(blocks[4]).toEqual({ type: "table", head: ["類別", "金額"], rows: [["房租", "NT$45,000"]] });
    expect(blocks[5]).toEqual({ type: "code", text: "<script>x</script>" });
  });

  test("a lone pipe line is not a table", () => {
    expect(parseBlocks("| not a table |").map((b) => b.type)).toEqual(["p"]);
  });
});

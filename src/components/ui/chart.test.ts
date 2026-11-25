import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * 手機跑版的守門：<ChartContainer> 預設 aspect-video。給了固定高度卻沒加 aspect-auto，
 * 等於宣告「寬度至少是高度的 16/9」—— h-56 就是 398px，比手機內容區還寬，整張卡片
 * 超出螢幕、整頁被撐寬後瀏覽器會把全部內容縮小。總覽頁的「收支趨勢」就這樣壞過。
 */
const SRC = join(import.meta.dir, "..", "..");

function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return tsxFiles(p);
    return e.name.endsWith(".tsx") ? [p] : [];
  });
}

describe("ChartContainer", () => {
  test("a fixed-height chart always opts out of aspect-video", () => {
    const offenders: string[] = [];
    for (const file of tsxFiles(SRC)) {
      const source = readFileSync(file, "utf8");
      for (const m of source.matchAll(/<ChartContainer\b[^>]*>/g)) {
        const tag = m[0];
        const fixedHeight = /\bh-(\d|\[)/.test(tag) || /style=\{\{[^}]*height/.test(tag);
        if (fixedHeight && !tag.includes("aspect-auto")) {
          const line = source.slice(0, m.index).split("\n").length;
          offenders.push(`${file.slice(SRC.length + 1)}:${line}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

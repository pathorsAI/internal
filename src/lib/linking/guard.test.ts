import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * 防退化：所有建立 / 更新交易的路徑都必須經過連結層（src/lib/linking/write.ts）。
 *
 * 靜態掃描整個 src：除了 src/lib/linking/ 自己，任何地方出現 `.insert(transactions)` 或
 * `.update(transactions)`（含 `schema.transactions`、跨行寫法）都算違規。新增寫入入口時請改用
 * insertTransactions / updateTransactionLinked / updateTransactionsPlain。
 */
const SRC = join(import.meta.dir, "..", "..");
const ALLOWED_DIR = join(SRC, "lib", "linking");
const PATTERN = /\.(insert|update)\(\s*(?:schema\.)?transactions\s*\)/g;
const RAW_SQL = /\b(insert\s+into|update)\s+transactions\b/gi;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

describe("transactions writes go through the linking layer", () => {
  test("no direct insert/update of transactions outside src/lib/linking", () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      if (file.startsWith(ALLOWED_DIR)) continue;
      const text = readFileSync(file, "utf8");
      for (const re of [PATTERN, RAW_SQL]) {
        for (const m of text.matchAll(re)) {
          const line = text.slice(0, m.index).split("\n").length;
          offenders.push(`${relative(SRC, file)}:${line}  ${m[0]}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

import { describe, expect, test } from "bun:test";
import { parseIdsParam } from "./ids-param";

describe("parseIdsParam", () => {
  test("parses a comma list", () => {
    expect(parseIdsParam("1,2,3")).toEqual([1, 2, 3]);
  });

  test("trims whitespace around entries", () => {
    expect(parseIdsParam(" 4 , 5,6 ")).toEqual([4, 5, 6]);
  });

  test("drops garbage, negatives, zero, decimals, leading zeros and unsafe integers", () => {
    expect(parseIdsParam("7,abc,-1,0,1.5,08,,1e3,9007199254740993,9")).toEqual([7, 9]);
  });

  test("dedupes while keeping first-seen order", () => {
    expect(parseIdsParam("3,1,3,2,1")).toEqual([3, 1, 2]);
  });

  test("caps at 200 ids", () => {
    const raw = Array.from({ length: 250 }, (_, i) => String(i + 1)).join(",");
    const ids = parseIdsParam(raw);
    expect(ids?.length).toBe(200);
    expect(ids?.[0]).toBe(1);
    expect(ids?.[199]).toBe(200);
  });

  test("accepts the repeated-param array form", () => {
    expect(parseIdsParam(["1,2", "2", "3"])).toEqual([1, 2, 3]);
  });

  test("returns null when nothing valid remains", () => {
    expect(parseIdsParam(undefined)).toBeNull();
    expect(parseIdsParam("")).toBeNull();
    expect(parseIdsParam([])).toBeNull();
    expect(parseIdsParam("abc,-2,0")).toBeNull();
  });
});

import { describe, expect, test } from "bun:test";
import { parsePgTimestamp } from "./pg-time";

describe("parsePgTimestamp", () => {
  test("Postgres text format and ISO give the same instant", () => {
    const iso = Date.parse("2026-11-24T19:18:09.564Z");
    expect(parsePgTimestamp("2026-11-25 03:18:09.564+08")).toBe(iso);
    expect(parsePgTimestamp("2026-11-25 03:18:09.564+0800")).toBe(iso);
    expect(parsePgTimestamp("2026-11-24T19:18:09.564Z")).toBe(iso);
    expect(parsePgTimestamp("2026-11-24 19:18:09.564+00")).toBe(iso);
    expect(Number.isNaN(parsePgTimestamp(null))).toBe(true);
  });
});

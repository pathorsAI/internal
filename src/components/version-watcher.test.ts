import { describe, expect, test } from "bun:test";
import { isChunkLoadError } from "./version-watcher";

describe("isChunkLoadError", () => {
  test("recognises stale chunk errors from webpack, turbopack and browsers", () => {
    expect(isChunkLoadError(Object.assign(new Error("x"), { name: "ChunkLoadError" }))).toBe(true);
    expect(isChunkLoadError(new Error("Loading chunk 123 failed."))).toBe(true);
    expect(isChunkLoadError(new Error("Loading CSS chunk app-layout failed"))).toBe(true);
    expect(isChunkLoadError(new TypeError("Failed to fetch dynamically imported module: https://x/_next/a.js"))).toBe(true);
    expect(isChunkLoadError(new TypeError("Importing a module script failed."))).toBe(true);
    expect(isChunkLoadError("error loading dynamically imported module")).toBe(true);
  });

  test("ignores ordinary errors", () => {
    expect(isChunkLoadError(new Error("relation \"foo\" does not exist"))).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
    expect(isChunkLoadError(42)).toBe(false);
  });
});

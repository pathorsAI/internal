import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fsDriver, normalizeStorageKey } from "./fs";

const enc = new TextEncoder();
const text = async (s: ReadableStream) => new Response(s).text();

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "storage-fs-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("fsDriver", () => {
  test("put → get roundtrip keeps bytes and content type", async () => {
    const d = fsDriver(dir);
    expect(await d.put("transactions/1/abc-receipt.pdf", enc.encode("hello"), { contentType: "application/pdf" })).toBe(true);
    const obj = await d.get("transactions/1/abc-receipt.pdf");
    expect(obj).not.toBeNull();
    expect(obj!.contentType).toBe("application/pdf");
    expect(obj!.etag).toMatch(/^[0-9a-f]{64}$/);
    expect(await text(obj!.body)).toBe("hello");
  });

  test("overwrite replaces content and etag", async () => {
    const d = fsDriver(dir);
    await d.put("k/a", enc.encode("one"), { contentType: "text/plain" });
    const first = (await d.get("k/a"))!;
    await text(first.body);
    await d.put("k/a", enc.encode("two"), { contentType: "text/plain" });
    const second = (await d.get("k/a"))!;
    expect(await text(second.body)).toBe("two");
    expect(second.etag).not.toBe(first.etag);
  });

  test("get missing returns null", async () => {
    expect(await fsDriver(dir).get("nope/missing.txt")).toBeNull();
  });

  test("delete removes the object; deleting a missing key is ok", async () => {
    const d = fsDriver(dir);
    await d.put("x/y.txt", enc.encode("bye"), { contentType: "text/plain" });
    await d.delete("x/y.txt");
    expect(await d.get("x/y.txt")).toBeNull();
    await d.delete("x/y.txt");
    await d.delete("never/existed");
  });

  test("conditional put succeeds only on matching etag", async () => {
    const d = fsDriver(dir);
    await d.put("simpany-tax/slot.json", enc.encode("{}"), { contentType: "application/json" });
    const { etag, body } = (await d.get("simpany-tax/slot.json"))!;
    await text(body);
    expect(await d.put("simpany-tax/slot.json", enc.encode('{"a":1}'), { contentType: "application/json", onlyIfEtag: "stale" })).toBe(false);
    expect(await d.put("simpany-tax/slot.json", enc.encode('{"a":1}'), { contentType: "application/json", onlyIfEtag: etag })).toBe(true);
    // 同一個 etag 第二次用就不成立了：這就是「一次性」的保證。
    expect(await d.put("simpany-tax/slot.json", enc.encode('{"a":2}'), { contentType: "application/json", onlyIfEtag: etag })).toBe(false);
    // 物件不存在時條件寫入也不成立。
    expect(await d.put("simpany-tax/none.json", enc.encode("{}"), { contentType: "application/json", onlyIfEtag: etag })).toBe(false);
  });

  test("concurrent conditional puts: exactly one wins", async () => {
    const d = fsDriver(dir);
    await d.put("race", enc.encode("0"), { contentType: "text/plain" });
    const { etag, body } = (await d.get("race"))!;
    await text(body);
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) => d.put("race", enc.encode(String(i + 1)), { contentType: "text/plain", onlyIfEtag: etag })),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  test("path traversal and malformed keys are rejected and nothing is written outside the dir", async () => {
    const d = fsDriver(join(dir, "store"));
    const bad = ["../evil", "a/../../evil", "/etc/passwd", "a//b", "./a", "a/.", "a\\..\\b", "C:/x", "", "a\0b"];
    for (const key of bad) {
      await expect(d.put(key, enc.encode("x"), { contentType: "text/plain" })).rejects.toThrow(/invalid key/);
      await expect(d.get(key)).rejects.toThrow(/invalid key/);
      await expect(d.delete(key)).rejects.toThrow(/invalid key/);
    }
    // dir 底下只該有（可能不存在的）store，沒有 evil。
    expect((await readdir(dir)).filter((n) => n !== "store")).toEqual([]);
  });

  test("a key ending in .json cannot clobber another key's metadata", async () => {
    const d = fsDriver(dir);
    await d.put("a", enc.encode("A"), { contentType: "text/a" });
    await d.put("a.json", enc.encode("B"), { contentType: "text/b" });
    const a = (await d.get("a"))!;
    expect(a.contentType).toBe("text/a");
    expect(await text(a.body)).toBe("A");
  });
});

describe("normalizeStorageKey", () => {
  test("accepts the shapes the app uses", () => {
    expect(normalizeStorageKey("transactions/12/uuid-file.pdf")).toEqual(["transactions", "12", "uuid-file.pdf"]);
    expect(normalizeStorageKey("orgs/o1/parties/3/1700000000.webp")).toHaveLength(5);
    expect(normalizeStorageKey("simpany-tax/slots/abc.json")).toHaveLength(3);
  });
});

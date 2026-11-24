import { describe, expect, test } from "bun:test";
import {
  API_KEY_PREFIX,
  ApiKeyInputError,
  apiKeyStatus,
  extractApiKey,
  generateApiKey,
  hashApiKey,
  looksLikeApiKey,
  normalizeApiKeyInput,
} from "./api-keys";

describe("generateApiKey", () => {
  test("pik_ + 43 base64url chars, unique, prefix is the first 12 chars", () => {
    const a = generateApiKey();
    const b = generateApiKey();
    expect(a.key).toMatch(/^pik_[A-Za-z0-9_-]{43}$/);
    expect(a.key).not.toBe(b.key);
    expect(a.prefix).toBe(a.key.slice(0, 12));
    expect(a.prefix.startsWith(API_KEY_PREFIX)).toBe(true);
    expect(looksLikeApiKey(a.key)).toBe(true);
  });
});

describe("hashApiKey", () => {
  test("SHA-256 hex, deterministic, never the key itself", async () => {
    const { key } = generateApiKey();
    const h1 = await hashApiKey(key);
    const h2 = await hashApiKey(key);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    expect(h1).toBe(h2);
    expect(h1).not.toContain(key.slice(4));
    // known vector
    expect(await hashApiKey("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  test("different keys hash differently", async () => {
    expect(await hashApiKey(generateApiKey().key)).not.toBe(await hashApiKey(generateApiKey().key));
  });
});

describe("looksLikeApiKey / extractApiKey", () => {
  const key = generateApiKey().key;
  test("rejects OAuth-looking tokens and junk", () => {
    expect(looksLikeApiKey("eyJhbGciOiJIUzI1NiJ9.e30.x")).toBe(false);
    expect(looksLikeApiKey("pik_short")).toBe(false);
    expect(looksLikeApiKey(`${key}x`)).toBe(false);
    expect(looksLikeApiKey(null)).toBe(false);
  });
  test("reads Authorization: Bearer and X-API-Key", () => {
    expect(extractApiKey(new Request("https://x", { headers: { Authorization: `Bearer ${key}` } }))).toBe(key);
    expect(extractApiKey(new Request("https://x", { headers: { "X-API-Key": key } }))).toBe(key);
    expect(extractApiKey(new Request("https://x", { headers: { Authorization: "Bearer some-oauth-token" } }))).toBeNull();
    expect(extractApiKey(new Request("https://x"))).toBeNull();
  });
});

describe("normalizeApiKeyInput", () => {
  const now = new Date("2026-11-25T03:00:00Z");
  test("trims the name, keeps the scope, no expiry by default", () => {
    expect(normalizeApiKeyInput({ name: "  月結腳本 ", scope: "read" }, now)).toEqual({
      name: "月結腳本",
      scope: "read",
      expiresAt: null,
    });
  });
  test("expiry is the end of that day in Taipei", () => {
    expect(normalizeApiKeyInput({ name: "x", scope: "write", expiresOn: "2026-12-31" }, now).expiresAt).toBe(
      "2026-12-31T15:59:59.000Z",
    );
  });
  test("rejects bad input", () => {
    expect(() => normalizeApiKeyInput({ name: "", scope: "read" }, now)).toThrow(ApiKeyInputError);
    expect(() => normalizeApiKeyInput({ name: "x".repeat(101), scope: "read" }, now)).toThrow("name");
    expect(() => normalizeApiKeyInput({ name: "x", scope: "admin" }, now)).toThrow("scope");
    expect(() => normalizeApiKeyInput({ name: "x", scope: "read", expiresOn: "2026-11-24" }, now)).toThrow("expiresOn");
    expect(() => normalizeApiKeyInput({ name: "x", scope: "read", expiresOn: "tomorrow" }, now)).toThrow("expiresOn");
  });
});

describe("apiKeyStatus", () => {
  const now = new Date("2026-11-25T00:00:00Z");
  test("revoked beats expired beats active", () => {
    expect(apiKeyStatus({ revokedAt: null, expiresAt: null }, now)).toBe("active");
    expect(apiKeyStatus({ revokedAt: null, expiresAt: "2026-12-01T00:00:00Z" }, now)).toBe("active");
    expect(apiKeyStatus({ revokedAt: null, expiresAt: "2026-11-24T00:00:00Z" }, now)).toBe("expired");
    expect(apiKeyStatus({ revokedAt: "2026-11-01T00:00:00Z", expiresAt: "2026-11-24T00:00:00Z" }, now)).toBe("revoked");
  });
});

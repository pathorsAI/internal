import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  EncryptionKeyMissingError,
  LEGACY_KID,
  activeKeyId,
  decryptField,
  decryptJson,
  encryptField,
  encryptJson,
  hasFieldEncryptionKey,
  needsReencrypt,
} from "./crypto";
import {
  employeeAccountNumberContext,
  employeeNationalIdContext,
  integrationCredentialsContext,
  integrationTokenCacheContext,
} from "./field-contexts";

// 測試用的固定金鑰（32 bytes）。不是任何環境的真金鑰。
function keyB64(fill: number): string {
  return btoa(String.fromCodePoint(...new Uint8Array(32).fill(fill)));
}
const K_LEGACY = keyB64(1);
const K_A = keyB64(2);
const K_B = keyB64(3);

const CTX = employeeAccountNumberContext("org_a", 7);

const saved = {
  keys: process.env.FIELD_ENCRYPTION_KEYS,
  key: process.env.FIELD_ENCRYPTION_KEY,
};

function setEnv(env: { keys?: string; key?: string }) {
  if (env.keys === undefined) delete process.env.FIELD_ENCRYPTION_KEYS;
  else process.env.FIELD_ENCRYPTION_KEYS = env.keys;
  if (env.key === undefined) delete process.env.FIELD_ENCRYPTION_KEY;
  else process.env.FIELD_ENCRYPTION_KEY = env.key;
}

/** 用 v1 的舊做法（無 additionalData）產生一筆密文，模擬既有資料。 */
async function legacyV1(plain: string, b64: string): Promise<string> {
  const raw = Uint8Array.from(atob(b64), (ch) => ch.codePointAt(0) ?? 0);
  const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plain)));
  const b = (u: Uint8Array) => btoa(String.fromCodePoint(...u));
  return `v1:${b(iv)}:${b(ct)}`;
}

/** 把 base64 密文的第 n 個 byte 翻一個 bit。 */
function flipByte(enc: string, partIndex: number, n = 0): string {
  const parts = enc.split(":");
  const bytes = Uint8Array.from(atob(parts[partIndex]), (ch) => ch.codePointAt(0) ?? 0);
  bytes[n] ^= 0x01;
  parts[partIndex] = btoa(String.fromCodePoint(...bytes));
  return parts.join(":");
}

beforeEach(() => setEnv({ keys: `a:${K_A}`, key: undefined }));
afterEach(() => setEnv(saved));

describe("roundtrip", () => {
  test("encrypt → decrypt with the same context", async () => {
    const enc = await encryptField("00012345678901", CTX);
    expect(enc.startsWith("v2:a:")).toBe(true);
    expect(enc).not.toContain("00012345678901");
    expect(await decryptField(enc, CTX)).toBe("00012345678901");
  });

  test("unicode and empty strings survive", async () => {
    for (const s of ["", "王小明 Ａ123", "🔐\n\t"]) {
      expect(await decryptField(await encryptField(s, CTX), CTX)).toBe(s);
    }
  });

  test("random IV: same plaintext encrypts differently each time", async () => {
    const a = await encryptField("same", CTX);
    const b = await encryptField("same", CTX);
    expect(a).not.toBe(b);
  });

  test("JSON variant", async () => {
    const ctx = integrationCredentialsContext("org_a", "wise");
    const value = { token: "t-123", nested: { n: 1 } };
    const enc = await encryptJson(value, ctx);
    expect(await decryptJson<typeof value>(enc, ctx)).toEqual(value);
  });
});

describe("context binding", () => {
  test("wrong org fails", async () => {
    const enc = await encryptField("x", employeeNationalIdContext("org_a"));
    await expect(decryptField(enc, employeeNationalIdContext("org_b"))).rejects.toThrow("欄位解密失敗");
  });

  test("wrong row (employee) fails", async () => {
    const enc = await encryptField("x", employeeAccountNumberContext("org_a", 1));
    await expect(decryptField(enc, employeeAccountNumberContext("org_a", 2))).rejects.toThrow();
  });

  test("wrong column fails (credentials vs token cache, same org + provider)", async () => {
    const enc = await encryptField("x", integrationCredentialsContext("org_a", "wise"));
    await expect(decryptField(enc, integrationTokenCacheContext("org_a", "wise"))).rejects.toThrow();
  });

  test("wrong provider fails", async () => {
    const enc = await encryptJson({ a: 1 }, integrationCredentialsContext("org_a", "wise"));
    await expect(decryptJson(enc, integrationCredentialsContext("org_a", "simpany"))).rejects.toThrow();
  });

  test("empty context is rejected on both sides", async () => {
    await expect(encryptField("x", "")).rejects.toThrow("context");
    const enc = await encryptField("x", CTX);
    await expect(decryptField(enc, "")).rejects.toThrow("context");
  });

  test("context helpers reject missing / ambiguous identifiers", () => {
    expect(() => employeeNationalIdContext("")).toThrow();
    expect(() => employeeNationalIdContext("a|b")).toThrow();
    expect(() => integrationCredentialsContext("org_a", "")).toThrow();
    expect(employeeAccountNumberContext("org_a", 7)).toBe(
      "employee_bank_accounts.account_number_enc|org:org_a|employee:7",
    );
  });
});

describe("tampering", () => {
  test("flipped ciphertext byte fails", async () => {
    const enc = await encryptField("secret", CTX);
    await expect(decryptField(flipByte(enc, 3), CTX)).rejects.toThrow("欄位解密失敗");
  });

  test("flipped IV byte fails", async () => {
    const enc = await encryptField("secret", CTX);
    await expect(decryptField(flipByte(enc, 2), CTX)).rejects.toThrow();
  });

  test("swapping the kid to another key fails", async () => {
    setEnv({ keys: `a:${K_A},b:${K_B}` });
    const enc = await encryptField("secret", CTX);
    await expect(decryptField(enc.replace(/^v2:a:/, "v2:b:"), CTX)).rejects.toThrow();
  });

  test("malformed formats are rejected", async () => {
    for (const bad of ["", "plain", "v1:onlyone", "v2:a:iv", "v3:a:b:c", "v2:bad kid:aa:bb", "v2::aa:bb"]) {
      await expect(decryptField(bad, CTX)).rejects.toThrow("無法辨識的密文格式");
    }
  });

  test("v2 ciphertext relabelled as v1 does not decrypt", async () => {
    setEnv({ keys: undefined, key: K_LEGACY });
    const enc = await encryptField("secret", CTX); // v2:legacy:iv:ct
    const [, , iv, ct] = enc.split(":");
    await expect(decryptField(`v1:${iv}:${ct}`, CTX)).rejects.toThrow();
  });
});

describe("legacy v1 and FIELD_ENCRYPTION_KEY", () => {
  test("v1 ciphertext decrypts with FIELD_ENCRYPTION_KEY and ignores context", async () => {
    setEnv({ keys: `a:${K_A}`, key: K_LEGACY });
    const v1 = await legacyV1("A123456789", K_LEGACY);
    expect(await decryptField(v1, CTX)).toBe("A123456789");
    expect(await decryptField(v1, employeeNationalIdContext("any_org"))).toBe("A123456789");
  });

  test("v1 without FIELD_ENCRYPTION_KEY → EncryptionKeyMissingError", async () => {
    const v1 = await legacyV1("A123456789", K_LEGACY);
    setEnv({ keys: `a:${K_A}` });
    await expect(decryptField(v1, CTX)).rejects.toBeInstanceOf(EncryptionKeyMissingError);
  });

  test("legacy key only: new writes are v2 with kid `legacy`, never v1", async () => {
    setEnv({ keys: undefined, key: K_LEGACY });
    expect(activeKeyId()).toBe(LEGACY_KID);
    const enc = await encryptField("x", CTX);
    expect(enc.startsWith(`v2:${LEGACY_KID}:`)).toBe(true);
    expect(await decryptField(enc, CTX)).toBe("x");
    // 綁 context：legacy kid 一樣擋得住搬列
    await expect(decryptField(enc, employeeNationalIdContext("org_a"))).rejects.toThrow();
  });

  test("keyring takes precedence over the legacy key for new writes", async () => {
    setEnv({ keys: `a:${K_A}`, key: K_LEGACY });
    expect(activeKeyId()).toBe("a");
    expect((await encryptField("x", CTX)).startsWith("v2:a:")).toBe(true);
  });

  test("v2:legacy written before the keyring existed still decrypts after adding one", async () => {
    setEnv({ keys: undefined, key: K_LEGACY });
    const enc = await encryptField("x", CTX);
    setEnv({ keys: `a:${K_A}`, key: K_LEGACY });
    expect(await decryptField(enc, CTX)).toBe("x");
    expect(needsReencrypt(enc)).toBe(true);
  });

  test("`legacy` is a reserved kid in FIELD_ENCRYPTION_KEYS", () => {
    setEnv({ keys: `legacy:${K_A}` });
    expect(() => activeKeyId()).toThrow("保留");
  });
});

describe("key rotation", () => {
  test("old kid still decrypts after a new key is prepended", async () => {
    setEnv({ keys: `a:${K_A}` });
    const old = await encryptField("rotate-me", CTX);
    setEnv({ keys: `b:${K_B},a:${K_A}` });
    expect(activeKeyId()).toBe("b");
    expect(await decryptField(old, CTX)).toBe("rotate-me");
    const fresh = await encryptField("rotate-me", CTX);
    expect(fresh.startsWith("v2:b:")).toBe(true);
  });

  test("removed kid → EncryptionKeyMissingError naming the kid", async () => {
    setEnv({ keys: `a:${K_A}` });
    const old = await encryptField("x", CTX);
    setEnv({ keys: `b:${K_B}` });
    await expect(decryptField(old, CTX)).rejects.toThrow("「a」");
    await expect(decryptField(old, CTX)).rejects.toBeInstanceOf(EncryptionKeyMissingError);
  });

  test("needsReencrypt: v1 and non-active kid are stale; active kid is not", async () => {
    setEnv({ keys: `a:${K_A}`, key: K_LEGACY });
    const v1 = await legacyV1("x", K_LEGACY);
    const onA = await encryptField("x", CTX);
    expect(needsReencrypt(v1)).toBe(true);
    expect(needsReencrypt(onA)).toBe(false);
    setEnv({ keys: `b:${K_B},a:${K_A}`, key: K_LEGACY });
    expect(needsReencrypt(onA)).toBe(true);
    expect(needsReencrypt(await encryptField("x", CTX))).toBe(false);
    expect(() => needsReencrypt("garbage")).toThrow();
  });

  test("re-encrypting (decrypt + encrypt with same context) moves a value to the active key", async () => {
    setEnv({ keys: `b:${K_B},a:${K_A}`, key: K_LEGACY });
    const v1 = await legacyV1("payload", K_LEGACY);
    const upgraded = await encryptField(await decryptField(v1, CTX), CTX);
    expect(upgraded.startsWith("v2:b:")).toBe(true);
    expect(needsReencrypt(upgraded)).toBe(false);
    // 舊金鑰全部拿掉之後仍然解得開
    setEnv({ keys: `b:${K_B}` });
    expect(await decryptField(upgraded, CTX)).toBe("payload");
  });
});

describe("configuration errors", () => {
  test("no key at all → EncryptionKeyMissingError", async () => {
    setEnv({});
    expect(hasFieldEncryptionKey()).toBe(false);
    await expect(encryptField("x", CTX)).rejects.toBeInstanceOf(EncryptionKeyMissingError);
    await expect(decryptField("v2:a:AAAA:AAAA", CTX)).rejects.toBeInstanceOf(EncryptionKeyMissingError);
  });

  test("whitespace-only values count as unset", () => {
    setEnv({ keys: "  ", key: " " });
    expect(hasFieldEncryptionKey()).toBe(false);
    expect(() => activeKeyId()).toThrow(EncryptionKeyMissingError);
  });

  test("wrong key length is rejected", async () => {
    setEnv({ keys: `a:${btoa("too short")}` });
    await expect(encryptField("x", CTX)).rejects.toThrow("32 bytes");
    setEnv({ key: btoa("too short") });
    await expect(encryptField("x", CTX)).rejects.toThrow("32 bytes");
  });

  test("malformed keyring entries are rejected", () => {
    for (const bad of [K_A, `:${K_A}`, "a:", `bad kid:${K_A}`, `a:${K_A},a:${K_B}`]) {
      setEnv({ keys: bad });
      expect(() => activeKeyId()).toThrow();
    }
  });

  test("blank entries and spaces in the keyring are tolerated", async () => {
    setEnv({ keys: ` a : ${K_A} , , b:${K_B} ` });
    expect(activeKeyId()).toBe("a");
    expect(await decryptField(await encryptField("x", CTX), CTX)).toBe("x");
  });
});

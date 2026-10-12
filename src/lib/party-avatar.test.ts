import { describe, expect, test } from "bun:test";
import {
  AVATAR_FALLBACK_COLORS,
  AVATAR_MAX_SOURCE_BYTES,
  AVATAR_MAX_UPLOAD_BYTES,
  avatarColorClass,
  avatarInitial,
  buildPartyAvatarKey,
  partyAvatarKeyType,
  partyAvatarUrl,
  sniffImageType,
  validateAvatarBytes,
  validateAvatarSource,
} from "./party-avatar";

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff, 0xe0];
const WEBP = [0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38];

function bytes(head: number[], total = head.length + 16): Uint8Array {
  const out = new Uint8Array(total);
  out.set(head);
  return out;
}
const text = (s: string) => new TextEncoder().encode(s);

describe("sniffImageType", () => {
  test("recognises PNG / JPEG / WebP by magic bytes", () => {
    expect(sniffImageType(bytes(PNG))).toBe("image/png");
    expect(sniffImageType(bytes(JPEG))).toBe("image/jpeg");
    expect(sniffImageType(bytes(WEBP))).toBe("image/webp");
  });

  test("rejects SVG, HTML, GIF and RIFF containers that are not WebP", () => {
    expect(sniffImageType(text('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'))).toBeNull();
    expect(sniffImageType(text("<!doctype html><script>alert(1)</script>"))).toBeNull();
    expect(sniffImageType(text("GIF89a......"))).toBeNull();
    // RIFF....WAVE（音訊）不是 WebP
    expect(sniffImageType(bytes([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]))).toBeNull();
  });

  test("truncated headers are not accepted", () => {
    expect(sniffImageType(new Uint8Array(PNG.slice(0, 4)))).toBeNull();
    expect(sniffImageType(new Uint8Array(WEBP.slice(0, 10)))).toBeNull();
    expect(sniffImageType(new Uint8Array())).toBeNull();
  });
});

describe("validateAvatarBytes (server)", () => {
  test("accepts a small WebP and reports its real type", () => {
    expect(validateAvatarBytes(bytes(WEBP, 20_000))).toEqual({ ok: true, type: "image/webp" });
  });

  test("rejects empty uploads", () => {
    expect(validateAvatarBytes(new Uint8Array())).toEqual({ ok: false, reason: "empty" });
  });

  test("rejects anything over 200 KB, even with a valid header", () => {
    expect(validateAvatarBytes(bytes(PNG, AVATAR_MAX_UPLOAD_BYTES))).toEqual({ ok: true, type: "image/png" });
    expect(validateAvatarBytes(bytes(PNG, AVATAR_MAX_UPLOAD_BYTES + 1))).toEqual({ ok: false, reason: "tooLarge" });
  });

  test("ignores the declared type: SVG content is rejected whatever it claims to be", () => {
    expect(validateAvatarBytes(text("<svg onload=alert(1)>"))).toEqual({ ok: false, reason: "type" });
  });
});

describe("validateAvatarSource (client pre-check)", () => {
  test("allows PNG / JPEG / WebP up to 1 MB", () => {
    expect(validateAvatarSource({ size: AVATAR_MAX_SOURCE_BYTES, type: "image/png" }).ok).toBe(true);
    expect(validateAvatarSource({ size: 10, type: "image/jpeg" }).ok).toBe(true);
    expect(validateAvatarSource({ size: 10, type: "image/webp" }).ok).toBe(true);
  });

  test("rejects SVG, GIF, oversize and empty files", () => {
    expect(validateAvatarSource({ size: 10, type: "image/svg+xml" })).toEqual({ ok: false, reason: "type" });
    expect(validateAvatarSource({ size: 10, type: "image/gif" })).toEqual({ ok: false, reason: "type" });
    expect(validateAvatarSource({ size: AVATAR_MAX_SOURCE_BYTES + 1, type: "image/png" })).toEqual({
      ok: false,
      reason: "tooLarge",
    });
    expect(validateAvatarSource({ size: 0, type: "image/png" })).toEqual({ ok: false, reason: "empty" });
  });
});

describe("buildPartyAvatarKey", () => {
  test("is namespaced by organization and party", () => {
    expect(buildPartyAvatarKey("org_A1", 42, 1_760_000_000_000)).toBe(
      "orgs/org_A1/parties/42/avatar-1760000000000.webp",
    );
    expect(buildPartyAvatarKey("org_A1", 42, 1, "image/jpeg")).toBe("orgs/org_A1/parties/42/avatar-1.jpg");
    expect(buildPartyAvatarKey("org_A1", 42, 1, "image/png")).toBe("orgs/org_A1/parties/42/avatar-1.png");
  });

  test("refuses ids that could escape the prefix", () => {
    expect(() => buildPartyAvatarKey("../other", 1, 1)).toThrow();
    expect(() => buildPartyAvatarKey("org/../x", 1, 1)).toThrow();
    expect(() => buildPartyAvatarKey("", 1, 1)).toThrow();
    expect(() => buildPartyAvatarKey("org", 0, 1)).toThrow();
    expect(() => buildPartyAvatarKey("org", 1.5, 1)).toThrow();
    expect(() => buildPartyAvatarKey("org", 1, -1)).toThrow();
  });
});

describe("partyAvatarKeyType", () => {
  const key = "orgs/orgA/parties/7/avatar-123.webp";

  test("accepts the party's own key and maps the extension to a type", () => {
    expect(partyAvatarKeyType(key, "orgA", 7)).toBe("image/webp");
    expect(partyAvatarKeyType("orgs/orgA/parties/7/avatar-1.jpg", "orgA", 7)).toBe("image/jpeg");
  });

  test("rejects another organization's or another party's key", () => {
    expect(partyAvatarKeyType(key, "orgB", 7)).toBeNull();
    expect(partyAvatarKeyType(key, "orgA", 8)).toBeNull();
    // 前綴相同但組織 id 較長
    expect(partyAvatarKeyType("orgs/orgAB/parties/7/avatar-1.webp", "orgA", 7)).toBeNull();
  });

  test("rejects malformed keys, documents and SVGs", () => {
    expect(partyAvatarKeyType(null, "orgA", 7)).toBeNull();
    expect(partyAvatarKeyType("transactions/7/abc-receipt.png", "orgA", 7)).toBeNull();
    expect(partyAvatarKeyType("orgs/orgA/parties/7/avatar-1.svg", "orgA", 7)).toBeNull();
    expect(partyAvatarKeyType("orgs/orgA/parties/7/../8/avatar-1.webp", "orgA", 7)).toBeNull();
  });
});

describe("partyAvatarUrl", () => {
  test("adds the version as a cache-busting query param", () => {
    expect(partyAvatarUrl(5, "1760000000000")).toBe("/api/parties/5/avatar?v=1760000000000");
  });

  test("returns null when the party has no avatar", () => {
    expect(partyAvatarUrl(5, null)).toBeNull();
    expect(partyAvatarUrl(5, undefined)).toBeNull();
  });
});

describe("fallback initial and colour", () => {
  test("takes the first letter, digit or CJK character", () => {
    expect(avatarInitial("aws")).toBe("A");
    expect(avatarInitial("中華電信")).toBe("中");
    expect(avatarInitial("（股）台積電")).toBe("股");
    expect(avatarInitial("  3M")).toBe("3");
    expect(avatarInitial("---")).toBe("?");
  });

  test("colour is deterministic and one of the theme-safe classes", () => {
    expect(avatarColorClass("Vercel")).toBe(avatarColorClass("Vercel"));
    expect(avatarColorClass(" Vercel ")).toBe(avatarColorClass("Vercel"));
    expect(AVATAR_FALLBACK_COLORS).toContain(avatarColorClass("中華電信") as (typeof AVATAR_FALLBACK_COLORS)[number]);
    for (const c of AVATAR_FALLBACK_COLORS) expect(c).toContain("dark:");
  });
});

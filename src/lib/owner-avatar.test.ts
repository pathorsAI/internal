import { describe, expect, test } from "bun:test";
import { buildOwnerAvatarKey, ownerAvatarKeyType, ownerAvatarUrl } from "./owner-avatar";
import {
  readOwnerAvatar,
  removeOwnerAvatar,
  replaceOwnerAvatar,
  type OwnerAvatarDeps,
} from "./owner-avatar-store";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

describe("owner avatar keys", () => {
  test("namespaced per org / user", () => {
    expect(buildOwnerAvatarKey("org", "org_1", 5, "image/png")).toBe("orgs/org_1/logo-5.png");
    expect(buildOwnerAvatarKey("user", "u1", 5)).toBe("users/u1/avatar-5.webp");
    expect(ownerAvatarUrl("org", "org_1", 5)).toBe("/api/orgs/org_1/logo?v=5");
    expect(ownerAvatarUrl("user", "u1", 5)).toBe("/api/users/u1/avatar?v=5");
  });

  test("a key only belongs to its own owner and kind", () => {
    expect(ownerAvatarKeyType("orgs/a/logo-1.jpg", "org", "a")).toBe("image/jpeg");
    expect(ownerAvatarKeyType("orgs/a/logo-1.jpg", "org", "b")).toBeNull();
    expect(ownerAvatarKeyType("orgs/a/logo-1.jpg", "user", "a")).toBeNull();
    expect(ownerAvatarKeyType("orgs/a/parties/3/avatar-1.webp", "org", "a")).toBeNull();
    expect(ownerAvatarKeyType("users/u/avatar-1.svg", "user", "u")).toBeNull();
    expect(ownerAvatarKeyType("users/../x/avatar-1.png", "user", "..")).toBeNull();
  });

  test("rejects ids that could escape the prefix", () => {
    expect(() => buildOwnerAvatarKey("user", "../evil", 1)).toThrow();
  });
});

function fakeDeps(rows: Record<string, string | null>) {
  const objects = new Map<string, Uint8Array>();
  const saved: { id: string; key: string | null; url: string | null }[] = [];
  const deleted: string[] = [];
  let t = 1000;
  const deps: OwnerAvatarDeps = {
    load: async (_k, id) => (id in rows ? { id, avatarKey: rows[id] } : null),
    save: async (_k, id, key, url) => {
      if (!(id in rows)) return false;
      rows[id] = key;
      saved.push({ id, key, url });
      return true;
    },
    putObject: async (key, body) => void objects.set(key, body),
    deleteObject: async (key) => {
      deleted.push(key);
      objects.delete(key);
    },
    getObject: async (key) =>
      objects.has(key) ? new ReadableStream({ start: (c) => (c.enqueue(objects.get(key)), c.close()) }) : null,
    now: () => new Date(t++),
  };
  return { deps, objects, saved, deleted, rows };
}

describe("owner avatar store", () => {
  test("replace writes the object, saves key + url, deletes the old one", async () => {
    const f = fakeDeps({ u1: "users/u1/avatar-1.png" });
    f.objects.set("users/u1/avatar-1.png", PNG);
    const res = await replaceOwnerAvatar(f.deps, { kind: "user", id: "u1", bytes: PNG });
    expect(res).toEqual({ ok: true, url: "/api/users/u1/avatar?v=1000" });
    expect(f.saved[0]).toEqual({ id: "u1", key: "users/u1/avatar-1000.png", url: "/api/users/u1/avatar?v=1000" });
    expect(f.deleted).toEqual(["users/u1/avatar-1.png"]);
  });

  test("rejects non-images and unknown owners", async () => {
    const f = fakeDeps({ o: null });
    expect(await replaceOwnerAvatar(f.deps, { kind: "org", id: "o", bytes: new Uint8Array([1, 2, 3]) })).toEqual({
      ok: false,
      error: "type",
    });
    expect(await replaceOwnerAvatar(f.deps, { kind: "org", id: "nobody", bytes: PNG })).toEqual({
      ok: false,
      error: "notFound",
    });
    expect(f.objects.size).toBe(0);
  });

  test("never deletes an object outside the owner's prefix", async () => {
    const f = fakeDeps({ o: "orgs/other/logo-1.png" });
    await removeOwnerAvatar(f.deps, { kind: "org", id: "o" });
    expect(f.deleted).toEqual([]);
    expect(f.saved[0]).toEqual({ id: "o", key: null, url: null });
  });

  test("read only streams the owner's own key", async () => {
    const f = fakeDeps({ o: "orgs/o/logo-1.png", p: "orgs/o/logo-1.png" });
    f.objects.set("orgs/o/logo-1.png", PNG);
    expect((await readOwnerAvatar(f.deps, { kind: "org", id: "o" }))?.contentType).toBe("image/png");
    expect(await readOwnerAvatar(f.deps, { kind: "org", id: "p" })).toBeNull();
  });
});

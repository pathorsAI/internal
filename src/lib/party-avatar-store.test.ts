import { describe, expect, test } from "bun:test";
import {
  readPartyAvatar,
  removePartyAvatar,
  replacePartyAvatar,
  type AvatarPartyRow,
  type PartyAvatarDeps,
} from "./party-avatar-store";

const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x24, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20]);
const NOW = new Date("2026-10-12T00:00:00.000Z");

type Row = AvatarPartyRow & { organizationId: string };

/**
 * 假的 deps：模擬一個有兩個組織的資料庫與 R2。
 * honorOrg = true 時 loadParty 跟正式實作一樣帶 org 條件；false 用來模擬「查詢的租戶條件
 * 哪天被改壞了」，驗第二道檢查還擋得住。
 */
function fakeDeps(rows: Row[], { honorOrg = true } = {}) {
  const objects = new Map<string, Uint8Array>();
  for (const r of rows) if (r.avatarR2Key) objects.set(r.avatarR2Key, new Uint8Array([1]));
  const calls = { put: [] as string[], deleted: [] as string[], get: [] as string[], saved: [] as string[] };
  const deps: PartyAvatarDeps = {
    async loadParty(orgId, partyId) {
      const row = rows.find((r) => r.id === partyId && (!honorOrg || r.organizationId === orgId));
      return row ? { ...row } : null;
    },
    async saveAvatar(orgId, partyId, key) {
      const row = rows.find((r) => r.id === partyId && r.organizationId === orgId);
      if (!row) return false;
      row.avatarR2Key = key;
      calls.saved.push(`${orgId}/${partyId}`);
      return true;
    },
    async putObject(key, body) {
      calls.put.push(key);
      objects.set(key, body);
    },
    async deleteObject(key) {
      calls.deleted.push(key);
      objects.delete(key);
    },
    async getObject(key) {
      calls.get.push(key);
      return objects.has(key) ? new ReadableStream() : null;
    },
    now: () => NOW,
  };
  return { deps, calls, objects, rows };
}

const orgAParty = (avatarR2Key: string | null = null): Row => ({ id: 1, organizationId: "orgA", avatarR2Key });
const orgBParty = (avatarR2Key: string | null = null): Row => ({ id: 2, organizationId: "orgB", avatarR2Key });

describe("replacePartyAvatar", () => {
  test("stores under the org namespace, updates the row and deletes the previous object", async () => {
    const old = "orgs/orgA/parties/1/avatar-1.webp";
    const { deps, calls, objects, rows } = fakeDeps([orgAParty(old)]);
    const res = await replacePartyAvatar(deps, { orgId: "orgA", partyId: 1, bytes: WEBP });

    const expected = `orgs/orgA/parties/1/avatar-${NOW.getTime()}.webp`;
    expect(res).toEqual({ ok: true, key: expected });
    expect(calls.put).toEqual([expected]);
    expect(rows[0].avatarR2Key).toBe(expected);
    expect(calls.deleted).toEqual([old]);
    expect(objects.has(old)).toBe(false);
  });

  test("rejects another organization's party without touching R2 or the DB", async () => {
    const { deps, calls } = fakeDeps([orgAParty(), orgBParty()]);
    const res = await replacePartyAvatar(deps, { orgId: "orgA", partyId: 2, bytes: WEBP });

    expect(res).toEqual({ ok: false, error: "notFound" });
    expect(calls.put).toEqual([]);
    expect(calls.saved).toEqual([]);
    expect(calls.deleted).toEqual([]);
  });

  test("still rejects a cross-org row if the query's org filter is ever broken", async () => {
    const { deps, calls } = fakeDeps([orgBParty("orgs/orgB/parties/2/avatar-1.webp")], { honorOrg: false });
    const res = await replacePartyAvatar(deps, { orgId: "orgA", partyId: 2, bytes: WEBP });

    expect(res).toEqual({ ok: false, error: "notFound" });
    expect(calls.put).toEqual([]);
    expect(calls.deleted).toEqual([]);
  });

  test("validates the bytes before anything else", async () => {
    const { deps, calls } = fakeDeps([orgAParty()]);
    const svg = new TextEncoder().encode("<svg onload=alert(1)>");
    expect(await replacePartyAvatar(deps, { orgId: "orgA", partyId: 1, bytes: svg })).toEqual({
      ok: false,
      error: "type",
    });
    expect(calls.put).toEqual([]);
  });

  test("never deletes an old key that is outside the party's own prefix", async () => {
    const foreign = "orgs/orgB/parties/2/avatar-1.webp";
    const { deps, calls } = fakeDeps([orgAParty(foreign), orgBParty(foreign)]);
    const res = await replacePartyAvatar(deps, { orgId: "orgA", partyId: 1, bytes: WEBP });

    expect(res.ok).toBe(true);
    expect(calls.deleted).toEqual([]);
  });
});

describe("removePartyAvatar", () => {
  test("clears the row and deletes the object", async () => {
    const key = "orgs/orgA/parties/1/avatar-1.webp";
    const { deps, calls, rows } = fakeDeps([orgAParty(key)]);
    expect(await removePartyAvatar(deps, { orgId: "orgA", partyId: 1 })).toEqual({ ok: true, key: null });
    expect(rows[0].avatarR2Key).toBeNull();
    expect(calls.deleted).toEqual([key]);
  });

  test("rejects another organization's party", async () => {
    const key = "orgs/orgB/parties/2/avatar-1.webp";
    const { deps, calls, rows } = fakeDeps([orgBParty(key)], { honorOrg: false });
    expect(await removePartyAvatar(deps, { orgId: "orgA", partyId: 2 })).toEqual({ ok: false, error: "notFound" });
    expect(rows[0].avatarR2Key).toBe(key);
    expect(calls.deleted).toEqual([]);
  });
});

describe("readPartyAvatar", () => {
  test("streams the party's own avatar with a type derived from the key", async () => {
    const key = "orgs/orgA/parties/1/avatar-1.webp";
    const { deps, calls } = fakeDeps([orgAParty(key)]);
    const res = await readPartyAvatar(deps, { orgId: "orgA", partyId: 1 });
    expect(res?.contentType).toBe("image/webp");
    expect(calls.get).toEqual([key]);
  });

  test("returns null for another organization's party without reading R2", async () => {
    const { deps, calls } = fakeDeps([orgBParty("orgs/orgB/parties/2/avatar-1.webp")]);
    expect(await readPartyAvatar(deps, { orgId: "orgA", partyId: 2 })).toBeNull();

    const broken = fakeDeps([orgBParty("orgs/orgB/parties/2/avatar-1.webp")], { honorOrg: false });
    expect(await readPartyAvatar(broken.deps, { orgId: "orgA", partyId: 2 })).toBeNull();
    expect(calls.get).toEqual([]);
    expect(broken.calls.get).toEqual([]);
  });

  test("returns null when the stored key points outside the party's prefix", async () => {
    const { deps, calls } = fakeDeps([orgAParty("orgs/orgB/parties/2/avatar-1.webp")]);
    expect(await readPartyAvatar(deps, { orgId: "orgA", partyId: 1 })).toBeNull();
    expect(calls.get).toEqual([]);
  });

  test("returns null when there is no avatar or the object is missing", async () => {
    expect(await readPartyAvatar(fakeDeps([orgAParty()]).deps, { orgId: "orgA", partyId: 1 })).toBeNull();
    const missing = fakeDeps([orgAParty("orgs/orgA/parties/1/avatar-1.webp")]);
    missing.objects.clear();
    expect(await readPartyAvatar(missing.deps, { orgId: "orgA", partyId: 1 })).toBeNull();
  });

  test("bad ids never reach the loader", async () => {
    const { deps } = fakeDeps([orgAParty("orgs/orgA/parties/1/avatar-1.webp")]);
    expect(await readPartyAvatar(deps, { orgId: "orgA", partyId: Number.NaN })).toBeNull();
    expect(await readPartyAvatar(deps, { orgId: "orgA", partyId: -1 })).toBeNull();
  });
});

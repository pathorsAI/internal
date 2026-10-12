/**
 * 交易對象頭像的讀寫流程（換圖 / 移除 / 讀取）。
 *
 * 流程本身不直接 import DB 或 R2，而是吃一組 deps：正式環境用
 * src/lib/party-avatar-deps.ts 的實作，測試可以塞假的，專門驗「別的組織的交易對象一律
 * 當作不存在」這條路徑（src/lib/party-avatar-store.test.ts）。
 *
 * 多租戶隔離有兩層：
 *   1. loadParty 的查詢本身就帶 organization_id 條件（查詢就帶租戶，而不是查完再比對）；
 *   2. 這裡再比一次 row.organizationId，並確認 key 落在 orgs/<orgId>/parties/<partyId>/ 底下。
 * 第二層在正常情況下永遠不會擋到東西 —— 它存在的理由是第一層哪天被改壞時，不會悄悄變成
 * 跨組織讀寫。兩種失敗都回 notFound（不說「那筆屬於別的組織」，那本身就是洩漏）。
 */

import {
  buildPartyAvatarKey,
  partyAvatarKeyType,
  validateAvatarBytes,
  type AvatarImageType,
} from "./party-avatar";

export type AvatarPartyRow = {
  id: number;
  organizationId: string | null;
  avatarR2Key: string | null;
};

export type PartyAvatarDeps = {
  /** 查單一交易對象（必須已帶 organization_id = orgId 與未刪除的條件）。 */
  loadParty(orgId: string, partyId: number): Promise<AvatarPartyRow | null>;
  /** 更新該列的 avatar_r2_key / avatar_updated_at（同樣帶 org 條件）；回傳是否真的改到一列。 */
  saveAvatar(orgId: string, partyId: number, key: string | null, updatedAt: string): Promise<boolean>;
  putObject(key: string, body: Uint8Array, contentType: string): Promise<void>;
  deleteObject(key: string): Promise<void>;
  getObject(key: string): Promise<ReadableStream | null>;
  now(): Date;
};

export type AvatarWriteError = "notFound" | "empty" | "tooLarge" | "type";
export type AvatarWriteResult = { ok: true; key: string | null } | { ok: false; error: AvatarWriteError };

/** 只有真的屬於這個組織的交易對象才回傳，其餘一律 null。 */
async function ownedParty(
  deps: Pick<PartyAvatarDeps, "loadParty">,
  orgId: string,
  partyId: number,
): Promise<AvatarPartyRow | null> {
  if (!Number.isSafeInteger(partyId) || partyId <= 0) return null;
  const row = await deps.loadParty(orgId, partyId);
  if (row?.organizationId !== orgId || row.id !== partyId) return null;
  return row;
}

/** 舊物件刪不掉不影響結果（只是在 R2 留一個孤兒），但要確定刪的是自己的。 */
async function deleteOldAvatar(
  deps: Pick<PartyAvatarDeps, "deleteObject">,
  orgId: string,
  partyId: number,
  oldKey: string | null,
  newKey: string | null,
) {
  if (!oldKey || oldKey === newKey) return;
  if (!partyAvatarKeyType(oldKey, orgId, partyId)) return;
  try {
    await deps.deleteObject(oldKey);
  } catch (e) {
    console.warn("[party-avatar] failed to delete old avatar", oldKey, e);
  }
}

/**
 * 換頭像：驗內容 → 確認歸屬 → 寫 R2 → 更新 DB → 刪舊圖。
 * 先寫 R2 再更新 DB：DB 更新失敗頂多留一個沒人指到的物件，反過來則會讓 DB 指向不存在的圖。
 */
export async function replacePartyAvatar(
  deps: PartyAvatarDeps,
  input: { orgId: string; partyId: number; bytes: Uint8Array },
): Promise<AvatarWriteResult> {
  const { orgId, partyId, bytes } = input;
  const check = validateAvatarBytes(bytes);
  if (!check.ok) return { ok: false, error: check.reason };

  const party = await ownedParty(deps, orgId, partyId);
  if (!party) return { ok: false, error: "notFound" };

  const now = deps.now();
  const key = buildPartyAvatarKey(orgId, partyId, now.getTime(), check.type);
  await deps.putObject(key, bytes, check.type);
  const saved = await deps.saveAvatar(orgId, partyId, key, now.toISOString());
  if (!saved) {
    // 在檢查與寫入之間被刪掉了：把剛寫的物件收回來
    await deleteOldAvatar(deps, orgId, partyId, key, null);
    return { ok: false, error: "notFound" };
  }
  await deleteOldAvatar(deps, orgId, partyId, party.avatarR2Key, key);
  return { ok: true, key };
}

/** 移除頭像：清 DB 欄位 → 刪 R2 物件。本來就沒有頭像也算成功。 */
export async function removePartyAvatar(
  deps: PartyAvatarDeps,
  input: { orgId: string; partyId: number },
): Promise<AvatarWriteResult> {
  const { orgId, partyId } = input;
  const party = await ownedParty(deps, orgId, partyId);
  if (!party) return { ok: false, error: "notFound" };
  if (!party.avatarR2Key) return { ok: true, key: null };

  const saved = await deps.saveAvatar(orgId, partyId, null, deps.now().toISOString());
  if (!saved) return { ok: false, error: "notFound" };
  await deleteOldAvatar(deps, orgId, partyId, party.avatarR2Key, null);
  return { ok: true, key: null };
}

/** 讀頭像：只有該組織自己的交易對象、且 key 在它的前綴底下，才會去 R2 拿。 */
export async function readPartyAvatar(
  deps: Pick<PartyAvatarDeps, "loadParty" | "getObject">,
  input: { orgId: string; partyId: number },
): Promise<{ body: ReadableStream; contentType: AvatarImageType } | null> {
  const { orgId, partyId } = input;
  const party = await ownedParty(deps, orgId, partyId);
  if (!party) return null;
  const contentType = partyAvatarKeyType(party.avatarR2Key, orgId, partyId);
  if (!contentType || !party.avatarR2Key) return null;
  const body = await deps.getObject(party.avatarR2Key);
  return body ? { body, contentType } : null;
}

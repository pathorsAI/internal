/**
 * 組織 logo／使用者頭像的換圖、移除、讀取流程。跟 src/lib/party-avatar-store.ts 同樣的做法：
 * 流程吃一組 deps（正式環境見 owner-avatar-deps.ts，測試塞假的），先寫物件再更新 DB、最後刪舊圖。
 *
 * 權限不在這裡判斷：呼叫端（server action、API route）先決定「這個人能不能動／看這個組織或使用者」，
 * 這裡只保證 key 一定落在該組織／使用者自己的前綴底下。
 */

import { validateAvatarBytes, type AvatarImageType } from "./party-avatar";
import {
  buildOwnerAvatarKey,
  isOwnerId,
  ownerAvatarKeyType,
  ownerAvatarUrl,
  type OwnerKind,
} from "./owner-avatar";

export type OwnerAvatarRow = { id: string; avatarKey: string | null };

export type OwnerAvatarDeps = {
  load(kind: OwnerKind, id: string): Promise<OwnerAvatarRow | null>;
  /** 同時寫物件 key 與給 UI 的網址（organization.logo / user.image）；回傳是否改到一列。 */
  save(kind: OwnerKind, id: string, key: string | null, url: string | null): Promise<boolean>;
  putObject(key: string, body: Uint8Array, contentType: string): Promise<void>;
  deleteObject(key: string): Promise<void>;
  getObject(key: string): Promise<ReadableStream | null>;
  now(): Date;
};

export type OwnerAvatarError = "notFound" | "empty" | "tooLarge" | "type";
export type OwnerAvatarResult =
  | { ok: true; url: string | null }
  | { ok: false; error: OwnerAvatarError };

async function owned(
  deps: Pick<OwnerAvatarDeps, "load">,
  kind: OwnerKind,
  id: string,
): Promise<OwnerAvatarRow | null> {
  if (!isOwnerId(id)) return null;
  const row = await deps.load(kind, id);
  return row?.id === id ? row : null;
}

/** 舊物件刪不掉只會留一個孤兒，不影響結果；但只刪落在自己前綴底下的。 */
async function deleteOld(
  deps: Pick<OwnerAvatarDeps, "deleteObject">,
  kind: OwnerKind,
  id: string,
  oldKey: string | null,
  newKey: string | null,
) {
  if (!oldKey || oldKey === newKey) return;
  if (!ownerAvatarKeyType(oldKey, kind, id)) return;
  try {
    await deps.deleteObject(oldKey);
  } catch (e) {
    console.warn("[owner-avatar] failed to delete old avatar", oldKey, e);
  }
}

export async function replaceOwnerAvatar(
  deps: OwnerAvatarDeps,
  input: { kind: OwnerKind; id: string; bytes: Uint8Array },
): Promise<OwnerAvatarResult> {
  const { kind, id, bytes } = input;
  const check = validateAvatarBytes(bytes);
  if (!check.ok) return { ok: false, error: check.reason };
  const row = await owned(deps, kind, id);
  if (!row) return { ok: false, error: "notFound" };

  const ts = deps.now().getTime();
  const key = buildOwnerAvatarKey(kind, id, ts, check.type);
  const url = ownerAvatarUrl(kind, id, ts);
  await deps.putObject(key, bytes, check.type);
  if (!(await deps.save(kind, id, key, url))) {
    await deleteOld(deps, kind, id, key, null);
    return { ok: false, error: "notFound" };
  }
  await deleteOld(deps, kind, id, row.avatarKey, key);
  return { ok: true, url };
}

/** 移除：清 key 與網址（包括 Google 登入帶進來的外部頭像網址），再刪物件。 */
export async function removeOwnerAvatar(
  deps: OwnerAvatarDeps,
  input: { kind: OwnerKind; id: string },
): Promise<OwnerAvatarResult> {
  const { kind, id } = input;
  const row = await owned(deps, kind, id);
  if (!row) return { ok: false, error: "notFound" };
  if (!(await deps.save(kind, id, null, null))) return { ok: false, error: "notFound" };
  await deleteOld(deps, kind, id, row.avatarKey, null);
  return { ok: true, url: null };
}

export async function readOwnerAvatar(
  deps: Pick<OwnerAvatarDeps, "load" | "getObject">,
  input: { kind: OwnerKind; id: string },
): Promise<{ body: ReadableStream; contentType: AvatarImageType } | null> {
  const row = await owned(deps, input.kind, input.id);
  if (!row?.avatarKey) return null;
  const contentType = ownerAvatarKeyType(row.avatarKey, input.kind, input.id);
  if (!contentType) return null;
  const body = await deps.getObject(row.avatarKey);
  return body ? { body, contentType } : null;
}

/**
 * 組織 logo 與使用者頭像的純函式：物件 key、網址。client / server 共用，不能 import server-only 的東西。
 *
 * 格式驗證、大小限制、瀏覽器端縮圖都跟交易對象頭像同一套（src/lib/party-avatar.ts）：
 * PNG / JPEG / WebP、縮成 256×256、上傳 ≤ 200 KB、不收 SVG。
 *
 * - 組織：orgs/<orgId>/logo-<毫秒>.<ext>，網址 /api/orgs/<orgId>/logo?v=<毫秒>
 * - 使用者：users/<userId>/avatar-<毫秒>.<ext>，網址 /api/users/<userId>/avatar?v=<毫秒>
 *
 * 網址寫進 better-auth 既有的 organization.logo / user.image，所以 session、組織清單這些
 * 本來就會帶這兩欄的地方不用改就拿得到；物件 key 另外存在 logo_key / avatar_key（migrations/0039）。
 */

import type { AvatarImageType } from "./party-avatar";

export type OwnerKind = "org" | "user";

const EXT: Record<AvatarImageType, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};
const TYPE_BY_EXT: Record<string, AvatarImageType> = {
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
};

// better-auth 的 id 是英數字串；保守一點也放行 _ 與 -。
const ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

export function isOwnerId(id: string): boolean {
  return ID_RE.test(id);
}

function assertId(id: string) {
  if (!isOwnerId(id)) throw new Error("Invalid owner id for avatar key");
}

/** 這個組織／使用者的頭像物件放在這個前綴底下。 */
export function ownerAvatarPrefix(kind: OwnerKind, id: string): string {
  assertId(id);
  return kind === "org" ? `orgs/${id}/logo-` : `users/${id}/avatar-`;
}

export function buildOwnerAvatarKey(
  kind: OwnerKind,
  id: string,
  timestamp: number,
  type: AvatarImageType = "image/webp",
): string {
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) throw new Error("Invalid avatar timestamp");
  return `${ownerAvatarPrefix(kind, id)}${timestamp}.${EXT[type]}`;
}

const KEY_RE = {
  org: /^orgs\/([A-Za-z0-9_-]{1,128})\/logo-(\d+)\.(webp|png|jpg)$/,
  user: /^users\/([A-Za-z0-9_-]{1,128})\/avatar-(\d+)\.(webp|png|jpg)$/,
} as const;

/**
 * 這個 key 是不是「這個組織／這個使用者」自己的頭像，是的話回傳格式。讀取與刪除前都先過這一關，
 * 萬一 DB 被手動改壞，也不會拿 A 的身分去讀／刪 B 的物件。
 */
export function ownerAvatarKeyType(
  key: string | null | undefined,
  kind: OwnerKind,
  id: string,
): AvatarImageType | null {
  if (!key) return null;
  const m = KEY_RE[kind].exec(key);
  if (m?.[1] !== id) return null;
  return TYPE_BY_EXT[m[3]] ?? null;
}

/** UI 用的網址；v 帶上傳時間，換圖就換網址，讀取端可以放心快取。 */
export function ownerAvatarUrl(kind: OwnerKind, id: string, version: number): string {
  assertId(id);
  return kind === "org"
    ? `/api/orgs/${id}/logo?v=${version}`
    : `/api/users/${id}/avatar?v=${version}`;
}

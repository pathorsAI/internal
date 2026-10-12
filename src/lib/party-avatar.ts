/**
 * 交易對象頭像的純函式：格式驗證、R2 key、網址、沒有圖時的首字與底色。
 *
 * 這支檔案 client / server 共用（上傳元件要用同一組限制做前端檢查、PartyAvatar 要算
 * 底色），所以不能 import 任何 server-only 的東西（DB、R2、next/headers）。真正碰 R2 與
 * DB 的流程在 src/lib/party-avatar-store.ts。
 */

/** 使用者挑的原始檔上限（前端檢查；server 只會收到縮圖後的版本）。 */
export const AVATAR_MAX_SOURCE_BYTES = 1024 * 1024;
/** 縮圖後上傳的上限（server 再驗一次）。256×256 的 WebP 實際上大多在 10–40 KB。 */
export const AVATAR_MAX_UPLOAD_BYTES = 200 * 1024;
/** 瀏覽器端縮圖的邊長。 */
export const AVATAR_SIZE = 256;

/**
 * 只收這三種點陣格式。刻意不收 SVG：SVG 是圖片格式裡唯一能帶 <script> 的，
 * 直接開圖片網址就會在本站 origin 上執行（stored XSS）。GIF / AVIF / HEIC 也不收 ——
 * 頭像不需要動圖，而且前端一律轉成 WebP（或 JPEG）再上傳，其他格式只會是繞過前端的請求。
 */
export const AVATAR_SOURCE_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export type AvatarImageType = (typeof AVATAR_SOURCE_TYPES)[number];

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

function startsWith(bytes: Uint8Array, sig: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + sig.length) return false;
  return sig.every((b, i) => bytes[offset + i] === b);
}

/**
 * 依檔頭（magic bytes）判斷真正的格式，不看副檔名也不看瀏覽器給的 MIME —— 那兩個都是
 * 上傳者可以任意填的。認不出來回 null。
 */
export function sniffImageType(bytes: Uint8Array): AvatarImageType | null {
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  // JPEG: FF D8 FF
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  // WebP: "RIFF" ???? "WEBP"
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) {
    return "image/webp";
  }
  return null;
}

export type AvatarValidation =
  | { ok: true; type: AvatarImageType }
  | { ok: false; reason: "empty" | "tooLarge" | "type" };

/** server 端對上傳內容的完整檢查：非空、≤ 200 KB、檔頭是 PNG / JPEG / WebP。 */
export function validateAvatarBytes(bytes: Uint8Array): AvatarValidation {
  if (bytes.length === 0) return { ok: false, reason: "empty" };
  if (bytes.length > AVATAR_MAX_UPLOAD_BYTES) return { ok: false, reason: "tooLarge" };
  const type = sniffImageType(bytes);
  if (!type) return { ok: false, reason: "type" };
  return { ok: true, type };
}

/** 前端挑檔時的檢查（還沒縮圖，所以用 1 MB 的原始檔上限，看瀏覽器給的 MIME）。 */
export function validateAvatarSource(file: { size: number; type: string }): AvatarValidation {
  if (file.size === 0) return { ok: false, reason: "empty" };
  if (!(AVATAR_SOURCE_TYPES as readonly string[]).includes(file.type)) return { ok: false, reason: "type" };
  if (file.size > AVATAR_MAX_SOURCE_BYTES) return { ok: false, reason: "tooLarge" };
  return { ok: true, type: file.type as AvatarImageType };
}

// better-auth 的 organization id 是英數字串；保守一點也放行 _ 與 -。
const ORG_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

function assertKeyParts(orgId: string, partyId: number) {
  if (!ORG_ID_RE.test(orgId)) throw new Error("Invalid organization id for avatar key");
  if (!Number.isSafeInteger(partyId) || partyId <= 0) throw new Error("Invalid party id for avatar key");
}

/** 這個交易對象的頭像物件都放在這個前綴底下（org 命名空間，跨組織不可能撞 key）。 */
export function partyAvatarPrefix(orgId: string, partyId: number): string {
  assertKeyParts(orgId, partyId);
  return `orgs/${orgId}/parties/${partyId}/`;
}

/** orgs/<orgId>/parties/<partyId>/avatar-<timestamp>.<ext> */
export function buildPartyAvatarKey(
  orgId: string,
  partyId: number,
  timestamp: number,
  type: AvatarImageType = "image/webp",
): string {
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) throw new Error("Invalid avatar timestamp");
  return `${partyAvatarPrefix(orgId, partyId)}avatar-${timestamp}.${EXT[type]}`;
}

const KEY_RE = /^orgs\/([A-Za-z0-9_-]{1,128})\/parties\/(\d+)\/avatar-(\d+)\.(webp|png|jpg)$/;

/**
 * 這個 key 是不是「這個組織、這個交易對象」的頭像，是的話回傳它的格式。
 *
 * 讀取與刪除前都會先過這一關：DB 裡存的 key 本來就只會由 buildPartyAvatarKey 寫入，
 * 但多一道檢查，萬一哪天有人手動改資料或寫錯 migration，也不會變成「拿 A 組織的
 * 交易對象去讀 / 刪 B 組織的物件」。
 */
export function partyAvatarKeyType(
  key: string | null | undefined,
  orgId: string,
  partyId: number,
): AvatarImageType | null {
  if (!key) return null;
  const m = KEY_RE.exec(key);
  if (!m) return null;
  if (m[1] !== orgId || Number(m[2]) !== partyId) return null;
  return TYPE_BY_EXT[m[4]] ?? null;
}

/**
 * UI 用的頭像網址。v 帶最後更新時間（queries.ts 的 avatarVersion，毫秒 epoch）：換圖後網址就變了，所以讀取端可以給一天的
 * private cache 而不怕看到舊圖。沒有頭像回 null。
 */
export function partyAvatarUrl(partyId: number, version: string | null | undefined): string | null {
  if (!version) return null;
  return `/api/parties/${partyId}/avatar?v=${encodeURIComponent(version)}`;
}

// ---- 沒有圖時的 fallback：首字 + 依名稱決定的底色 ----

/**
 * 底色組合：淺色 / 深色主題各一組，字與底的對比都夠。必須是完整的 class 字串
 * （Tailwind 只認得原始碼裡出現過的 class，不能用字串拼）。
 */
export const AVATAR_FALLBACK_COLORS = [
  "bg-sky-100 text-sky-800 dark:bg-sky-500/20 dark:text-sky-200",
  "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200",
  "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-200",
  "bg-rose-100 text-rose-800 dark:bg-rose-500/20 dark:text-rose-200",
  "bg-violet-100 text-violet-800 dark:bg-violet-500/20 dark:text-violet-200",
  "bg-teal-100 text-teal-800 dark:bg-teal-500/20 dark:text-teal-200",
  "bg-orange-100 text-orange-800 dark:bg-orange-500/20 dark:text-orange-200",
  "bg-indigo-100 text-indigo-800 dark:bg-indigo-500/20 dark:text-indigo-200",
] as const;

/** FNV-1a（32-bit）：小、穩定、server 與 client 算出來一樣，不會造成 hydration 不一致。 */
function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (const ch of s) {
    h ^= ch.codePointAt(0) ?? 0;
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * 名稱的第一個「字」：跳過開頭的括號、標點、空白（例如「(股)」「【】」），取第一個
 * 字母 / 數字 / CJK 字；拉丁字母轉大寫。整串都沒有就回 "?"。
 */
export function avatarInitial(name: string): string {
  const m = /[\p{L}\p{N}]/u.exec(name.trim());
  return m ? m[0].toLocaleUpperCase() : "?";
}

export function avatarColorClass(name: string): string {
  return AVATAR_FALLBACK_COLORS[hashString(name.trim()) % AVATAR_FALLBACK_COLORS.length];
}

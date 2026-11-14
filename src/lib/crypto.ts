// 欄位層級加密（AES-256-GCM，Web Crypto）：
// - 用於外部整合憑證（Simpany 帳密、Wise token）、員工銀行帳號、身分證字號等高敏感欄位。
// - 這裡只在 server 端使用；解密後的值不得回傳給 client 或 MCP。
//
// 金鑰（都是 32 bytes 的 base64，`openssl rand -base64 32`；正式環境走 `wrangler secret put`）：
// - FIELD_ENCRYPTION_KEYS="kid1:base64key,kid2:base64key" —— keyring。第一把是「現役」金鑰，
//   新寫入一律用它；讀取時依密文裡的 kid 挑對應那把。換金鑰 = 把新的一把放到最前面、
//   舊的留在後面，跑 scripts/reencrypt-fields.ts --apply 把舊密文換掉，最後才拿掉舊的。
// - FIELD_ENCRYPTION_KEY —— 舊的單一金鑰，繼續支援：它是 v1 密文的金鑰，也是 kid `legacy`
//   的金鑰。只設了它（沒有 keyring）時，新寫入用 `v2:legacy:…`，**不再**寫 v1 ——
//   v1 沒有綁 context，多寫一筆就多一筆可以被搬到別列的密文。
//   因此 `legacy` 是保留的 kid，FIELD_ENCRYPTION_KEYS 裡不能用。
//
// 密文格式：
// - v2:<kid>:<iv base64>:<ciphertext base64> —— AES-GCM 的 additionalData = 呼叫端給的 context
//   （例如 `employee_bank_accounts.account_number_enc|org:<orgId>|employee:<id>`，
//   一律由 src/lib/field-contexts.ts 產生）。context 不進密文本身，解密時必須給出一樣的字串，
//   所以把密文複製到別的組織、別的員工、別的欄位，GCM 驗證就會失敗，不會解出別人的資料。
// - v1:<iv>:<ct> —— 舊格式，沒有 additionalData。只讀不寫；解密時忽略 context（向後相容），
//   needsReencrypt() 會回 true，reencrypt 腳本會把它升級成 v2。

const IV_BYTES = 12;
const KEY_BYTES = 32;
/** FIELD_ENCRYPTION_KEY 在 v2 密文裡的 kid。 */
export const LEGACY_KID = "legacy";
// kid 會被寫進密文、用 `:` 分段，所以只允許不含分隔字元的短識別字。
const KID_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;

export class EncryptionKeyMissingError extends Error {
  constructor(message = "FIELD_ENCRYPTION_KEYS / FIELD_ENCRYPTION_KEY 未設定，無法加解密敏感欄位") {
    super(message);
    this.name = "EncryptionKeyMissingError";
  }
}

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCodePoint(b);
  return btoa(s);
}

function fromBase64(b64: string): Uint8Array<ArrayBuffer> {
  // atob 的輸出每個字元都是 0–255 的單一 code unit，codePointAt 不會碰到代理對。
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.codePointAt(i) ?? 0;
  return out;
}

type Keyring = {
  /** 新寫入用的 kid。 */
  activeKid: string;
  /** kid → 金鑰（含 `legacy`，若有 FIELD_ENCRYPTION_KEY）。 */
  keys: Map<string, Promise<CryptoKey>>;
};

function importAesKey(b64: string, label: string): Promise<CryptoKey> {
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = fromBase64(b64);
  } catch {
    throw new Error(`${label} 不是合法的 base64`);
  }
  if (bytes.length !== KEY_BYTES) {
    throw new Error(`${label} 必須是 32 bytes 的 base64`);
  }
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}

/** 解析 keyring 的一段 `kid:base64key`；空段回 null，格式錯或用了保留 kid 直接丟錯。 */
function parseRingEntry(entry: string): { kid: string; b64: string } | null {
  const trimmed = entry.trim();
  if (!trimmed) return null;
  const sep = trimmed.indexOf(":");
  const kid = sep > 0 ? trimmed.slice(0, sep).trim() : "";
  const b64 = sep > 0 ? trimmed.slice(sep + 1).trim() : "";
  if (!KID_PATTERN.test(kid) || !b64) {
    throw new Error("FIELD_ENCRYPTION_KEYS 格式錯誤，應為 `kid:base64key,kid2:base64key`（kid 限英數、_、-）");
  }
  if (kid === LEGACY_KID) {
    throw new Error(`FIELD_ENCRYPTION_KEYS 不能使用保留的 kid「${LEGACY_KID}」（那是 FIELD_ENCRYPTION_KEY）`);
  }
  return { kid, b64 };
}

// 以「env 原字串」當快取鍵：同一個 isolate 裡 env 不會變，只解析、匯入一次；
// 測試改了 env 也會自動重建，不必另外提供 reset。
let cached: { sig: string; ring: Keyring } | null = null;

function loadKeyring(): Keyring {
  const ringRaw = process.env.FIELD_ENCRYPTION_KEYS?.trim() ?? "";
  const legacyRaw = process.env.FIELD_ENCRYPTION_KEY?.trim() ?? "";
  const sig = `${ringRaw}\n${legacyRaw}`;
  if (cached?.sig === sig) return cached.ring;

  const keys = new Map<string, Promise<CryptoKey>>();
  let activeKid: string | null = null;
  for (const entry of ringRaw.split(",")) {
    const parsed = parseRingEntry(entry);
    if (!parsed) continue;
    const { kid, b64 } = parsed;
    if (keys.has(kid)) throw new Error(`FIELD_ENCRYPTION_KEYS 有重複的 kid「${kid}」`);
    keys.set(kid, importAesKey(b64, `FIELD_ENCRYPTION_KEYS[${kid}]`));
    activeKid ??= kid;
  }
  if (legacyRaw) {
    keys.set(LEGACY_KID, importAesKey(legacyRaw, "FIELD_ENCRYPTION_KEY"));
    activeKid ??= LEGACY_KID;
  }
  if (!activeKid) throw new EncryptionKeyMissingError();
  // 匯入失敗（金鑰長度不對）會在第一次 await 時才丟；先掛一個空的 catch，
  // 避免沒被用到的那把金鑰變成 unhandled rejection。真正用到時照樣會丟錯。
  for (const p of keys.values()) p.catch(() => {});

  const ring = { activeKid, keys };
  cached = { sig, ring };
  return ring;
}

/** 有沒有設定任何欄位加密金鑰（給 seed 之類「沒金鑰就跳過」的腳本用）。 */
export function hasFieldEncryptionKey(): boolean {
  return !!(process.env.FIELD_ENCRYPTION_KEYS?.trim() || process.env.FIELD_ENCRYPTION_KEY?.trim());
}

/** 現役 kid（新寫入用的那把）。 */
export function activeKeyId(): string {
  return loadKeyring().activeKid;
}

function requireContext(context: string): Uint8Array<ArrayBuffer> {
  // 空字串的 context 等於沒綁：密文可以被搬到任何同樣沒綁的地方。一律拒絕，
  // 逼呼叫端走 src/lib/field-contexts.ts。
  if (typeof context !== "string" || context.length === 0) {
    throw new Error("encryptField / decryptField 必須帶非空的 context");
  }
  return new TextEncoder().encode(context);
}

type Parsed =
  | { version: "v1"; iv: string; ct: string }
  | { version: "v2"; kid: string; iv: string; ct: string };

function parse(enc: string): Parsed {
  const parts = typeof enc === "string" ? enc.split(":") : [];
  if (parts[0] === "v1" && parts.length === 3 && parts[1] && parts[2]) {
    return { version: "v1", iv: parts[1], ct: parts[2] };
  }
  if (parts[0] === "v2" && parts.length === 4 && KID_PATTERN.test(parts[1]) && parts[2] && parts[3]) {
    return { version: "v2", kid: parts[1], iv: parts[2], ct: parts[3] };
  }
  throw new Error("無法辨識的密文格式");
}

/** 加密字串，回傳 `v2:<現役 kid>:<iv>:<ct>`，additionalData = context。 */
export async function encryptField(plain: string, context: string): Promise<string> {
  const aad = requireContext(context);
  const ring = loadKeyring();
  const key = await ring.keys.get(ring.activeKid)!;
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: aad },
    key,
    new TextEncoder().encode(plain),
  );
  return `v2:${ring.activeKid}:${toBase64(iv)}:${toBase64(new Uint8Array(ct))}`;
}

/**
 * 解密 encryptField 的輸出；格式不符、金鑰錯誤、context 不符、密文被竄改時一律丟錯，
 * 不回傳半成品。v1 密文忽略 context（舊資料沒有綁）。
 */
export async function decryptField(enc: string, context: string): Promise<string> {
  const aad = requireContext(context);
  const p = parse(enc);
  const ring = loadKeyring();
  const kid = p.version === "v1" ? LEGACY_KID : p.kid;
  const keyPromise = ring.keys.get(kid);
  if (!keyPromise) {
    throw new EncryptionKeyMissingError(
      p.version === "v1"
        ? "v1 密文需要 FIELD_ENCRYPTION_KEY 才能解密"
        : `找不到 kid「${kid}」的金鑰（FIELD_ENCRYPTION_KEYS 是否已移除這把？）`,
    );
  }
  const key = await keyPromise;
  const params: AesGcmParams =
    p.version === "v1"
      ? { name: "AES-GCM", iv: fromBase64(p.iv) }
      : { name: "AES-GCM", iv: fromBase64(p.iv), additionalData: aad };
  let pt: ArrayBuffer;
  try {
    pt = await crypto.subtle.decrypt(params, key, fromBase64(p.ct));
  } catch {
    // Web Crypto 的 OperationError 什麼都不說；統一成一句人話，不帶任何密文或 context。
    throw new Error("欄位解密失敗：金鑰或 context 不符，或密文已損壞");
  }
  return new TextDecoder().decode(pt);
}

/**
 * 這筆密文該不該換成現役金鑰：v1（沒綁 context）或 kid 不是現役的那把都算。
 * 格式無法辨識時丟錯 —— 那代表資料有問題，不該被當成「不用處理」默默跳過。
 */
export function needsReencrypt(enc: string): boolean {
  const p = parse(enc);
  if (p.version === "v1") return true;
  return p.kid !== loadKeyring().activeKid;
}

/** JSON 物件版本，給整合憑證用。 */
export async function encryptJson(value: unknown, context: string): Promise<string> {
  return encryptField(JSON.stringify(value), context);
}

export async function decryptJson<T>(enc: string, context: string): Promise<T> {
  return JSON.parse(await decryptField(enc, context)) as T;
}

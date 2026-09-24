// 欄位層級加密（AES-256-GCM，Web Crypto）：
// - 用於外部整合憑證（Simpany 帳密、Wise token）與員工銀行帳號等高敏感欄位。
// - 金鑰來自 FIELD_ENCRYPTION_KEY（32 bytes 的 base64，`openssl rand -base64 32`），
//   正式環境用 `wrangler secret put FIELD_ENCRYPTION_KEY` 設定。
// - 密文格式 `v1:<iv base64>:<ciphertext base64>`，版本前綴留給日後換金鑰。
// - 這裡只在 server 端使用；解密後的值不得回傳給 client 或 MCP。

const VERSION = "v1";
const IV_BYTES = 12;

let cachedKey: Promise<CryptoKey> | null = null;

export class EncryptionKeyMissingError extends Error {
  constructor() {
    super("FIELD_ENCRYPTION_KEY 未設定，無法加解密敏感欄位");
    this.name = "EncryptionKeyMissingError";
  }
}

function toBase64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromBase64(b64: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function getKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey;
  const raw = process.env.FIELD_ENCRYPTION_KEY?.trim();
  if (!raw) throw new EncryptionKeyMissingError();
  const bytes = fromBase64(raw);
  if (bytes.length !== 32) {
    throw new Error("FIELD_ENCRYPTION_KEY 必須是 32 bytes 的 base64");
  }
  cachedKey = crypto.subtle.importKey("raw", bytes, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
  return cachedKey;
}

/** 加密字串，回傳 `v1:<iv>:<ct>`。 */
export async function encryptField(plain: string): Promise<string> {
  const key = await getKey();
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plain),
  );
  return `${VERSION}:${toBase64(iv)}:${toBase64(new Uint8Array(ct))}`;
}

/** 解密 encryptField 的輸出；格式不符或金鑰錯誤時丟錯，不回傳半成品。 */
export async function decryptField(enc: string): Promise<string> {
  const [version, ivB64, ctB64] = enc.split(":");
  if (version !== VERSION || !ivB64 || !ctB64) {
    throw new Error("無法辨識的密文格式");
  }
  const key = await getKey();
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(ivB64) },
    key,
    fromBase64(ctB64),
  );
  return new TextDecoder().decode(pt);
}

/** JSON 物件版本，給整合憑證用。 */
export async function encryptJson(value: unknown): Promise<string> {
  return encryptField(JSON.stringify(value));
}

export async function decryptJson<T>(enc: string): Promise<T> {
  return JSON.parse(await decryptField(enc)) as T;
}

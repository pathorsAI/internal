import { trimTrailingSlashes } from "@/lib/base-url";

/**
 * 平台自己的 OIDC 身分：用一把「整個部署共用」的 RSA 私鑰簽短效 JWT，讓外部雲端
 * （目前是 GCP Workload Identity Federation）用「這個組織」的身分換 token，不用每個組織
 * 各存一把 service account key（pathors.com 的 GCP org 禁止建立 SA key）。
 *
 *   OIDC_SIGNING_KEY  Worker secret。PKCS#8 DER 的 base64（一行、不含 PEM 標頭）；也接受完整 PEM。
 *   OIDC_SIGNING_KID  選填，JWT header 的 kid，預設 internal-2026-10b（GCP 上傳的 JWKS 用的就是它）
 *   OIDC_ISSUER       選填，預設 https://internal.pathors.com
 *
 * 組織隔離靠 `sub`：sub 一律是 server 端 org context 的 organization_id（呼叫端從
 * requireOrg / 整合的 orgId 傳進來），**絕不**取自使用者輸入或 config。GCP 那邊只把
 * `principal://…/subject/<orgId>` 綁到該組織可以 impersonate 的 service account。
 *
 * 公鑰由私鑰推導，掛在 /.well-known/jwks.json 與 /.well-known/openid-configuration
 * （之後輪替用；GCP 目前用的是上傳的 JWKS）。私鑰本身不進 log、錯誤訊息、回傳值。
 */

export const DEFAULT_OIDC_KID = "internal-2026-10b";
export const DEFAULT_OIDC_ISSUER = "https://internal.pathors.com";
/** 給 GCP workload identity provider 的 JWT audience（provider 的 allowed audiences）。 */
export const GCP_WIF_JWT_AUDIENCE = "internal-billing";
/** 短效：只用來馬上換 token。 */
export const ASSERTION_TTL_SECONDS = 300;

export class OidcConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OidcConfigError";
  }
}

export function oidcIssuer(env: Record<string, string | undefined> = process.env): string {
  const v = env.OIDC_ISSUER?.trim();
  return v ? trimTrailingSlashes(v) : DEFAULT_OIDC_ISSUER;
}

export function oidcKid(env: Record<string, string | undefined> = process.env): string {
  return env.OIDC_SIGNING_KID?.trim() || DEFAULT_OIDC_KID;
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * 私鑰字串 → PKCS#8 DER。接受：
 *   - 完整 PEM（`-----BEGIN PRIVATE KEY-----` … ，換行可以是真的換行或字面上的 `\n`）
 *   - 只有 base64 本體（一行，Worker secret 的建議格式）
 * 傳統 RSA PEM（`BEGIN RSA PRIVATE KEY`，PKCS#1）不支援，要先轉成 PKCS#8。
 */
export function parsePkcs8(raw: string | undefined): ArrayBuffer {
  const v = (raw ?? "").trim();
  if (!v) throw new OidcConfigError("伺服器尚未設定 OIDC_SIGNING_KEY，無法用 workload identity 連接 GCP");
  if (v.includes("BEGIN RSA PRIVATE KEY")) {
    throw new OidcConfigError("OIDC_SIGNING_KEY 是 PKCS#1 格式；請轉成 PKCS#8（openssl pkcs8 -topk8 -nocrypt）");
  }
  const body = v
    .replace(/-----BEGIN [A-Z ]+-----/g, "")
    .replace(/-----END [A-Z ]+-----/g, "")
    .replaceAll("\\n", "")
    .replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]+=*$/.test(body)) throw new OidcConfigError("OIDC_SIGNING_KEY 不是合法的 base64 / PEM");
  const bytes = b64ToBytes(body);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export function base64url(input: ArrayBuffer | Uint8Array | string): string {
  let bytes: Uint8Array;
  if (typeof input === "string") bytes = new TextEncoder().encode(input);
  else if (input instanceof Uint8Array) bytes = input;
  else bytes = new Uint8Array(input);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

const RS256 = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" } as const;

/** 用 PKCS#8 私鑰簽一個 RS256 JWT。 */
export async function signRs256Jwt(
  header: Record<string, unknown>,
  claims: Record<string, unknown>,
  pkcs8: ArrayBuffer,
): Promise<string> {
  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey("pkcs8", pkcs8, RS256, false, ["sign"]);
  } catch {
    throw new OidcConfigError("私鑰無法解析（需要 RSA PKCS#8）");
  }
  const input = `${base64url(JSON.stringify({ alg: "RS256", typ: "JWT", ...header }))}.${base64url(JSON.stringify(claims))}`;
  const sig = await crypto.subtle.sign(RS256, key, new TextEncoder().encode(input));
  return `${input}.${base64url(sig)}`;
}

export type OrgAssertionClaims = { iss: string; sub: string; aud: string; iat: number; exp: number };

/**
 * 組「這個組織」的 assertion claims。sub = orgId（server 端 org context），
 * 這是 GCP 端區分組織的唯一依據 —— 呼叫端絕不能把使用者輸入或 config 傳進來當 orgId。
 */
export function buildOrgAssertionClaims(
  orgId: string,
  opts: { issuer: string; audience: string; nowSec: number },
): OrgAssertionClaims {
  if (!orgId || typeof orgId !== "string") throw new Error("organization id is required for the OIDC subject");
  return {
    iss: opts.issuer,
    sub: orgId,
    aud: opts.audience,
    iat: opts.nowSec,
    exp: opts.nowSec + ASSERTION_TTL_SECONDS,
  };
}

/** 簽一個這個組織的短效 assertion（預設 audience = GCP WIF 的 internal-billing）。 */
export async function signOrgAssertion(
  orgId: string,
  opts: { audience?: string; nowSec?: number; env?: Record<string, string | undefined> } = {},
): Promise<string> {
  const env = opts.env ?? process.env;
  const claims = buildOrgAssertionClaims(orgId, {
    issuer: oidcIssuer(env),
    audience: opts.audience ?? GCP_WIF_JWT_AUDIENCE,
    nowSec: opts.nowSec ?? Math.floor(Date.now() / 1000),
  });
  return signRs256Jwt({ kid: oidcKid(env) }, claims, parsePkcs8(env.OIDC_SIGNING_KEY));
}

/** 從私鑰推導公開的 JWK（只留 kty / n / e，加上 kid / alg / use）。 */
export async function publicJwk(
  env: Record<string, string | undefined> = process.env,
): Promise<{ kty: string; n: string; e: string; kid: string; alg: "RS256"; use: "sig" }> {
  const key = await crypto.subtle.importKey("pkcs8", parsePkcs8(env.OIDC_SIGNING_KEY), RS256, true, ["sign"]);
  const jwk = (await crypto.subtle.exportKey("jwk", key)) as JsonWebKey;
  if (!jwk.n || !jwk.e) throw new OidcConfigError("OIDC_SIGNING_KEY 不是 RSA 私鑰");
  return { kty: "RSA", n: jwk.n, e: jwk.e, kid: oidcKid(env), alg: "RS256", use: "sig" };
}

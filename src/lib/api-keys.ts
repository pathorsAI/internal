import { and, desc, eq, isNull, lt, or } from "drizzle-orm";
import { getDb } from "@/db";
import { user } from "@/db/auth-schema";
import { apiKeys } from "@/db/schema";

/**
 * 組織層級的 API key（REST /api/v1 與 MCP 的 Bearer 金鑰）。
 *
 * - 格式：`pik_` + 32 bytes 隨機值（base64url，43 字元）。prefix = 前 12 字元，只拿來辨識。
 * - DB 只存 SHA-256（hex）。明文只在 createApiKey() 的回傳值出現一次，畫面顯示後就沒了。
 * - 金鑰以「建立者」的身分與目前角色執行工具：建立者離開組織，resolveOrg() 的成員檢查就會
 *   擋下；角色降為 member，owner/admin 才能做的工具也跟著失敗。scope = read 再把範圍縮到
 *   [read] 工具（src/lib/mcp/handler.ts 的 runToolWithAudit）。
 * - 建立 / 撤銷只在網頁（設定 › API）做：建立會產生秘密，秘密不經 MCP / API。MCP 只有
 *   list_api_keys（不含雜湊）與 revoke_api_key。
 */

export const API_KEY_PREFIX = "pik_";
const SECRET_BYTES = 32;
const DISPLAY_PREFIX_LENGTH = 12;
/** last_used_at 最多多久更新一次，避免每個請求都寫一次 DB。 */
const LAST_USED_THROTTLE_MS = 60_000;
const API_KEY_PATTERN = /^pik_[A-Za-z0-9_-]{43}$/;

export type ApiKeyScope = "read" | "write";
export const API_KEY_SCOPES: readonly ApiKeyScope[] = ["read", "write"];

export function isApiKeyScope(v: unknown): v is ApiKeyScope {
  return v === "read" || v === "write";
}

/** 看起來像我們發的金鑰（格式檢查，不查 DB）。用來分辨 Bearer 是 API key 還是 OAuth token。 */
export function looksLikeApiKey(v: string | null | undefined): v is string {
  return typeof v === "string" && API_KEY_PATTERN.test(v);
}

function base64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCodePoint(b);
  let out = btoa(s).replaceAll("+", "-").replaceAll("/", "_");
  while (out.endsWith("=")) out = out.slice(0, -1);
  return out;
}

/** 產生一把新金鑰（純函式，不碰 DB）。 */
export function generateApiKey(): { key: string; prefix: string } {
  const bytes = crypto.getRandomValues(new Uint8Array(SECRET_BYTES));
  const key = `${API_KEY_PREFIX}${base64url(bytes)}`;
  return { key, prefix: key.slice(0, DISPLAY_PREFIX_LENGTH) };
}

/** 完整金鑰的 SHA-256（hex）。DB 存的就是這個。 */
export async function hashApiKey(key: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export class ApiKeyInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApiKeyInputError";
  }
}

export type ApiKeyRow = {
  id: number;
  name: string;
  prefix: string;
  scope: ApiKeyScope;
  createdAt: string;
  createdBy: string | null;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  /** active / expired / revoked，依時間算出。 */
  status: "active" | "expired" | "revoked";
};

function iso(v: string | null): string | null {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toISOString();
}

export function apiKeyStatus(
  row: { revokedAt: string | null; expiresAt: string | null },
  now = new Date(),
): ApiKeyRow["status"] {
  if (row.revokedAt) return "revoked";
  if (row.expiresAt && new Date(row.expiresAt).getTime() <= now.getTime()) return "expired";
  return "active";
}

/** 驗證建立金鑰的輸入；回傳正規化後的值。到期日是 YYYY-MM-DD（台北時間當天結束失效）。 */
export function normalizeApiKeyInput(
  input: { name?: unknown; scope?: unknown; expiresOn?: unknown },
  now = new Date(),
): { name: string; scope: ApiKeyScope; expiresAt: string | null } {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (name.length < 1 || name.length > 100) throw new ApiKeyInputError("name");
  if (!isApiKeyScope(input.scope)) throw new ApiKeyInputError("scope");
  let expiresAt: string | null = null;
  const raw = typeof input.expiresOn === "string" ? input.expiresOn.trim() : "";
  if (raw) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw new ApiKeyInputError("expiresOn");
    // 當天 23:59:59（Asia/Taipei，UTC+8）失效。
    const end = new Date(`${raw}T23:59:59+08:00`);
    if (Number.isNaN(end.getTime()) || end.getTime() <= now.getTime()) throw new ApiKeyInputError("expiresOn");
    expiresAt = end.toISOString();
  }
  return { name, scope: input.scope, expiresAt };
}

export async function createApiKey(args: {
  orgId: string;
  userId: string;
  name: string;
  scope: ApiKeyScope;
  expiresAt: string | null;
}): Promise<{ id: number; key: string; prefix: string }> {
  const { key, prefix } = generateApiKey();
  const keyHash = await hashApiKey(key);
  const [row] = await getDb()
    .insert(apiKeys)
    .values({
      organizationId: args.orgId,
      createdByUserId: args.userId,
      name: args.name,
      prefix,
      keyHash,
      scope: args.scope,
      expiresAt: args.expiresAt,
    })
    .returning({ id: apiKeys.id });
  return { id: row.id, key, prefix };
}

/** 本組織的金鑰（含已撤銷 / 過期），新的在前。不含雜湊。 */
export async function listApiKeys(orgId: string, now = new Date()): Promise<ApiKeyRow[]> {
  const rows = await getDb()
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      prefix: apiKeys.prefix,
      scope: apiKeys.scope,
      createdAt: apiKeys.createdAt,
      expiresAt: apiKeys.expiresAt,
      lastUsedAt: apiKeys.lastUsedAt,
      revokedAt: apiKeys.revokedAt,
      creatorName: user.name,
      creatorEmail: user.email,
    })
    .from(apiKeys)
    .leftJoin(user, eq(user.id, apiKeys.createdByUserId))
    .where(eq(apiKeys.organizationId, orgId))
    .orderBy(desc(apiKeys.createdAt));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    prefix: r.prefix,
    scope: isApiKeyScope(r.scope) ? r.scope : "read",
    createdAt: iso(r.createdAt) ?? r.createdAt,
    createdBy: r.creatorName || r.creatorEmail || null,
    expiresAt: iso(r.expiresAt),
    lastUsedAt: iso(r.lastUsedAt),
    revokedAt: iso(r.revokedAt),
    status: apiKeyStatus(r, now),
  }));
}

/** 撤銷（保留列）。回傳被撤銷的金鑰名稱；不存在或已撤銷回 null。 */
export async function revokeApiKey(
  orgId: string,
  id: number,
  userId: string,
): Promise<{ id: number; name: string } | null> {
  const [row] = await getDb()
    .update(apiKeys)
    .set({ revokedAt: new Date().toISOString(), revokedByUserId: userId })
    .where(and(eq(apiKeys.organizationId, orgId), eq(apiKeys.id, id), isNull(apiKeys.revokedAt)))
    .returning({ id: apiKeys.id, name: apiKeys.name });
  return row ?? null;
}

/** 驗證通過的金鑰：工具執行時的身分。 */
export type VerifiedApiKey = {
  id: number;
  name: string;
  organizationId: string;
  scope: ApiKeyScope;
  /** 以這位成員的身分執行（建立者）。 */
  userId: string;
};

/**
 * 驗一把明文金鑰：格式 → 雜湊查表 → 沒撤銷、沒過期。通過則更新 last_used_at（節流）。
 * 失敗一律回 null，不區分原因（不給猜金鑰的人任何線索）。
 */
export async function verifyApiKey(raw: string, now = new Date()): Promise<VerifiedApiKey | null> {
  if (!looksLikeApiKey(raw)) return null;
  const keyHash = await hashApiKey(raw);
  const db = getDb();
  const [row] = await db
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      organizationId: apiKeys.organizationId,
      scope: apiKeys.scope,
      createdByUserId: apiKeys.createdByUserId,
      expiresAt: apiKeys.expiresAt,
      revokedAt: apiKeys.revokedAt,
      lastUsedAt: apiKeys.lastUsedAt,
    })
    .from(apiKeys)
    .where(eq(apiKeys.keyHash, keyHash))
    .limit(1);
  if (!row || apiKeyStatus(row, now) !== "active" || !isApiKeyScope(row.scope)) return null;

  const threshold = new Date(now.getTime() - LAST_USED_THROTTLE_MS).toISOString();
  if (!row.lastUsedAt || new Date(row.lastUsedAt).getTime() < now.getTime() - LAST_USED_THROTTLE_MS) {
    try {
      await db
        .update(apiKeys)
        .set({ lastUsedAt: now.toISOString() })
        .where(and(eq(apiKeys.id, row.id), or(isNull(apiKeys.lastUsedAt), lt(apiKeys.lastUsedAt, threshold))));
    } catch {
      // 只是統計用，失敗不影響這次請求
    }
  }
  return {
    id: row.id,
    name: row.name,
    organizationId: row.organizationId,
    scope: row.scope,
    userId: row.createdByUserId,
  };
}

/** 從 `Authorization: Bearer <key>` 或 `X-API-Key: <key>` 取出長得像 API key 的值。 */
export function extractApiKey(req: Request): string | null {
  const header = req.headers.get("authorization")?.trim() ?? "";
  const bearer = header.slice(0, 7).toLowerCase() === "bearer " ? header.slice(7).trim() : null;
  if (looksLikeApiKey(bearer)) return bearer;
  const x = req.headers.get("x-api-key")?.trim() ?? null;
  return looksLikeApiKey(x) ? x : null;
}

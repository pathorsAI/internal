import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { AiRuleKind, AiRuleScope, RuleAction, RuleMatch } from "@/lib/ai/rules";
import { getDb } from "./index";
import { user } from "./auth-schema";
import { aiRules, categories } from "./schema";

/**
 * AI 規則（ai_rules，migrations/0040）。每個查詢都過濾 organization_id；個人規則（scope = user）
 * 只有本人看得到。比對邏輯在 src/lib/ai/rules.ts，這裡只管存取。
 *
 * 角色檢查（組織規則只有 owner/admin 能建、改、刪）**不在這裡**，在工具裡
 * （src/lib/mcp/tools-ai-rules.ts）與網頁的 server action 各自做 —— 這層只確保不跨組織、
 * 不碰別人的個人規則。
 */

export type AiRuleSource = "web" | "line" | "whatsapp" | "mcp";

export type AiRuleRow = {
  id: number;
  organizationId: string;
  scope: AiRuleScope;
  /** scope = user 時是規則的主人；org 規則是 null。 */
  userId: string | null;
  kind: AiRuleKind;
  match: RuleMatch;
  action: RuleAction;
  /** 使用者的原話。 */
  text: string;
  createdBy: string | null;
  /** 教這條規則的人的名字（join "user"；人被刪了就是 null）。 */
  createdByName: string | null;
  source: AiRuleSource;
  applyCount: number;
  lastAppliedAt: string | null;
  disabledAt: string | null;
  createdAt: string;
};

const SELECT = {
  id: aiRules.id,
  organizationId: aiRules.organizationId,
  scope: aiRules.scope,
  userId: aiRules.userId,
  kind: aiRules.kind,
  match: aiRules.match,
  action: aiRules.action,
  text: aiRules.text,
  createdBy: aiRules.createdBy,
  createdByName: user.name,
  source: aiRules.source,
  applyCount: aiRules.applyCount,
  lastAppliedAt: aiRules.lastAppliedAt,
  disabledAt: aiRules.disabledAt,
  createdAt: aiRules.createdAt,
};

/** 這個人看得到的規則：組織規則＋自己的個人規則（未刪除）。 */
function visibleTo(orgId: string, userId: string) {
  return and(
    eq(aiRules.organizationId, orgId),
    isNull(aiRules.deletedAt),
    or(eq(aiRules.scope, "org"), and(eq(aiRules.scope, "user"), eq(aiRules.userId, userId))),
  );
}

/**
 * 規則頁與 list_ai_rules：組織規則＋本人的個人規則，新的在前。
 * includeDisabled = false 時只回啟用中的。
 */
export async function listAiRules(
  orgId: string,
  userId: string,
  opts: { includeDisabled?: boolean; limit?: number } = {},
): Promise<AiRuleRow[]> {
  const where = opts.includeDisabled
    ? visibleTo(orgId, userId)
    : and(visibleTo(orgId, userId), isNull(aiRules.disabledAt));
  const rows = await getDb()
    .select(SELECT)
    .from(aiRules)
    .leftJoin(user, eq(user.id, aiRules.createdBy))
    .where(where)
    .orderBy(desc(aiRules.id))
    .limit(opts.limit ?? 500);
  return rows as AiRuleRow[];
}

/** 放進 system prompt 的規則：啟用中、組織＋本人，最多 limit 條（預設 60），新的優先。 */
export function listRulesForPrompt(orgId: string, userId: string, limit = 60): Promise<AiRuleRow[]> {
  return listAiRules(orgId, userId, { includeDisabled: false, limit });
}

/**
 * 匯入（Wise sync、卡費）用：這個組織啟用中的「組織」分類規則。匯入沒有操作人，
 * 所以不套任何人的個人規則。
 */
export async function listOrgCategoryRules(orgId: string): Promise<AiRuleRow[]> {
  const rows = await getDb()
    .select(SELECT)
    .from(aiRules)
    .leftJoin(user, eq(user.id, aiRules.createdBy))
    .where(
      and(
        eq(aiRules.organizationId, orgId),
        eq(aiRules.scope, "org"),
        eq(aiRules.kind, "category"),
        isNull(aiRules.deletedAt),
        isNull(aiRules.disabledAt),
      ),
    )
    .orderBy(desc(aiRules.id));
  return rows as AiRuleRow[];
}

/** 一條規則（這個人看得到的才回；含停用的）。 */
export async function getAiRule(orgId: string, userId: string, id: number): Promise<AiRuleRow | null> {
  const [row] = await getDb()
    .select(SELECT)
    .from(aiRules)
    .leftJoin(user, eq(user.id, aiRules.createdBy))
    .where(and(visibleTo(orgId, userId), eq(aiRules.id, id)))
    .limit(1);
  return (row as AiRuleRow | undefined) ?? null;
}

export type NewAiRule = {
  orgId: string;
  scope: AiRuleScope;
  /** scope = user 時必填（規則的主人）。 */
  userId: string | null;
  kind: AiRuleKind;
  match: RuleMatch;
  action: RuleAction;
  text: string;
  createdBy: string;
  source: AiRuleSource;
};

/** 新增一條規則，回傳整列。scope = user 卻沒給 userId 會被 DB 的 CHECK 擋下。 */
export async function createAiRule(r: NewAiRule): Promise<AiRuleRow> {
  const [row] = await getDb()
    .insert(aiRules)
    .values({
      organizationId: r.orgId,
      scope: r.scope,
      userId: r.scope === "user" ? r.userId : null,
      kind: r.kind,
      match: r.match,
      action: r.action,
      text: r.text,
      createdBy: r.createdBy,
      source: r.source,
    })
    .returning({ id: aiRules.id });
  const created = await getAiRule(r.orgId, r.createdBy, row.id);
  if (!created) throw new Error("Rule was created but could not be read back.");
  return created;
}

export type AiRulePatch = {
  match?: RuleMatch;
  action?: RuleAction;
  text?: string;
  /** true = 停用、false = 重新啟用。 */
  disabled?: boolean;
};

/**
 * 改一條規則（只改有給的欄位）。只改得到這個人看得到的規則；回傳改完的整列，找不到回 null。
 * 組織規則能不能改由呼叫端先檢查角色。
 */
export async function updateAiRule(
  orgId: string,
  userId: string,
  id: number,
  patch: AiRulePatch,
): Promise<AiRuleRow | null> {
  const set: Record<string, unknown> = {};
  if (patch.match !== undefined) set.match = patch.match;
  if (patch.action !== undefined) set.action = patch.action;
  if (patch.text !== undefined) set.text = patch.text;
  if (patch.disabled !== undefined) set.disabledAt = patch.disabled ? sql`now()` : null;
  if (Object.keys(set).length > 0) {
    const rows = await getDb()
      .update(aiRules)
      .set(set)
      .where(and(visibleTo(orgId, userId), eq(aiRules.id, id)))
      .returning({ id: aiRules.id });
    if (rows.length === 0) return null;
  }
  return getAiRule(orgId, userId, id);
}

/** 軟刪一條規則（deleted_at = now()）。回傳是否刪到。角色由呼叫端先檢查。 */
export async function softDeleteAiRule(orgId: string, userId: string, id: number): Promise<boolean> {
  const rows = await getDb()
    .update(aiRules)
    .set({ deletedAt: sql`now()` })
    .where(and(visibleTo(orgId, userId), eq(aiRules.id, id)))
    .returning({ id: aiRules.id });
  return rows.length > 0;
}

/** 規則被套用了（確認卡按下確認、或匯入時填了分類）：apply_count + 1、記下時間。 */
export async function markAiRulesApplied(ids: readonly number[]): Promise<void> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return;
  await getDb()
    .update(aiRules)
    .set({ applyCount: sql`${aiRules.applyCount} + 1`, lastAppliedAt: sql`now()` })
    .where(inArray(aiRules.id, unique));
}

/**
 * 匯入一次套了好幾筆：每條規則加上各自用到的筆數（counts：規則 id → 筆數）。
 * 規則通常只有幾條，逐條 UPDATE 就好。
 */
export async function recordAiRuleApplications(counts: ReadonlyMap<number, number>): Promise<void> {
  const db = getDb();
  for (const [id, n] of counts) {
    if (!Number.isInteger(n) || n <= 0) continue;
    await db
      .update(aiRules)
      .set({ applyCount: sql`${aiRules.applyCount} + ${n}`, lastAppliedAt: sql`now()` })
      .where(eq(aiRules.id, id));
  }
}

/** 匯入套規則前：規則指到的分類現在的種類（只回這個組織、啟用中、未刪除的）。 */
export async function listCategoryKinds(orgId: string, ids: readonly number[]): Promise<Map<number, string>> {
  if (ids.length === 0) return new Map();
  const rows = await getDb()
    .select({ id: categories.id, kind: categories.kind })
    .from(categories)
    .where(
      and(
        eq(categories.organizationId, orgId),
        inArray(categories.id, [...ids]),
        eq(categories.isActive, true),
        isNull(categories.deletedAt),
      ),
    );
  return new Map(rows.map((r) => [r.id, r.kind]));
}

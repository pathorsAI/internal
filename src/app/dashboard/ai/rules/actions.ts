"use server";

import { getAiRule, softDeleteAiRule, updateAiRule, type AiRuleRow } from "@/db/ai-rules";
import { canManageOrg, requireOrgWithRole } from "@/lib/session";

/**
 * 規則頁的 server action。權限跟 AI 工具（src/lib/mcp/tools-ai-rules.ts）一致：
 * - 組織規則：只有 owner／admin 能停用、刪除；成員只能看。
 * - 個人規則：只有本人看得到（db 層已經過濾），本人可以停用、刪除。
 * 按鈕藏起來擋不住直接呼叫 action，所以這裡每次都重查規則與角色。
 */

type Result = { ok: boolean; error?: string };

async function editable(id: number): Promise<{ orgId: string; userId: string; rule: AiRuleRow } | null> {
  if (!Number.isInteger(id) || id <= 0) return null;
  const { orgId, userId, role } = await requireOrgWithRole();
  const rule = await getAiRule(orgId, userId, id);
  if (!rule) return null;
  if (rule.scope === "org" && !canManageOrg(role)) return null;
  if (rule.scope === "user" && rule.userId !== userId) return null;
  return { orgId, userId, rule };
}

export async function setAiRuleDisabled(id: number, disabled: boolean): Promise<Result> {
  const ctx = await editable(id);
  if (!ctx) return { ok: false };
  const updated = await updateAiRule(ctx.orgId, ctx.userId, id, { disabled: Boolean(disabled) });
  return { ok: updated !== null };
}

export async function deleteAiRuleAction(id: number): Promise<Result> {
  const ctx = await editable(id);
  if (!ctx) return { ok: false };
  return { ok: await softDeleteAiRule(ctx.orgId, ctx.userId, id) };
}

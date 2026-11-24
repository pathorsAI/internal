"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { logWeb } from "@/db/activity";
import {
  ApiKeyInputError,
  createApiKey,
  normalizeApiKeyInput,
  revokeApiKey,
} from "@/lib/api-keys";
import { canManageOrg, requireOrgWithRole } from "@/lib/session";

/**
 * 設定 › API 的 server actions（限 owner / admin）。
 * 建立金鑰只能在這裡做：完整金鑰只在 createApiKeyAction 的回傳值出現一次，DB 只存雜湊。
 */

const PAGE = "/dashboard/settings/api";

export type CreateApiKeyState =
  | { ok: true; key: string; prefix: string; name: string }
  | { ok: false; error: string };

export type RevokeApiKeyState = { ok: boolean; error?: string };

async function requireManager(): Promise<{ orgId: string; userId: string } | { error: string }> {
  const t = await getTranslations("settings");
  const { orgId, userId, role } = await requireOrgWithRole();
  if (!canManageOrg(role)) return { error: t("api.errors.notAllowed") };
  return { orgId, userId };
}

export async function createApiKeyAction(input: {
  name: string;
  scope: string;
  expiresOn: string;
}): Promise<CreateApiKeyState> {
  const t = await getTranslations("settings");
  // 在 try 外面：未登入時 requireOrg() 會 redirect，那個例外不能被吞掉。
  const me = await requireManager();
  if ("error" in me) return { ok: false, error: me.error };
  try {
    const v = normalizeApiKeyInput(input ?? {});
    const created = await createApiKey({ orgId: me.orgId, userId: me.userId, ...v });
    await logWeb(
      me.orgId,
      "create",
      "api_key",
      created.id,
      t("api.activity.created", { name: v.name, scope: t(`api.scope.${v.scope}`) }),
    );
    revalidatePath(PAGE);
    return { ok: true, key: created.key, prefix: created.prefix, name: v.name };
  } catch (e) {
    if (e instanceof ApiKeyInputError) {
      const field = e.message as "name" | "scope" | "expiresOn";
      return { ok: false, error: t(`api.errors.${field}`) };
    }
    return { ok: false, error: t("api.errors.failed") };
  }
}

export async function revokeApiKeyAction(id: number): Promise<RevokeApiKeyState> {
  const t = await getTranslations("settings");
  const me = await requireManager();
  if ("error" in me) return { ok: false, error: me.error };
  try {
    const res = await revokeApiKey(me.orgId, Number(id), me.userId);
    if (!res) return { ok: false, error: t("api.errors.notFound") };
    await logWeb(me.orgId, "delete", "api_key", res.id, t("api.activity.revoked", { name: res.name }));
    revalidatePath(PAGE);
    return { ok: true };
  } catch {
    return { ok: false, error: t("api.errors.failed") };
  }
}

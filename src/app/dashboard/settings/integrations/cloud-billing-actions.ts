"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { logWeb } from "@/db/activity";
import { canManageOrg, requireOrgWithRole } from "@/lib/session";
import {
  refreshCloudDiscoveryForOrg,
  saveCloudBillingScopeForOrg,
} from "@/lib/integrations/settings-service";

/**
 * 設定 › 整合 › Azure / GCP 的「計費範圍」（限 owner / admin）。
 * 同一個外部計費範圍裡可能混著別的組織或個人的東西，所以每個組織要自己勾選哪些是它的；
 * 只改 org_integrations.config 的非機密設定。「重新探索」會對平台發唯讀請求。
 * 邏輯在 src/lib/integrations/settings-service.ts（MCP／REST 工具共用）。
 */

export type CloudScopeActionState = { ok: boolean; error?: string };

const PAGE = "/dashboard/settings/integrations";

async function requireManager(): Promise<{ orgId: string; userId: string } | { error: string }> {
  const t = await getTranslations("integrations");
  const { orgId, userId, role } = await requireOrgWithRole();
  if (!canManageOrg(role)) return { error: t("errors.notAllowed") };
  return { orgId, userId };
}

export async function saveCloudBillingScopeAction(
  provider: "azure" | "gcp",
  input: { ids: string[]; bigQuery?: { projectId: string; dataset: string } | null },
): Promise<CloudScopeActionState> {
  const t = await getTranslations("integrations");
  // 在 try 外面：未登入時 requireOrg() 會 redirect，那個例外不能被吞掉。
  const me = await requireManager();
  if ("error" in me) return { ok: false, error: me.error };
  try {
    await saveCloudBillingScopeForOrg(
      {
        ...me,
        log: (action, entityType, entityId, summary) => logWeb(me.orgId, action, entityType, entityId, summary),
      },
      provider,
      // 網頁表單一律送 bigQuery（沒填 = null = 清掉），與舊行為一致。
      { ids: input?.ids, bigQuery: provider === "gcp" ? (input?.bigQuery ?? null) : undefined },
    );
    revalidatePath(PAGE);
    revalidatePath("/dashboard/vendor-billing");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : t("toast.failed") };
  }
}

/** 重新向平台列出候選（整合要已開啟）。勾選不變，只更新 config.discovered。 */
export async function refreshCloudDiscoveryAction(provider: "azure" | "gcp"): Promise<CloudScopeActionState> {
  const t = await getTranslations("integrations");
  const me = await requireManager();
  if ("error" in me) return { ok: false, error: me.error };
  try {
    await refreshCloudDiscoveryForOrg(me.orgId, provider);
    revalidatePath(PAGE);
    return { ok: true };
  } catch (e) {
    revalidatePath(PAGE);
    return { ok: false, error: e instanceof Error ? e.message : t("toast.failed") };
  }
}

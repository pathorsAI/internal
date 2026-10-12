"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { logWeb } from "@/db/activity";
import { canManageOrg, requireOrgWithRole } from "@/lib/session";
import { azureBillingAccountId, discoverAzureProfiles, withAzureClient } from "@/lib/integrations/azure";
import { withGcpClient } from "@/lib/integrations/gcp";
import { getIntegration, updateConfig } from "@/lib/integrations/store";
import {
  isValidBigQueryExport,
  parseAzureScope,
  parseGcpScope,
  sanitizeAllowlist,
} from "@/lib/vendor-billing/scope";

/**
 * 設定 › 整合 › Azure / GCP 的「計費範圍」（限 owner / admin）。
 * 同一個外部計費範圍裡可能混著別的組織或個人的東西，所以每個組織要自己勾選哪些是它的；
 * 只改 org_integrations.config 的非機密設定。「重新探索」會對平台發唯讀請求。
 */

export type CloudScopeActionState = { ok: boolean; error?: string };

const PAGE = "/dashboard/settings/integrations";

async function requireManager(): Promise<{ orgId: string } | { error: string }> {
  const t = await getTranslations("integrations");
  const { orgId, role } = await requireOrgWithRole();
  if (!canManageOrg(role)) return { error: t("errors.notAllowed") };
  return { orgId };
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
    if (provider !== "azure" && provider !== "gcp") return { ok: false, error: t("toast.failed") };
    const row = await getIntegration(me.orgId, provider);
    if (!row) return { ok: false, error: t("errors.notConnected", { name: t(`providers.${provider}.name`) }) };
    if (provider === "azure") {
      const scope = parseAzureScope(row.config);
      const ids = sanitizeAllowlist(input?.ids, scope.discovered);
      await updateConfig(me.orgId, "azure", { billingProfileIds: ids });
      await logWeb(me.orgId, "update", "integration", null, t("scope.activity.saved", { name: t("providers.azure.name"), count: ids.length }));
    } else {
      const scope = parseGcpScope(row.config);
      const ids = sanitizeAllowlist(input?.ids, scope.discovered);
      let bigQueryExport: { projectId: string; dataset: string } | null = null;
      const bq = input?.bigQuery;
      if (bq && (bq.projectId?.trim() || bq.dataset?.trim())) {
        const v = { projectId: bq.projectId.trim(), dataset: bq.dataset.trim() };
        if (!isValidBigQueryExport(v)) return { ok: false, error: t("scope.errors.bigQuery") };
        bigQueryExport = v;
      }
      await updateConfig(me.orgId, "gcp", { billingAccountIds: ids, bigQueryExport });
      await logWeb(me.orgId, "update", "integration", null, t("scope.activity.saved", { name: t("providers.gcp.name"), count: ids.length }));
    }
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
    if (provider === "azure") {
      await withAzureClient(me.orgId, async (client, row) => {
        const ba = azureBillingAccountId(row.config);
        if (!ba) throw new Error(t("scope.errors.noBillingAccount"));
        const profiles = await discoverAzureProfiles(client, ba);
        await updateConfig(me.orgId, "azure", { discovered: profiles, discoveredAt: new Date().toISOString() });
      });
    } else if (provider === "gcp") {
      await withGcpClient(me.orgId, async (client) => {
        const discovered = await client.listBillingAccounts();
        await updateConfig(me.orgId, "gcp", { discovered, discoveredAt: new Date().toISOString() });
      });
    } else {
      return { ok: false, error: t("toast.failed") };
    }
    revalidatePath(PAGE);
    return { ok: true };
  } catch (e) {
    revalidatePath(PAGE);
    return { ok: false, error: e instanceof Error ? e.message : t("toast.failed") };
  }
}

"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { canManageOrg, requireOrgWithRole } from "@/lib/session";
import { logWeb } from "@/db/activity";
import { refreshWiseBalances, saveWiseMappings, type MappingInput } from "@/lib/wise-sync";

/**
 * 設定 › 整合 › Wise 帳戶對應的 server actions（限 owner / admin）。
 * 只改 org_integrations.config 的非機密設定；refresh 會對 Wise 發唯讀 GET。
 */

export type WiseActionState = { ok: boolean; error?: string };

const PAGE = "/dashboard/settings/integrations";

async function requireManager(): Promise<{ orgId: string } | { error: string }> {
  const t = await getTranslations("wise");
  const { orgId, role } = await requireOrgWithRole();
  if (!canManageOrg(role)) return { error: t("errors.notAllowed") };
  return { orgId };
}

function toInt(v: unknown): number | null {
  let n = Number.NaN;
  if (typeof v === "number") n = v;
  else if (typeof v === "string" && v.trim() !== "") n = Number(v);
  return Number.isInteger(n) ? n : null;
}

export async function saveWiseMappingsAction(
  rows: { profileId: number; balanceId: number; bankAccountId: number | null; syncFrom: string | null }[],
): Promise<WiseActionState> {
  const t = await getTranslations("wise");
  const me = await requireManager();
  if ("error" in me) return { ok: false, error: me.error };
  try {
    if (!Array.isArray(rows)) return { ok: false, error: t("errors.failed") };
    const input: MappingInput[] = [];
    for (const r of rows) {
      const profileId = toInt(r?.profileId);
      const balanceId = toInt(r?.balanceId);
      if (profileId === null || balanceId === null) return { ok: false, error: t("errors.failed") };
      const syncFrom = typeof r.syncFrom === "string" && r.syncFrom.trim() ? r.syncFrom.trim() : null;
      input.push({ profileId, balanceId, bankAccountId: toInt(r.bankAccountId), syncFrom });
    }
    const res = await saveWiseMappings(me.orgId, input);
    if ("error" in res) return { ok: false, error: res.error };
    await logWeb(me.orgId, "update", "integration", null, t("mapping.activity.saved"));
    revalidatePath(PAGE);
    revalidatePath("/dashboard/bank-accounts");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : t("errors.failed") };
  }
}

export async function refreshWiseBalancesAction(): Promise<WiseActionState> {
  const t = await getTranslations("wise");
  const me = await requireManager();
  if ("error" in me) return { ok: false, error: me.error };
  try {
    await refreshWiseBalances(me.orgId);
    revalidatePath(PAGE);
    return { ok: true };
  } catch (e) {
    revalidatePath(PAGE);
    return { ok: false, error: e instanceof Error ? e.message : t("errors.failed") };
  }
}

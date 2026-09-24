"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { canManageOrg, requireOrgWithRole } from "@/lib/session";
import { logWeb } from "@/db/activity";
import { syncWiseTransactions, type SyncResult } from "@/lib/wise-sync";

/**
 * 帳戶頁「從 Wise 同步」：先 preview（dryRun）給人看，確認後 apply 才寫入。
 * 限 owner / admin。只讀 Wise、只寫本組織帳本。
 */

export type WiseSyncActionResult = { ok: true; result: SyncResult } | { ok: false; error: string };

async function run(accountId: number | null, dryRun: boolean): Promise<WiseSyncActionResult> {
  const t = await getTranslations("wise");
  const { orgId, role } = await requireOrgWithRole();
  if (!canManageOrg(role)) return { ok: false, error: t("errors.notAllowed") };
  try {
    const result = await syncWiseTransactions(orgId, {
      accountId: accountId ?? undefined,
      dryRun,
    });
    if (!dryRun) {
      await logWeb(
        orgId,
        "create",
        "transaction",
        null,
        t("sync.activity.applied", { count: result.totals.created }),
      );
      revalidatePath("/dashboard/transactions");
      revalidatePath("/dashboard/bank-accounts");
      revalidatePath("/dashboard");
    }
    return { ok: true, result };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : t("errors.failed") };
  }
}

export async function previewWiseSync(accountId: number | null): Promise<WiseSyncActionResult> {
  return run(accountId, true);
}

export async function applyWiseSync(accountId: number | null): Promise<WiseSyncActionResult> {
  return run(accountId, false);
}

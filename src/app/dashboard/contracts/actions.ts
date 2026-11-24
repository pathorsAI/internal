"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { logWeb } from "@/db/activity";
import { contracts } from "@/db/schema";
import { requireOrg } from "@/lib/session";

/**
 * 合約頁「已收齊，可結案」的一鍵結案：只把草稿 / 進行中的合約改成 completed，其他欄位不動
 * （完整編輯走 updateContract 的表單）。
 */
export async function markContractCompleted(id: number): Promise<{ ok: boolean; error?: string }> {
  const t = await getTranslations("links");
  if (!Number.isSafeInteger(id) || id <= 0) return { ok: false, error: t("contractClose.failed") };
  try {
    const { orgId } = await requireOrg();
    const [row] = await getDb()
      .update(contracts)
      .set({ status: "completed" })
      .where(
        and(
          eq(contracts.organizationId, orgId),
          eq(contracts.id, id),
          isNull(contracts.deletedAt),
          inArray(contracts.status, ["draft", "active"]),
        ),
      )
      .returning({ id: contracts.id, title: contracts.title });
    if (!row) return { ok: false, error: t("contractClose.failed") };
    await logWeb(orgId, "update", "contract", id, `${row.title} → completed`);
    revalidatePath("/dashboard/contracts");
    revalidatePath("/dashboard/projects");
    revalidatePath("/dashboard/billing");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : t("contractClose.failed") };
  }
}

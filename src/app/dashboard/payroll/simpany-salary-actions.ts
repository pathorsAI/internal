"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { logWeb } from "@/db/activity";
import { canManageOrg, requireOrgWithRole } from "@/lib/session";
import { IntegrationUnavailableError } from "@/lib/integrations/store";
import { SimpanyError } from "@/lib/integrations/simpany";
import { syncSalaryDeclarations, type SalarySyncResult } from "@/lib/simpany-salary";

/**
 * 薪資頁「從 Simpany 同步薪資申報」。限 owner / admin（按鈕只對他們顯示，這裡再擋一次）。
 * 對 Simpany 只發 GET；只寫本組織的 simpany_salary_* 表。回傳值不含個資。
 */
export async function syncSalaryDeclarationsAction(
  year: number,
): Promise<{ ok: true; data: SalarySyncResult } | { ok: false; error: string }> {
  const t = await getTranslations("integrations");
  const { orgId, role } = await requireOrgWithRole();
  if (!canManageOrg(role)) return { ok: false, error: t("errors.notAllowed") };
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    return { ok: false, error: `不合法的年份：${year}` };
  }
  try {
    const res = await syncSalaryDeclarations(orgId, year);
    const filed = res.months.filter((m) => m.filedCount > 0).length;
    await logWeb(
      orgId,
      "update",
      "integration",
      null,
      `simpany: salary sync ${year}: ${filed} filed months, ${res.declarationsUpserted} rows, -${res.declarationsRemoved}`,
    );
    revalidatePath("/dashboard/payroll");
    return { ok: true, data: res };
  } catch (e) {
    if (e instanceof IntegrationUnavailableError || e instanceof SimpanyError) {
      return { ok: false, error: e.message };
    }
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

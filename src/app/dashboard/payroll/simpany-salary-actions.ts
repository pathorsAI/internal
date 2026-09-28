"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { logWeb } from "@/db/activity";
import { canManageOrg, requireOrgWithRole } from "@/lib/session";
import { IntegrationUnavailableError } from "@/lib/integrations/store";
import { SimpanyError } from "@/lib/integrations/simpany";
import { syncSalaryDeclarations, type SalarySyncResult } from "@/lib/simpany-salary";
import {
  applySalaryFiling,
  cancelSalaryDraft,
  prepareSalaryFiling,
  salaryFilingDefaults,
  SalaryFilingError,
  sendPayslips,
  settleSalaryFiling,
  type SalaryApplyResult,
  type SalaryFilingDefaults,
  type SalaryFilingPreview,
  type SendPayslipsResult,
  type SettleInput,
  type SettleResult,
} from "@/lib/simpany-payroll";

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

// ---------------------------------------------------------------------------
// 薪資申報寫入（src/lib/simpany-payroll.ts）：準備 → 寫入 → 結算 → 寄薪資單。
// 全部限 owner / admin；每一步都是使用者在 Sheet 裡明確按下的。回傳值不含個資。
// ---------------------------------------------------------------------------

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

async function manager(): Promise<{ orgId: string; userId: string } | { error: string }> {
  const t = await getTranslations("integrations");
  const { orgId, userId, role } = await requireOrgWithRole();
  if (!canManageOrg(role)) return { error: t("errors.notAllowed") };
  return { orgId, userId };
}

function fail(e: unknown): { ok: false; error: string } {
  if (
    e instanceof IntegrationUnavailableError ||
    e instanceof SimpanyError ||
    e instanceof SalaryFilingError
  ) {
    return { ok: false, error: e.message };
  }
  return { ok: false, error: e instanceof Error ? e.message : String(e) };
}

const ym = (year: number, month: number) => `${year}-${String(month).padStart(2, "0")}`;

function validYearMonth(year: number, month: number): boolean {
  return Number.isInteger(year) && year >= 2000 && year <= 2100 && Number.isInteger(month) && month >= 1 && month <= 12;
}

/** 開 Sheet 時的預設值（只讀本地表，不打 Simpany）。 */
export async function loadSalaryFilingDefaultsAction(
  year: number,
  month: number,
): Promise<Result<SalaryFilingDefaults>> {
  const me = await manager();
  if ("error" in me) return { ok: false, error: me.error };
  if (!validYearMonth(year, month)) return { ok: false, error: `不合法的月份：${ym(year, month)}` };
  try {
    return { ok: true, data: await salaryFilingDefaults(me.orgId, year, month) };
  } catch (e) {
    return fail(e);
  }
}

export type SalaryFilingFormInput = {
  year: number;
  month: number;
  payday: string;
  allowCopy: boolean;
  employees: { name: string; employeeId: number | null; baseSalary: number; bonus: number; reimbursement: number }[];
};

/** 試算 + 存草稿（不存檔申報明細）。allowCopy 時會把缺的人從上個已結算月份複製進來。 */
export async function prepareSalaryFilingAction(input: SalaryFilingFormInput): Promise<Result<SalaryFilingPreview>> {
  const me = await manager();
  if ("error" in me) return { ok: false, error: me.error };
  if (!validYearMonth(input.year, input.month)) return { ok: false, error: `不合法的月份：${ym(input.year, input.month)}` };
  try {
    // 只收白名單欄位。
    const preview = await prepareSalaryFiling(me.orgId, me.userId, {
      year: input.year,
      month: input.month,
      payday: input.payday || undefined,
      allowCopy: input.allowCopy === true,
      employees: input.employees.map((e) => ({
        employeeId: e.employeeId ?? undefined,
        name: e.employeeId == null ? e.name : undefined,
        baseSalary: e.baseSalary,
        bonus: e.bonus || undefined,
        reimbursement: e.reimbursement || undefined,
      })),
    });
    if (preview.copy?.performed) {
      await logWeb(
        me.orgId,
        "update",
        "integration",
        null,
        `simpany: salary ${ym(input.year, input.month)} copied ${preview.copy.employees.length} from form #${preview.copy.sourceFormId}`,
      );
    }
    return { ok: true, data: preview };
  } catch (e) {
    return fail(e);
  }
}

/** 把預覽過的草稿寫進 Simpany（尚未結算）。 */
export async function applySalaryFilingAction(draftId: number): Promise<Result<SalaryApplyResult>> {
  const me = await manager();
  if ("error" in me) return { ok: false, error: me.error };
  try {
    const res = await applySalaryFiling(me.orgId, draftId);
    await logWeb(
      me.orgId,
      "update",
      "integration",
      null,
      `simpany: salary apply draft #${draftId} ${ym(res.year, res.month)}: wrote ${res.written.length}, verified ${res.verified}`,
    );
    revalidatePath("/dashboard/payroll");
    return { ok: true, data: res };
  } catch (e) {
    await logWeb(
      me.orgId,
      "update",
      "integration",
      null,
      `simpany: salary apply draft #${draftId} failed: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`,
    );
    return fail(e);
  }
}

export async function cancelSalaryDraftAction(draftId: number): Promise<Result<boolean>> {
  const me = await manager();
  if ("error" in me) return { ok: false, error: me.error };
  try {
    return { ok: true, data: await cancelSalaryDraft(me.orgId, draftId) };
  } catch (e) {
    return fail(e);
  }
}

/** 結算（送給記帳士）。三個確認都要勾。 */
export async function settleSalaryFilingAction(input: SettleInput): Promise<Result<SettleResult>> {
  const me = await manager();
  if ("error" in me) return { ok: false, error: me.error };
  if (!validYearMonth(input.year, input.month)) return { ok: false, error: `不合法的月份：${ym(input.year, input.month)}` };
  try {
    const res = await settleSalaryFiling(me.orgId, {
      year: input.year,
      month: input.month,
      confirmPayday: input.confirmPayday === true,
      confirmOwner: input.confirmOwner === true,
      confirmSalary: input.confirmSalary === true,
    });
    await logWeb(me.orgId, "update", "integration", null, `simpany: salary settle ${ym(input.year, input.month)}`);
    revalidatePath("/dashboard/payroll");
    return { ok: true, data: res };
  } catch (e) {
    return fail(e);
  }
}

/** 寄薪資單給這個月表單上的所有人（已結算的月份）。 */
export async function sendPayslipsAction(year: number, month: number): Promise<Result<SendPayslipsResult>> {
  const me = await manager();
  if ("error" in me) return { ok: false, error: me.error };
  if (!validYearMonth(year, month)) return { ok: false, error: `不合法的月份：${ym(year, month)}` };
  try {
    const res = await sendPayslips(me.orgId, { year, month });
    await logWeb(
      me.orgId,
      "update",
      "integration",
      null,
      `simpany: payslips ${ym(year, month)} sent to ${res.recipients.length}`,
    );
    revalidatePath("/dashboard/payroll");
    return { ok: true, data: res };
  } catch (e) {
    return fail(e);
  }
}

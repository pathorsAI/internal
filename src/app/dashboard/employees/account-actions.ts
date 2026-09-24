"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { canManageOrg, requireOrgWithRole } from "@/lib/session";
import { logWeb } from "@/db/activity";
import {
  convertLegacySalaryAccount,
  createEmployeeAccount,
  getEmployeeAccount,
  revealEmployeeAccountNumber,
  softDeleteEmployeeAccount,
  updateEmployeeAccount,
} from "@/db/employee-accounts";
import { EmployeeAccountError, formatAccountShort } from "@/lib/employee-accounts";
import type { ActionState } from "@/db/mutations";

/**
 * 員工收款帳戶的網頁端 action。全部只給 owner / admin：
 * 隱藏按鈕只擋得住誤按，擋不住直接呼叫 action，所以每一支都在 server 端重驗角色。
 *
 * 帳戶區塊放在員工編輯表單「裡面」（不能巢狀 <form>），所以這些 action 收的是
 * 一般物件而不是 FormData，由區塊自己的「儲存」按鈕呼叫。
 */

export type EmployeeAccountFormInput = {
  /** 有值 = 更新；沒有 = 新增 */
  id?: number | null;
  employeeId: number;
  kind: string;
  bankCode: string;
  branchCode: string;
  bankName: string;
  accountHolder: string;
  /** 更新時留空 = 不改帳號 */
  accountNumber: string;
  currency: string;
  label: string;
  defaultForSalary: boolean;
  defaultForReimbursement: boolean;
  isActive: boolean;
  note: string;
};

async function requireManager(): Promise<{ orgId: string } | { error: string }> {
  const ctx = await requireOrgWithRole();
  if (!canManageOrg(ctx.role)) {
    const t = await getTranslations("errors");
    return { error: t("forbidden.manageEmployees") };
  }
  return { orgId: ctx.orgId };
}

/** EmployeeAccountError → 已翻譯字串；其他錯誤照舊回傳訊息。 */
async function accountErrorMessage(e: unknown, fallbackKey: "create" | "update" | "delete") {
  const t = await getTranslations("errors");
  if (e instanceof EmployeeAccountError) return t(`employeeAccount.${e.code}`);
  return e instanceof Error ? e.message : t(`failed.${fallbackKey}`);
}

function revalidateEmployees() {
  revalidatePath("/dashboard/employees");
  revalidatePath("/dashboard/payroll");
  revalidatePath("/dashboard/advances");
}

export async function saveEmployeeAccount(input: EmployeeAccountFormInput): Promise<ActionState> {
  const auth = await requireManager();
  if ("error" in auth) return { ok: false, error: auth.error };
  const { orgId } = auth;
  const isUpdate = input.id != null;
  try {
    const fields = {
      kind: input.kind,
      bankCode: input.bankCode,
      branchCode: input.branchCode,
      bankName: input.bankName,
      accountHolder: input.accountHolder,
      accountNumber: input.accountNumber,
      currency: input.currency,
      label: input.label,
      defaultForSalary: input.defaultForSalary,
      defaultForReimbursement: input.defaultForReimbursement,
      isActive: input.isActive,
      note: input.note,
    };
    const saved = isUpdate
      ? await updateEmployeeAccount(orgId, input.id as number, fields)
      : await createEmployeeAccount(orgId, input.employeeId, fields);
    // 摘要只放遮罩後的字樣，完整帳號絕不進 activity_log。
    await logWeb(orgId, isUpdate ? "update" : "create", "employee_bank_account", saved.id, formatAccountShort(saved));
    revalidateEmployees();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: await accountErrorMessage(e, isUpdate ? "update" : "create") };
  }
}

export async function deleteEmployeeAccount(id: number): Promise<ActionState> {
  const auth = await requireManager();
  if ("error" in auth) return { ok: false, error: auth.error };
  try {
    const removed = await softDeleteEmployeeAccount(auth.orgId, id);
    await logWeb(auth.orgId, "delete", "employee_bank_account", id, formatAccountShort(removed));
    revalidateEmployees();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: await accountErrorMessage(e, "delete") };
  }
}

/**
 * 顯示完整帳號：唯一會把明文送到瀏覽器的路徑。只給 owner / admin，每一次都寫
 * activity_log（action = read），事後查得到誰在什麼時候看過哪個帳戶。
 */
export async function revealEmployeeAccount(
  id: number,
): Promise<{ ok: true; accountNumber: string } | { ok: false; error: string }> {
  const auth = await requireManager();
  if ("error" in auth) return { ok: false, error: auth.error };
  const t = await getTranslations("errors");
  const tRec = await getTranslations("lib");
  try {
    const accountNumber = await revealEmployeeAccountNumber(auth.orgId, id);
    const acct = await getEmployeeAccount(auth.orgId, id);
    // 摘要只記遮罩後的帳戶，不記完整帳號。
    await logWeb(
      auth.orgId,
      "read",
      "employee_bank_account",
      id,
      tRec("activity.accountRevealed", { account: acct ? formatAccountShort(acct) : `#${id}` }),
    );
    return { ok: true, accountNumber };
  } catch (e) {
    if (e instanceof EmployeeAccountError) return { ok: false, error: t(`employeeAccount.${e.code}`) };
    return { ok: false, error: t("employeeAccount.revealFailed") };
  }
}

/** 把舊的 salary_account 自由文字轉成一個「薪資預設」帳戶，並清空舊欄位。 */
export async function convertLegacySalaryAccountAction(employeeId: number): Promise<ActionState> {
  const auth = await requireManager();
  if ("error" in auth) return { ok: false, error: auth.error };
  try {
    const created = await convertLegacySalaryAccount(auth.orgId, employeeId);
    if (!created) {
      const t = await getTranslations("errors");
      return { ok: false, error: t("employeeAccount.nothingToConvert") };
    }
    await logWeb(auth.orgId, "create", "employee_bank_account", created.id, formatAccountShort(created));
    revalidateEmployees();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: await accountErrorMessage(e, "create") };
  }
}

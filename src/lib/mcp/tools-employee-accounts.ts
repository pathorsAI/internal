// 員工收款帳戶的 MCP tools。
//
// 刻意的限制（不要放寬）：
// - 任何回傳都只有遮罩後的欄位（末 5 碼），MCP 沒有「顯示完整帳號」的能力。
//   完整帳號只能在網頁端由 owner / admin 明確點擊顯示，並寫入操作紀錄。
// - 寫入時接受完整帳號（跟 create_employee 收身分證字號一樣），但從不回顯。
// - 寫入只給 owner / admin，跟網頁端的員工資料寫入權限一致。
import { getMemberRole } from "@/db/queries";
import {
  createEmployeeAccount,
  listEmployeeAccounts,
  softDeleteEmployeeAccount,
  updateEmployeeAccount,
  type EmployeeAccountInput,
} from "@/db/employee-accounts";
import { employees } from "@/db/schema";
import { getDb } from "@/db";
import { EMPLOYEE_ACCOUNT_KINDS, type MaskedEmployeeAccount } from "@/lib/employee-accounts";
import {
  assertInOrg,
  listResult,
  listSchema,
  optBoolean,
  optNumber,
  optString,
  ORG_ARG,
  requireNumber,
  resolveOrg,
  rowSchema,
  type ToolDef,
} from "./shared";

/** 員工資料（含收款帳戶）的寫入只給 owner / admin。 */
export async function assertCanManageEmployees(orgId: string, userId: string): Promise<void> {
  const role = await getMemberRole(orgId, userId);
  if (role !== "owner" && role !== "admin") {
    throw new Error(
      "Only organization owners and admins can change employee records or employee bank accounts.",
    );
  }
}

/** 一個遮罩後的員工帳戶（MaskedEmployeeAccount）。 */
export const EMPLOYEE_ACCOUNT_ROW = rowSchema({
  id: { type: "number", description: "Pass as toEmployeeAccountId to pay_employee_salary / create_reimbursement." },
  employeeId: { type: "number" },
  kind: { type: "string", enum: [...EMPLOYEE_ACCOUNT_KINDS] },
  bankCode: { type: ["string", "null"], description: "3-digit Taiwan bank code, e.g. 807." },
  branchCode: { type: ["string", "null"], description: "4-digit branch code." },
  bankName: { type: ["string", "null"] },
  accountHolder: { type: ["string", "null"] },
  accountLast5: {
    type: "string",
    description: "Last 5 characters of the account number. The full number is never returned over MCP.",
  },
  currency: { type: "string", description: "3-letter code." },
  label: { type: ["string", "null"] },
  defaultForSalary: { type: "boolean" },
  defaultForReimbursement: { type: "boolean" },
  isActive: { type: "boolean" },
  note: { type: ["string", "null"] },
});

/** 輸出用的遮罩摘要：「永豐銀行 807 ••••90123」。 */
export function maskedAccountSummary(a: MaskedEmployeeAccount): string {
  const head = [a.bankName, a.bankCode].filter(Boolean).join(" ");
  const prefix = head ? `${head} ` : "";
  return `${prefix}••••${a.accountLast5}`;
}

/** 發薪 / 撥款結果裡的「匯入帳戶」欄位（可為 null）。 */
export const PAYOUT_ACCOUNT_SCHEMA = {
  type: ["object", "null"],
  description:
    "The employee bank account the money was recorded as going to (masked), or null when none was given and the employee has no default for this purpose.",
  properties: {
    id: { type: "number" },
    summary: { type: "string", description: "Masked, e.g. 永豐銀行 807 ••••90123." },
    currency: { type: "string" },
  },
  required: ["id", "summary", "currency"],
  additionalProperties: false,
};

export function payoutAccountOutput(a: MaskedEmployeeAccount | null) {
  return a ? { id: a.id, summary: maskedAccountSummary(a), currency: a.currency } : null;
}

const WRITE_PROPS = {
  kind: {
    type: "string",
    enum: [...EMPLOYEE_ACCOUNT_KINDS],
    description: "bank (Taiwan bank / post office; bankCode required, digits-only number), wise, or other.",
  },
  bankCode: { type: "string", description: "3-digit bank code (e.g. 807 永豐, 822 中國信託, 700 中華郵政)." },
  branchCode: { type: "string", description: "Optional 4-digit branch code." },
  bankName: { type: "string", description: "Optional; filled from bankCode for common Taiwan banks." },
  accountHolder: { type: "string" },
  currency: { type: "string", description: "3-letter; default TWD." },
  label: { type: "string", description: "Free label, e.g. 薪轉戶." },
  defaultForSalary: {
    type: "boolean",
    description: "Make this the salary default (clears the previous salary default for this employee).",
  },
  defaultForReimbursement: {
    type: "boolean",
    description: "Make this the reimbursement default (clears the previous one for this employee).",
  },
  note: { type: "string" },
};

/** MCP args → EmployeeAccountInput，只帶有傳進來的欄位（update 的 partial 語意）。 */
function accountInput(args: Record<string, unknown>): EmployeeAccountInput {
  const input: EmployeeAccountInput = {};
  for (const k of ["kind", "bankCode", "branchCode", "bankName", "accountHolder", "accountNumber", "currency", "label", "note"] as const) {
    if (k in args) input[k] = optString(args, k) ?? null;
  }
  for (const k of ["defaultForSalary", "defaultForReimbursement", "isActive"] as const) {
    const v = optBoolean(args, k);
    if (v !== undefined) input[k] = v;
  }
  return input;
}

export const employeeAccountTools: Record<string, ToolDef> = {
  list_employee_bank_accounts: {
    description:
      "List employees' bank accounts (where salary / reimbursements are paid into). Masked: only the last 5 characters of each account number are returned — the full number is never available over MCP. Omit employeeId for the whole organization.",
    inputSchema: {
      type: "object",
      properties: {
        employeeId: { type: "number", description: "See list_employees." },
        ...ORG_ARG,
      },
      additionalProperties: false,
    },
    outputSchema: listSchema(EMPLOYEE_ACCOUNT_ROW),
    execute: async (args, ctx) => {
      const orgId = await resolveOrg(args, ctx);
      const employeeId = optNumber(args, "employeeId");
      if (employeeId !== undefined) await assertInOrg(getDb(), employees, employeeId, orgId, "Employee");
      return listResult(await listEmployeeAccounts(orgId, employeeId));
    },
  },

  create_employee_bank_account: {
    description:
      "Add a bank account to an employee's record (owner/admin only). The full account number is stored encrypted and is never echoed back — the result shows only the last 5 characters. Spaces and dashes in the number are ignored. The first account is not made a default automatically; pass defaultForSalary / defaultForReimbursement.",
    inputSchema: {
      type: "object",
      properties: {
        employeeId: { type: "number", description: "See list_employees." },
        accountNumber: { type: "string", description: "Full account number. Stored encrypted; never returned." },
        ...WRITE_PROPS,
        ...ORG_ARG,
      },
      required: ["employeeId", "accountNumber"],
      additionalProperties: false,
    },
    outputSchema: EMPLOYEE_ACCOUNT_ROW,
    execute: async (args, ctx) => {
      const orgId = await resolveOrg(args, ctx);
      await assertCanManageEmployees(orgId, ctx.userId);
      const employeeId = requireNumber(args, "employeeId");
      await assertInOrg(getDb(), employees, employeeId, orgId, "Employee");
      return createEmployeeAccount(orgId, employeeId, accountInput(args));
    },
  },

  update_employee_bank_account: {
    description:
      "Update an employee bank account (owner/admin only; only provided fields change). Pass accountNumber only to replace the number — it is stored encrypted and never echoed back. Set isActive=false to deactivate (also clears its default flags).",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number", description: "See list_employee_bank_accounts." },
        accountNumber: { type: "string", description: "New full account number (optional). Never returned." },
        ...WRITE_PROPS,
        isActive: { type: "boolean" },
        ...ORG_ARG,
      },
      required: ["id"],
      additionalProperties: false,
    },
    outputSchema: EMPLOYEE_ACCOUNT_ROW,
    execute: async (args, ctx) => {
      const orgId = await resolveOrg(args, ctx);
      await assertCanManageEmployees(orgId, ctx.userId);
      const input = accountInput(args);
      if (Object.keys(input).length === 0) throw new Error("Nothing to update.");
      return updateEmployeeAccount(orgId, requireNumber(args, "id"), input);
    },
  },

  delete_employee_bank_account: {
    description:
      "Delete an employee bank account (owner/admin only). Payslips and reimbursements already recorded against it keep their reference.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "number" }, ...ORG_ARG },
      required: ["id"],
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: { deleted: { type: "boolean" }, id: { type: "number" } },
      required: ["deleted", "id"],
      additionalProperties: false,
    },
    execute: async (args, ctx) => {
      const orgId = await resolveOrg(args, ctx);
      await assertCanManageEmployees(orgId, ctx.userId);
      const id = requireNumber(args, "id");
      await softDeleteEmployeeAccount(orgId, id);
      return { deleted: true, id };
    },
  },
};

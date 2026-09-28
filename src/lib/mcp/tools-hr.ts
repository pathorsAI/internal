import { and, asc, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import {
  accountReconciliations,
  bankAccounts,
  categories,
  documents,
  employees,
  payrollRuns,
  payslipItems,
  payslips,
  transactions,
} from "@/db/schema";
import { member } from "@/db/auth-schema";
import {
  getEmployee,
  listAccountantNotices,
  listEmployees,
  listOrgMembers,
  listPayrollRuns,
  listPayslipRecords,
  listReconciliations,
} from "@/db/queries";
import {
  assertInOrg,
  fkError,
  listResult,
  listSchema,
  optBoolean,
  optDecimal,
  optNumber,
  optString,
  ORG_ARG,
  requireDate,
  requireDecimal,
  requireNumber,
  requireString,
  resolveOrg,
  rowSchema,
  todayStr,
  type ToolDef,
} from "./shared";
import { assertAccountCurrency } from "@/lib/account-currency";
import { isValidEmail, maskBankAccount } from "@/lib/pii";
import {
  createEmployeeAccount,
  groupAccountsByEmployee,
  listEmployeeAccounts,
  nationalIdColumns,
  readMaskedNationalId,
  resolvePayoutAccount,
} from "@/db/employee-accounts";
import {
  LEGACY_ACCOUNT_NOTE,
  parseLegacySalaryAccount,
  type MaskedEmployeeAccount,
} from "@/lib/employee-accounts";
import {
  EMPLOYEE_ACCOUNT_ROW,
  PAYOUT_ACCOUNT_SCHEMA,
  assertCanManageEmployees,
  payoutAccountOutput,
} from "./tools-employee-accounts";

const EMPLOYMENT_TYPES = ["full_time", "part_time", "freelancer", "contractor"] as const;

function checkEmploymentType(v: string | undefined) {
  if (v !== undefined && !EMPLOYMENT_TYPES.includes(v as (typeof EMPLOYMENT_TYPES)[number])) {
    throw new Error(`"employmentType" must be one of: ${EMPLOYMENT_TYPES.join(", ")}.`);
  }
}

type SalaryItem = {
  itemTypeId: number | null;
  name: string;
  direction: "earning" | "deduction";
  isTaxable: boolean;
  amount: number;
};

// Validate + normalize the raw salary line items into typed, non-zero rows.
function parseSalaryItems(raw: unknown): SalaryItem[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error('"items" must be a non-empty array of salary line items.');
  }
  return raw
    .map((r, i) => {
      const o = (r ?? {}) as Record<string, unknown>;
      const name = typeof o.name === "string" ? o.name.trim() : "";
      const amount = typeof o.amount === "number" ? o.amount : Number(o.amount);
      if (!name) throw new Error(`items[${i}].name is required.`);
      if (!Number.isFinite(amount)) throw new Error(`items[${i}].amount must be a number.`);
      const direction: "earning" | "deduction" =
        o.direction === "deduction" ? "deduction" : "earning";
      let isTaxable: boolean;
      if (direction === "deduction") isTaxable = false;
      else if (o.isTaxable === undefined) isTaxable = true;
      else isTaxable = Boolean(o.isTaxable);
      return {
        itemTypeId: typeof o.itemTypeId === "number" ? o.itemTypeId : null,
        name,
        direction,
        isTaxable,
        amount,
      };
    })
    .filter((r) => r.amount !== 0);
}

function checkEmailArg(args: Record<string, unknown>, key: string) {
  const v = optString(args, key);
  if (v && !isValidEmail(v)) throw new Error(`"${key}" is not a valid email address.`);
}

// 員工資料離開 MCP 前遮罩身分證字號與薪轉帳戶 — MCP 的用途（payroll、
// 聯絡資訊查詢）不需要完整值；完整值只在網頁端給 owner / admin 看。
// national_id_enc（密文）不能出現在輸出裡，連密文都不給。
type EmployeeRowIn = typeof employees.$inferSelect;

async function redactEmployee(e: EmployeeRowIn, accounts: MaskedEmployeeAccount[]) {
  // 密文欄位整個拿掉（schema 是封閉的，多一個 key 也會讓 structuredContent 不合法）
  const rest: Partial<EmployeeRowIn> = { ...e };
  delete rest.nationalIdEnc;
  const salaryDefault = accounts.find((a) => a.defaultForSalary && a.isActive);
  return {
    ...(rest as Omit<EmployeeRowIn, "nationalIdEnc">),
    nationalId: await readMaskedNationalId(e),
    // 相容舊欄位：有薪資預設帳戶就用它的末 5 碼，否則退回舊的自由文字（遮罩）。
    salaryAccount: salaryDefault
      ? `****${salaryDefault.accountLast5}`
      : maskBankAccount(e.salaryAccount),
    bankAccounts: accounts,
  };
}

/** 單筆員工 → MCP 輸出（含遮罩後的帳戶清單）。 */
async function employeeOut(orgId: string, e: EmployeeRowIn) {
  return redactEmployee(e, await listEmployeeAccounts(orgId, e.id));
}

/**
 * 舊的 salaryAccount 參數（已淘汰）：不再寫進明文欄位，改建一個「薪資預設」帳戶
 * （帳號加密）。這樣舊的 MCP 呼叫端照樣能用，DB 裡也不會多出明文帳號。
 */
async function salaryAccountArgToAccount(
  orgId: string,
  employeeId: number,
  holder: string,
  raw: string | undefined,
) {
  const parsed = raw ? parseLegacySalaryAccount(raw) : null;
  if (!parsed) return;
  await createEmployeeAccount(orgId, employeeId, {
    ...parsed,
    accountHolder: holder,
    currency: "TWD",
    defaultForSalary: true,
    note: LEGACY_ACCOUNT_NOTE,
  });
}

// 員工列（employees 全欄位）離開 MCP 時的形狀。drizzle 的 numeric 欄位回傳的是
// 字串而不是數字，date 欄位是 YYYY-MM-DD 字串；nationalId / salaryAccount 描述的
// 是 redactEmployee 遮罩「之後」的值，所以型別仍是字串，只是內容被 * 蓋掉。
const EMPLOYEE_PROPS = {
  id: { type: "number" },
  organizationId: { type: ["string", "null"] },
  name: { type: "string" },
  nationalId: {
    type: ["string", "null"],
    description:
      "Masked: only the first 3 characters survive, the rest become '*' (e.g. A12*******). Null when unset.",
  },
  employmentType: { type: "string", enum: [...EMPLOYMENT_TYPES] },
  hasLaborInsurance: { type: "boolean" },
  hasHealthInsurance: { type: "boolean" },
  hasPension: { type: "boolean" },
  baseSalary: { type: ["string", "null"], description: "Decimal as a string." },
  laborInsuredSalary: { type: ["string", "null"], description: "Decimal as a string." },
  healthInsuredSalary: { type: ["string", "null"], description: "Decimal as a string." },
  salaryAccount: {
    type: ["string", "null"],
    description:
      "Deprecated — see bankAccounts. Masked: the last 5 characters of the salary-default account (e.g. ****12345), or of the legacy free-text value. Null when unset.",
  },
  startDate: { type: ["string", "null"], description: "YYYY-MM-DD." },
  endDate: { type: ["string", "null"], description: "YYYY-MM-DD." },
  isActive: { type: "boolean" },
  workEmail: { type: ["string", "null"] },
  personalEmail: { type: ["string", "null"] },
  phone: { type: ["string", "null"] },
  note: { type: ["string", "null"] },
  userId: { type: ["string", "null"], description: "Bound login user id, or null." },
  createdAt: { type: "string", description: "ISO 8601 timestamp." },
  deletedAt: { type: ["string", "null"], description: "ISO 8601 timestamp." },
  bankAccounts: {
    type: "array",
    description:
      "The employee's bank accounts, masked (last 5 characters only). Manage them with the *_employee_bank_account tools.",
    items: EMPLOYEE_ACCOUNT_ROW,
  },
};
// 這些 tool 都用 `.returning()` 回整列，欄位一定到齊（值可能是 null）。
const EMPLOYEE_REQUIRED = Object.keys(EMPLOYEE_PROPS);

const RECONCILIATION_PROPS = {
  id: { type: "number" },
  organizationId: { type: ["string", "null"] },
  accountId: { type: "number" },
  asOfDate: { type: "string", description: "YYYY-MM-DD." },
  statementBalance: { type: "string", description: "Decimal as a string." },
  note: { type: ["string", "null"] },
  createdAt: { type: "string", description: "ISO 8601 timestamp." },
  deletedAt: { type: ["string", "null"], description: "ISO 8601 timestamp." },
};
const RECONCILIATION_REQUIRED = Object.keys(RECONCILIATION_PROPS);

// 下面幾支清單工具回的是 db/queries.ts 的投影（不是整列），形狀照那邊的 select。

const ORG_MEMBER_ROW = rowSchema({
  userId: { type: "string", description: "Pass this back as `userId` when binding an employee." },
  name: { type: "string" },
  email: { type: "string" },
});

const PAYROLL_RUN_ROW = rowSchema({
  id: { type: "number" },
  periodYear: { type: "number" },
  periodMonth: { type: "number", description: "1-12." },
  payDate: { type: ["string", "null"], description: "YYYY-MM-DD." },
  status: { type: "string", enum: ["draft", "finalized", "paid"] },
  note: { type: ["string", "null"] },
  payslipCount: { type: "number" },
  netTotal: { type: "string", description: "Sum of the run's net pay, decimal as a string." },
});

const PAYSLIP_ROW = rowSchema({
  id: { type: "number" },
  employeeName: { type: ["string", "null"] },
  periodYear: { type: "number" },
  periodMonth: { type: "number", description: "1-12." },
  payDate: { type: ["string", "null"], description: "YYYY-MM-DD." },
  taxableTotal: { type: "string", description: "Decimal as a string." },
  nontaxableTotal: { type: "string", description: "Decimal as a string." },
  deductionTotal: { type: "string", description: "Decimal as a string." },
  netPay: { type: "string", description: "Decimal as a string." },
  paidTransactionId: {
    type: ["number", "null"],
    description: "The salary-expense ledger entry; null while the payslip is still unbooked.",
  },
  paidToAccountId: {
    type: ["number", "null"],
    description: "Employee bank account the salary was recorded as paid into; see list_employee_bank_accounts.",
  },
  paidToBankName: { type: ["string", "null"] },
  paidToAccountLast5: { type: ["string", "null"], description: "Masked: last 5 characters only." },
});

const RECONCILIATION_LIST_ROW = rowSchema({
  id: { type: "number" },
  accountId: { type: "number" },
  accountName: { type: ["string", "null"] },
  currency: { type: ["string", "null"], description: "3-letter code, from the account." },
  asOfDate: { type: "string", description: "YYYY-MM-DD." },
  statementBalance: { type: "string", description: "Decimal as a string." },
  note: { type: ["string", "null"] },
  bookBalance: {
    type: ["string", "null"],
    description: "Computed book balance on asOfDate; decimal as a string.",
  },
});

const ACCOUNTANT_NOTICE_ROW = rowSchema({
  id: { type: "number", description: "Document id; pass as documentId to mark_accountant_notified." },
  fileName: { type: ["string", "null"] },
  r2Key: { type: "string", description: "Object-storage key of the scanned invoice." },
  notifiedAt: {
    type: ["string", "null"],
    description: "ISO 8601 timestamp; null while the accountant has not been told.",
  },
  uploadedAt: { type: "string", description: "ISO 8601 timestamp." },
  txnId: { type: "number" },
  txnDate: { type: "string", description: "YYYY-MM-DD." },
  amount: { type: "string", description: "Decimal as a string." },
  currency: { type: "string", description: "3-letter code." },
  description: { type: ["string", "null"] },
  partyName: { type: ["string", "null"] },
  categoryName: { type: ["string", "null"] },
});

/**
 * Validate an employee → login-user binding: the user must be a member of the
 * org and not already bound to another (non-deleted) employee. Binding is
 * optional — roster-only employees keep userId NULL.
 */
async function checkEmployeeUserBinding(orgId: string, userId: string, excludeEmployeeId?: number) {
  const db = getDb();
  const [m] = await db
    .select({ userId: member.userId })
    .from(member)
    .where(and(eq(member.organizationId, orgId), eq(member.userId, userId)))
    .limit(1);
  if (!m) throw new Error('"userId" is not a member of this organization — see list_org_members.');
  const [taken] = await db
    .select({ id: employees.id })
    .from(employees)
    .where(and(eq(employees.organizationId, orgId), eq(employees.userId, userId), isNull(employees.deletedAt)))
    .limit(1);
  if (taken && taken.id !== excludeEmployeeId) {
    throw new Error(`This user is already bound to employee ${taken.id}.`);
  }
}

// update_employee 可搬運的欄位，依取值方式分三組。
// nationalId（加密）與 salaryAccount（轉成帳戶）另外處理，不在這裡。
const EMPLOYEE_STRING_FIELDS = [
  "employmentType",
  "startDate",
  "endDate",
  "workEmail",
  "personalEmail",
  "phone",
  "note",
] as const;
const EMPLOYEE_DECIMAL_FIELDS = [
  "baseSalary",
  "laborInsuredSalary",
  "healthInsuredSalary",
] as const;
const EMPLOYEE_BOOLEAN_FIELDS = [
  "hasLaborInsurance",
  "hasHealthInsurance",
  "hasPension",
  "isActive",
] as const;

/** update_employee 的欄位搬運：只有真的帶進來的欄位才會進 patch（userId 另外處理）。 */
function buildEmployeePatch(args: Record<string, unknown>): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (optString(args, "name") !== undefined) patch.name = requireString(args, "name");
  for (const f of EMPLOYEE_STRING_FIELDS) {
    if (optString(args, f) !== undefined) patch[f] = optString(args, f);
  }
  for (const f of EMPLOYEE_DECIMAL_FIELDS) {
    if (optNumber(args, f) !== undefined) patch[f] = optDecimal(args, f);
  }
  for (const f of EMPLOYEE_BOOLEAN_FIELDS) {
    if (optBoolean(args, f) !== undefined) patch[f] = optBoolean(args, f);
  }
  return patch;
}

/** null / 空字串 = 解除綁定；其他值要先驗證那位使用者可以綁。 */
async function resolveEmployeeUserId(
  args: Record<string, unknown>,
  orgId: string,
  employeeId: number,
): Promise<string | null> {
  const raw = args.userId;
  if (raw === null || raw === "") return null;
  const uid = requireString(args, "userId");
  await checkEmployeeUserBinding(orgId, uid, employeeId);
  return uid;
}

export const hrTools: Record<string, ToolDef> = {
  // ---- employees ----
  list_employees: {
    description:
      "List employees (for payroll records, advances, reimbursements), each with their bank accounts. National ID and account numbers are masked; the full values are only visible to owners/admins in the web app.",
    inputSchema: {
      type: "object",
      properties: { limit: { type: "number", description: "Default 200." }, ...ORG_ARG },
      additionalProperties: false,
    },
    outputSchema: listSchema({
      type: "object",
      properties: { ...EMPLOYEE_PROPS },
      required: EMPLOYEE_REQUIRED,
      additionalProperties: false,
    }),
    execute: async (args, ctx) => {
      const orgId = await resolveOrg(args, ctx);
      const [rows, accounts] = await Promise.all([
        listEmployees(orgId, optNumber(args, "limit") ?? 200),
        listEmployeeAccounts(orgId),
      ]);
      const byEmployee = groupAccountsByEmployee(accounts);
      return listResult(
        await Promise.all(rows.map((e) => redactEmployee(e, byEmployee.get(e.id) ?? []))),
      );
    },
  },

  get_employee: {
    description:
      "Get one employee by id, with their bank accounts. National ID and account numbers are masked; the full values are only visible to owners/admins in the web app.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "number" }, ...ORG_ARG },
      required: ["id"],
      additionalProperties: false,
    },
    // 找不到時回的是 { error }，沒有任何欄位「每次都會出現」，所以不列 required。
    outputSchema: {
      type: "object",
      properties: {
        ...EMPLOYEE_PROPS,
        error: { type: "string", description: "Present instead of the employee when not found." },
      },
      additionalProperties: false,
    },
    execute: async (args, ctx) => {
      const orgId = await resolveOrg(args, ctx);
      const row = await getEmployee(orgId, requireNumber(args, "id"));
      return row ? employeeOut(orgId, row) : { error: "Not found." };
    },
  },

  list_org_members: {
    description:
      "List login users (members) of the organization — for binding an employee to a user via create_employee / update_employee userId. Not every employee has a login; binding is optional.",
    inputSchema: { type: "object", properties: { ...ORG_ARG }, additionalProperties: false },
    outputSchema: listSchema(ORG_MEMBER_ROW),
    execute: async (args, ctx) => listResult(await listOrgMembers(await resolveOrg(args, ctx))),
  },

  create_employee: {
    description:
      "Create an employee (owner/admin only). nationalId is stored encrypted. salaryAccount is deprecated: when given it becomes an encrypted bank account set as the salary default — prefer create_employee_bank_account.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        nationalId: { type: "string", description: "Stored encrypted; returned masked." },
        employmentType: { type: "string", enum: [...EMPLOYMENT_TYPES], description: "Default full_time." },
        baseSalary: { type: "number" },
        laborInsuredSalary: { type: "number" },
        healthInsuredSalary: { type: "number" },
        salaryAccount: {
          type: "string",
          description: "Deprecated: creates a salary-default bank account instead (see create_employee_bank_account).",
        },
        startDate: { type: "string", description: "YYYY-MM-DD." },
        endDate: { type: "string", description: "YYYY-MM-DD." },
        workEmail: { type: "string" },
        personalEmail: { type: "string" },
        phone: { type: "string" },
        note: { type: "string" },
        userId: {
          type: "string",
          description:
            "Optional: bind this employee to a login user (see list_org_members). Most roster-only employees have no binding.",
        },
        hasLaborInsurance: { type: "boolean" },
        hasHealthInsurance: { type: "boolean" },
        hasPension: { type: "boolean" },
        ...ORG_ARG,
      },
      required: ["name"],
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: { ...EMPLOYEE_PROPS },
      required: EMPLOYEE_REQUIRED,
      additionalProperties: false,
    },
    execute: async (args, ctx) => {
      const orgId = await resolveOrg(args, ctx);
      await assertCanManageEmployees(orgId, ctx.userId);
      checkEmploymentType(optString(args, "employmentType"));
      checkEmailArg(args, "workEmail");
      checkEmailArg(args, "personalEmail");
      const laborInsuredSalary = optDecimal(args, "laborInsuredSalary") ?? null;
      const healthInsuredSalary = optDecimal(args, "healthInsuredSalary") ?? null;
      const userId = optString(args, "userId") ?? null;
      if (userId) await checkEmployeeUserBinding(orgId, userId);
      const [row] = await getDb()
        .insert(employees)
        .values({
          organizationId: orgId,
          name: requireString(args, "name"),
          ...(await nationalIdColumns(optString(args, "nationalId"))),
          employmentType: optString(args, "employmentType") ?? "full_time",
          baseSalary: optDecimal(args, "baseSalary") ?? null,
          laborInsuredSalary,
          healthInsuredSalary,
          startDate: optString(args, "startDate") ?? null,
          endDate: optString(args, "endDate") ?? null,
          workEmail: optString(args, "workEmail") ?? null,
          personalEmail: optString(args, "personalEmail") ?? null,
          phone: optString(args, "phone") ?? null,
          note: optString(args, "note") ?? null,
          userId,
          // NOT NULL columns: always pass explicit booleans. Mirror the app —
          // derive from whether insured salary was given; default false.
          hasLaborInsurance: optBoolean(args, "hasLaborInsurance") ?? laborInsuredSalary !== null,
          hasHealthInsurance:
            optBoolean(args, "hasHealthInsurance") ?? healthInsuredSalary !== null,
          hasPension: optBoolean(args, "hasPension") ?? false,
        })
        .returning();
      await salaryAccountArgToAccount(orgId, row.id, row.name, optString(args, "salaryAccount"));
      return employeeOut(orgId, row);
    },
  },

  update_employee: {
    description:
      "Update an employee (owner/admin only; only provided fields). Set isActive=false to mark as left. nationalId is stored encrypted. salaryAccount is deprecated: when given it adds an encrypted bank account and makes it the salary default — prefer the *_employee_bank_account tools.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number" },
        name: { type: "string" },
        nationalId: { type: "string", description: "Stored encrypted; returned masked." },
        employmentType: { type: "string", enum: [...EMPLOYMENT_TYPES] },
        baseSalary: { type: "number" },
        laborInsuredSalary: { type: "number" },
        healthInsuredSalary: { type: "number" },
        salaryAccount: {
          type: "string",
          description: "Deprecated: adds a salary-default bank account instead (see create_employee_bank_account).",
        },
        startDate: { type: "string", description: "YYYY-MM-DD." },
        endDate: { type: "string", description: "YYYY-MM-DD." },
        workEmail: { type: "string" },
        personalEmail: { type: "string" },
        phone: { type: "string" },
        note: { type: "string" },
        userId: {
          type: ["string", "null"],
          description:
            "Bind to a login user (see list_org_members). Pass null to unbind — binding is optional, not 1:1.",
        },
        hasLaborInsurance: { type: "boolean" },
        hasHealthInsurance: { type: "boolean" },
        hasPension: { type: "boolean" },
        isActive: { type: "boolean" },
        ...ORG_ARG,
      },
      required: ["id"],
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: { ...EMPLOYEE_PROPS },
      required: EMPLOYEE_REQUIRED,
      additionalProperties: false,
    },
    execute: async (args, ctx) => {
      const id = requireNumber(args, "id");
      const orgId = await resolveOrg(args, ctx);
      await assertCanManageEmployees(orgId, ctx.userId);
      checkEmploymentType(optString(args, "employmentType"));
      checkEmailArg(args, "workEmail");
      checkEmailArg(args, "personalEmail");
      const patch = buildEmployeePatch(args);
      if ("userId" in args) patch.userId = await resolveEmployeeUserId(args, orgId, id);
      if (optString(args, "nationalId") !== undefined) {
        Object.assign(patch, await nationalIdColumns(optString(args, "nationalId")));
      }
      const salaryAccount = optString(args, "salaryAccount");
      if (Object.keys(patch).length === 0 && salaryAccount === undefined) {
        throw new Error("Nothing to update.");
      }
      const db = getDb();
      await assertInOrg(db, employees, id, orgId, "Employee");
      let row: EmployeeRowIn | undefined;
      if (Object.keys(patch).length > 0) {
        [row] = await db
          .update(employees)
          .set(patch)
          .where(and(eq(employees.organizationId, orgId), eq(employees.id, id)))
          .returning();
      } else {
        row = (await getEmployee(orgId, id)) ?? undefined;
      }
      if (!row) throw new Error(`Employee ${id} not found in your organization.`);
      await salaryAccountArgToAccount(orgId, id, row.name, salaryAccount);
      return employeeOut(orgId, row);
    },
  },

  delete_employee: {
    description:
      "Delete an employee (owner/admin only). Fails if payroll/transactions reference them — deactivate instead.",
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
      const id = requireNumber(args, "id");
      const orgId = await resolveOrg(args, ctx);
      await assertCanManageEmployees(orgId, ctx.userId);
      const db = getDb();
      await assertInOrg(db, employees, id, orgId, "Employee");
      await db
        .update(employees)
        .set({ deletedAt: new Date().toISOString() })
        .where(and(eq(employees.organizationId, orgId), eq(employees.id, id)));
      return { deleted: true, id };
    },
  },

  // ---- payroll ----
  list_payroll_runs: {
    description: "List the payroll runs recorded in the books, with payslip counts and net totals.",
    inputSchema: {
      type: "object",
      properties: { limit: { type: "number", description: "Default 50." }, ...ORG_ARG },
      additionalProperties: false,
    },
    outputSchema: listSchema(PAYROLL_RUN_ROW),
    execute: async (args, ctx) =>
      listResult(await listPayrollRuns(await resolveOrg(args, ctx), optNumber(args, "limit") ?? 50)),
  },

  list_payslips: {
    description: "List recorded payslips with employee, period, pay date, and totals.",
    inputSchema: {
      type: "object",
      properties: { limit: { type: "number", description: "Default 200." }, ...ORG_ARG },
      additionalProperties: false,
    },
    outputSchema: listSchema(PAYSLIP_ROW),
    execute: async (args, ctx) =>
      listResult(
        await listPayslipRecords(await resolveOrg(args, ctx), optNumber(args, "limit") ?? 200),
      ),
  },

  list_salary_status: {
    description:
      "Per-employee salary status for a month, read from the recorded payslips: who is booked as paid, on what date, and the net amount. Defaults to the current month. Answers 'is everyone's salary recorded for this month, and when was it paid'.",
    inputSchema: {
      type: "object",
      properties: {
        periodYear: { type: "number", description: "Defaults to current year." },
        periodMonth: { type: "number", description: "1-12. Defaults to current month." },
        ...ORG_ARG,
      },
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        period: { type: "string", description: "YYYY-MM." },
        runPayDate: {
          type: ["string", "null"],
          description: "YYYY-MM-DD; null when no payroll run exists for the month.",
        },
        paidCount: { type: "number" },
        totalActive: { type: "number" },
        employees: {
          type: "array",
          items: {
            type: "object",
            properties: {
              employeeId: { type: "number" },
              name: { type: "string" },
              paid: { type: "boolean" },
              netPay: {
                type: ["string", "null"],
                // netPay 直接來自 payslips.net_pay（numeric），所以是字串不是數字。
                description: "Decimal as a string; null when there is no payslip yet.",
              },
              payDate: {
                type: ["string", "null"],
                description: "YYYY-MM-DD; null until the salary is actually paid.",
              },
            },
            required: ["employeeId", "name", "paid", "netPay", "payDate"],
            additionalProperties: false,
          },
        },
      },
      required: ["period", "runPayDate", "paidCount", "totalActive", "employees"],
      additionalProperties: false,
    },
    execute: async (args, ctx) => {
      const orgId = await resolveOrg(args, ctx);
      const db = getDb();
      const today = todayStr();
      const year = optNumber(args, "periodYear") ?? Number(today.slice(0, 4));
      const month = optNumber(args, "periodMonth") ?? Number(today.slice(5, 7));
      const [run] = await db
        .select({ id: payrollRuns.id, payDate: payrollRuns.payDate, status: payrollRuns.status })
        .from(payrollRuns)
        .where(
          and(
            eq(payrollRuns.organizationId, orgId),
            eq(payrollRuns.periodYear, year),
            eq(payrollRuns.periodMonth, month),
          ),
        )
        .limit(1);
      const emps = await db
        .select({ id: employees.id, name: employees.name })
        .from(employees)
        .where(
          and(
            eq(employees.organizationId, orgId),
            eq(employees.isActive, true),
            isNull(employees.deletedAt),
          ),
        )
        .orderBy(asc(employees.name));
      const slipByEmp = new Map<
        number,
        { netPay: string; paidTransactionId: number | null }
      >();
      if (run) {
        const slips = await db
          .select({
            employeeId: payslips.employeeId,
            netPay: payslips.netPay,
            paidTransactionId: payslips.paidTransactionId,
          })
          .from(payslips)
          .where(eq(payslips.payrollRunId, run.id));
        for (const s of slips) slipByEmp.set(s.employeeId, s);
      }
      const rows = emps.map((e) => {
        const s = slipByEmp.get(e.id);
        const paid = !!s?.paidTransactionId;
        return {
          employeeId: e.id,
          name: e.name,
          paid,
          netPay: s?.netPay ?? null,
          payDate: paid ? (run?.payDate ?? null) : null,
        };
      });
      return {
        period: `${year}-${String(month).padStart(2, "0")}`,
        runPayDate: run?.payDate ?? null,
        paidCount: rows.filter((r) => r.paid).length,
        totalActive: rows.length,
        employees: rows,
      };
    },
  },

  pay_employee_salary: {
    description:
      "Book one employee's salary for a month: writes the payslip and the matching salary-expense entry in this organization's ledger, exactly as the web app does. Bookkeeping only — it does not pay anyone, initiate a bank transfer, or move money in any way; the salary is paid through the company's own bank and recorded here afterwards. One payslip per employee per month; booking a month that is already booked is rejected. Find ids via list_employees / list_bank_accounts. Amounts are TWD.",
    inputSchema: {
      type: "object",
      properties: {
        employeeId: { type: "number" },
        periodYear: { type: "number" },
        periodMonth: { type: "number", description: "1-12." },
        payDate: { type: "string", description: "The date the salary was paid, YYYY-MM-DD." },
        fromAccountId: {
          type: "number",
          description: "Ledger account the salary expense is booked against.",
        },
        book: {
          type: "string",
          enum: ["both", "internal", "external"],
          description: "Ledger book; default both (reported). Use internal to keep it off the tax books.",
        },
        toEmployeeAccountId: {
          type: "number",
          description:
            "Optional: which of the employee's bank accounts the salary went into (see list_employee_bank_accounts). Defaults to the employee's salary-default account when omitted. Must belong to this employee and be active.",
        },
        items: {
          type: "array",
          description:
            'Salary line items, e.g. [{"name":"底薪","amount":50000}]. Earnings are taxable by default; pass direction:"deduction" for deductions (e.g. 請假扣) and isTaxable:false for non-taxable allowances. Net = taxable + non-taxable − deductions.',
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              amount: { type: "number" },
              direction: { type: "string", enum: ["earning", "deduction"] },
              isTaxable: { type: "boolean" },
            },
            required: ["name", "amount"],
            additionalProperties: false,
          },
        },
        ...ORG_ARG,
      },
      required: ["employeeId", "periodYear", "periodMonth", "payDate", "fromAccountId", "items"],
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        payslipId: { type: "number" },
        payrollRunId: { type: "number" },
        period: { type: "string", description: "YYYY-MM." },
        payDate: { type: "string", description: "YYYY-MM-DD." },
        employeeId: { type: "number" },
        employeeName: { type: ["string", "null"] },
        // 這裡的金額是本地算出來的數字（不是 numeric 欄位讀回來的字串）。
        taxable: { type: "number" },
        nontaxable: { type: "number" },
        deduction: { type: "number" },
        netPay: { type: "number", description: "taxable + nontaxable − deduction, in TWD." },
        book: { type: "string", enum: ["both", "internal", "external"] },
        transactionId: { type: "number", description: "The salary-expense transaction posted." },
        paidToAccount: PAYOUT_ACCOUNT_SCHEMA,
        // 只有找不到「薪資費用」科目時才會出現，所以不列進 required。
        note: { type: "string" },
      },
      required: [
        "payslipId",
        "payrollRunId",
        "period",
        "payDate",
        "employeeId",
        "employeeName",
        "taxable",
        "nontaxable",
        "deduction",
        "netPay",
        "book",
        "transactionId",
        "paidToAccount",
      ],
      additionalProperties: false,
    },
    execute: async (args, ctx) => {
      const employeeId = requireNumber(args, "employeeId");
      const year = requireNumber(args, "periodYear");
      const month = requireNumber(args, "periodMonth");
      if (month < 1 || month > 12) throw new Error('"periodMonth" must be between 1 and 12.');
      const payDate = requireDate(args, "payDate");
      const fromAccountId = requireNumber(args, "fromAccountId");
      const bookRaw = optString(args, "book") ?? "both";
      const book = ["internal", "external", "both"].includes(bookRaw) ? bookRaw : "both";

      const items = parseSalaryItems(args.items);
      if (items.length === 0) throw new Error("No non-zero salary items provided.");

      let taxable = 0;
      let nontaxable = 0;
      let deduction = 0;
      for (const r of items) {
        if (r.direction === "deduction") deduction += r.amount;
        else if (r.isTaxable) taxable += r.amount;
        else nontaxable += r.amount;
      }
      if (taxable + nontaxable <= 0) {
        throw new Error("Provide at least one earning (e.g. base salary).");
      }
      const net = taxable + nontaxable - deduction;

      const orgId = await resolveOrg(args, ctx);
      const db = getDb();
      await assertInOrg(db, employees, employeeId, orgId, "Employee");
      await assertInOrg(db, bankAccounts, fromAccountId, orgId, "Account");
      // 匯入員工的哪個帳戶：有指定就驗歸屬與啟用，沒指定就用薪資預設（可能沒有）。
      const payout = await resolvePayoutAccount(
        orgId,
        employeeId,
        "salary",
        optNumber(args, "toEmployeeAccountId") ?? null,
      );

      // Find or create the month's payroll run.
      let runId: number;
      const [run] = await db
        .select({ id: payrollRuns.id })
        .from(payrollRuns)
        .where(
          and(
            eq(payrollRuns.organizationId, orgId),
            eq(payrollRuns.periodYear, year),
            eq(payrollRuns.periodMonth, month),
          ),
        )
        .limit(1);
      if (run) {
        runId = run.id;
      } else {
        const [created] = await db
          .insert(payrollRuns)
          .values({ organizationId: orgId, periodYear: year, periodMonth: month, payDate, status: "paid" })
          .returning({ id: payrollRuns.id });
        runId = created.id;
      }

      // One payslip per employee per month; block if already paid.
      const [existing] = await db
        .select({ id: payslips.id, paidTransactionId: payslips.paidTransactionId })
        .from(payslips)
        .where(and(eq(payslips.payrollRunId, runId), eq(payslips.employeeId, employeeId)))
        .limit(1);
      if (existing?.paidTransactionId) {
        throw new Error("This employee has already been paid for this month.");
      }

      const [cat] = await db
        .select({ id: categories.id })
        .from(categories)
        .where(and(eq(categories.organizationId, orgId), eq(categories.name, "薪資費用")))
        .limit(1);
      const [emp] = await db
        .select({ name: employees.name })
        .from(employees)
        .where(and(eq(employees.organizationId, orgId), eq(employees.id, employeeId)))
        .limit(1);
      const period = `${year}-${String(month).padStart(2, "0")}`;

      // 薪資固定以 TWD 記帳，所以發薪帳戶也必須是 TWD 帳戶。
      await assertAccountCurrency(db, orgId, "TWD", [fromAccountId]);
      const [txn] = await db
        .insert(transactions)
        .values({
          organizationId: orgId,
          type: "expense",
          txnDate: payDate,
          description: `${period} 薪資 - ${emp?.name ?? ""}`.trim(),
          categoryId: cat?.id ?? null,
          settleEmployeeId: employeeId,
          settleToAccountId: payout?.id ?? null,
          amount: String(net),
          currency: "TWD",
          amountTwd: String(net),
          fromAccountId,
          book,
          billedToCompanyTaxId: false,
        })
        .returning({ id: transactions.id });

      const slipValues = {
        taxableTotal: String(taxable),
        nontaxableTotal: String(nontaxable),
        deductionTotal: String(deduction),
        netPay: String(net),
        paidTransactionId: txn.id,
        paidToAccountId: payout?.id ?? null,
      };
      let payslipId: number;
      if (existing) {
        payslipId = existing.id;
        await db.update(payslips).set(slipValues).where(eq(payslips.id, payslipId));
        await db.delete(payslipItems).where(eq(payslipItems.payslipId, payslipId));
      } else {
        const [ins] = await db
          .insert(payslips)
          .values({ payrollRunId: runId, employeeId, ...slipValues })
          .returning({ id: payslips.id });
        payslipId = ins.id;
      }

      await db.insert(payslipItems).values(
        items.map((r) => ({
          payslipId,
          itemTypeId: r.itemTypeId,
          name: r.name,
          direction: r.direction,
          isTaxable: r.isTaxable,
          amount: String(r.amount),
          hours: null,
        })),
      );

      return {
        payslipId,
        payrollRunId: runId,
        period,
        payDate,
        employeeId,
        employeeName: emp?.name ?? null,
        taxable,
        nontaxable,
        deduction,
        netPay: net,
        book,
        transactionId: txn.id,
        paidToAccount: payoutAccountOutput(payout),
        note: cat?.id ? undefined : "No '薪資費用' category found — the expense was recorded uncategorized.",
      };
    },
  },

  // ---- bank reconciliations ----
  list_reconciliations: {
    description: "List account reconciliations (statement balance vs. computed book balance per date).",
    inputSchema: {
      type: "object",
      properties: { limit: { type: "number", description: "Default 100." }, ...ORG_ARG },
      additionalProperties: false,
    },
    outputSchema: listSchema(RECONCILIATION_LIST_ROW),
    execute: async (args, ctx) =>
      listResult(
        await listReconciliations(await resolveOrg(args, ctx), optNumber(args, "limit") ?? 100),
      ),
  },

  create_reconciliation: {
    description: "Record a statement balance for an account on a date (one per account+date).",
    inputSchema: {
      type: "object",
      properties: {
        accountId: { type: "number", description: "See list_bank_accounts." },
        asOfDate: { type: "string", description: "YYYY-MM-DD." },
        statementBalance: { type: "number" },
        note: { type: "string" },
        ...ORG_ARG,
      },
      required: ["accountId", "asOfDate", "statementBalance"],
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: { ...RECONCILIATION_PROPS },
      required: RECONCILIATION_REQUIRED,
      additionalProperties: false,
    },
    execute: async (args, ctx) => {
      const orgId = await resolveOrg(args, ctx);
      const db = getDb();
      const accountId = requireNumber(args, "accountId");
      await assertInOrg(db, bankAccounts, accountId, orgId, "Account");
      try {
        const [row] = await db
          .insert(accountReconciliations)
          .values({
            organizationId: orgId,
            accountId,
            asOfDate: requireDate(args, "asOfDate"),
            statementBalance: requireDecimal(args, "statementBalance"),
            note: optString(args, "note") ?? null,
          })
          .returning();
        return row;
      } catch (e) {
        throw fkError(e, "A reconciliation for this account and date already exists — update it instead.");
      }
    },
  },

  update_reconciliation: {
    description: "Update a reconciliation (only provided fields).",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number" },
        accountId: { type: "number" },
        asOfDate: { type: "string", description: "YYYY-MM-DD." },
        statementBalance: { type: "number" },
        note: { type: "string" },
        ...ORG_ARG,
      },
      required: ["id"],
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: { ...RECONCILIATION_PROPS },
      required: RECONCILIATION_REQUIRED,
      additionalProperties: false,
    },
    execute: async (args, ctx) => {
      const id = requireNumber(args, "id");
      const orgId = await resolveOrg(args, ctx);
      const db = getDb();
      await assertInOrg(db, accountReconciliations, id, orgId, "Reconciliation");
      const accountId = optNumber(args, "accountId");
      if (accountId !== undefined) await assertInOrg(db, bankAccounts, accountId, orgId, "Account");
      const patch: Record<string, unknown> = {};
      if (accountId !== undefined) patch.accountId = accountId;
      if (optString(args, "asOfDate") !== undefined) patch.asOfDate = requireDate(args, "asOfDate");
      if (optNumber(args, "statementBalance") !== undefined)
        patch.statementBalance = requireDecimal(args, "statementBalance");
      if (optString(args, "note") !== undefined) patch.note = optString(args, "note");
      if (Object.keys(patch).length === 0) throw new Error("Nothing to update.");
      const [row] = await db
        .update(accountReconciliations)
        .set(patch)
        .where(and(eq(accountReconciliations.organizationId, orgId), eq(accountReconciliations.id, id)))
        .returning();
      return row;
    },
  },

  delete_reconciliation: {
    description: "Delete a reconciliation snapshot.",
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
      const id = requireNumber(args, "id");
      const orgId = await resolveOrg(args, ctx);
      const db = getDb();
      await assertInOrg(db, accountReconciliations, id, orgId, "Reconciliation");
      await db
        .update(accountReconciliations)
        .set({ deletedAt: new Date().toISOString() })
        .where(and(eq(accountReconciliations.organizationId, orgId), eq(accountReconciliations.id, id)));
      return { deleted: true, id };
    },
  },

  // ---- accountant notices (paper invoices needing manual notification) ----
  list_accountant_notices: {
    description: "Paper invoices (其他發票) that need to be / have been flagged to the accountant.",
    inputSchema: { type: "object", properties: { ...ORG_ARG }, additionalProperties: false },
    outputSchema: listSchema(ACCOUNTANT_NOTICE_ROW),
    execute: async (args, ctx) =>
      listResult(await listAccountantNotices(await resolveOrg(args, ctx))),
  },

  mark_accountant_notified: {
    description: "Mark a document (paper invoice) as notified to the accountant.",
    inputSchema: {
      type: "object",
      properties: { documentId: { type: "number" }, ...ORG_ARG },
      required: ["documentId"],
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        id: { type: "number" },
        accountantNotifiedAt: { type: "string", description: "ISO 8601 timestamp just written." },
      },
      required: ["id", "accountantNotifiedAt"],
      additionalProperties: false,
    },
    execute: async (args, ctx) => {
      const id = requireNumber(args, "documentId");
      const orgId = await resolveOrg(args, ctx);
      const db = getDb();
      await assertInOrg(db, documents, id, orgId, "Document");
      const [row] = await db
        .update(documents)
        .set({ accountantNotifiedAt: new Date().toISOString() })
        .where(and(eq(documents.organizationId, orgId), eq(documents.id, id)))
        .returning({ id: documents.id, accountantNotifiedAt: documents.accountantNotifiedAt });
      return row;
    },
  },

  unmark_accountant_notified: {
    description: "Clear the accountant-notified flag on a document.",
    inputSchema: {
      type: "object",
      properties: { documentId: { type: "number" }, ...ORG_ARG },
      required: ["documentId"],
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        id: { type: "number" },
        // 這支 tool 的作用就是把旗標清掉，回來的值必定是 null。
        accountantNotifiedAt: { type: "null" },
      },
      required: ["id", "accountantNotifiedAt"],
      additionalProperties: false,
    },
    execute: async (args, ctx) => {
      const id = requireNumber(args, "documentId");
      const orgId = await resolveOrg(args, ctx);
      const db = getDb();
      await assertInOrg(db, documents, id, orgId, "Document");
      const [row] = await db
        .update(documents)
        .set({ accountantNotifiedAt: null })
        .where(and(eq(documents.organizationId, orgId), eq(documents.id, id)))
        .returning({ id: documents.id, accountantNotifiedAt: documents.accountantNotifiedAt });
      return row;
    },
  },
};

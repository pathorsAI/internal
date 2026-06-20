import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { accountReconciliations, bankAccounts, documents, employees } from "@/db/schema";
import {
  getEmployee,
  listAccountantNotices,
  listEmployees,
  listPayrollRuns,
  listPayslipRecords,
  listReconciliations,
} from "@/db/queries";
import {
  assertInOrg,
  fkError,
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
  type ToolDef,
} from "./shared";

const EMPLOYMENT_TYPES = ["full_time", "part_time", "freelancer", "contractor"] as const;

function checkEmploymentType(v: string | undefined) {
  if (v !== undefined && !EMPLOYMENT_TYPES.includes(v as (typeof EMPLOYMENT_TYPES)[number])) {
    throw new Error(`"employmentType" must be one of: ${EMPLOYMENT_TYPES.join(", ")}.`);
  }
}

export const hrTools: Record<string, ToolDef> = {
  // ---- employees ----
  list_employees: {
    description: "List employees (for payroll, advances, reimbursements).",
    inputSchema: {
      type: "object",
      properties: { limit: { type: "number", description: "Default 200." }, ...ORG_ARG },
      additionalProperties: false,
    },
    execute: async (args, ctx) => listEmployees(await resolveOrg(args, ctx), optNumber(args, "limit") ?? 200),
  },

  get_employee: {
    description: "Get one employee by id.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "number" }, ...ORG_ARG },
      required: ["id"],
      additionalProperties: false,
    },
    execute: async (args, ctx) =>
      (await getEmployee(await resolveOrg(args, ctx), requireNumber(args, "id"))) ?? {
        error: "Not found.",
      },
  },

  create_employee: {
    description: "Create an employee.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        nationalId: { type: "string" },
        employmentType: { type: "string", enum: [...EMPLOYMENT_TYPES], description: "Default full_time." },
        baseSalary: { type: "number" },
        laborInsuredSalary: { type: "number" },
        healthInsuredSalary: { type: "number" },
        salaryAccount: { type: "string" },
        startDate: { type: "string", description: "YYYY-MM-DD." },
        endDate: { type: "string", description: "YYYY-MM-DD." },
        hasLaborInsurance: { type: "boolean" },
        hasHealthInsurance: { type: "boolean" },
        hasPension: { type: "boolean" },
        ...ORG_ARG,
      },
      required: ["name"],
      additionalProperties: false,
    },
    execute: async (args, ctx) => {
      const orgId = await resolveOrg(args, ctx);
      checkEmploymentType(optString(args, "employmentType"));
      const laborInsuredSalary = optDecimal(args, "laborInsuredSalary") ?? null;
      const healthInsuredSalary = optDecimal(args, "healthInsuredSalary") ?? null;
      const [row] = await getDb()
        .insert(employees)
        .values({
          organizationId: orgId,
          name: requireString(args, "name"),
          nationalId: optString(args, "nationalId") ?? null,
          employmentType: optString(args, "employmentType") ?? "full_time",
          baseSalary: optDecimal(args, "baseSalary") ?? null,
          laborInsuredSalary,
          healthInsuredSalary,
          salaryAccount: optString(args, "salaryAccount") ?? null,
          startDate: optString(args, "startDate") ?? null,
          endDate: optString(args, "endDate") ?? null,
          // NOT NULL columns: always pass explicit booleans. Mirror the app —
          // derive from whether insured salary was given; default false.
          hasLaborInsurance: optBoolean(args, "hasLaborInsurance") ?? laborInsuredSalary !== null,
          hasHealthInsurance:
            optBoolean(args, "hasHealthInsurance") ?? healthInsuredSalary !== null,
          hasPension: optBoolean(args, "hasPension") ?? false,
        })
        .returning();
      return row;
    },
  },

  update_employee: {
    description: "Update an employee (only provided fields). Set isActive=false to mark as left.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number" },
        name: { type: "string" },
        nationalId: { type: "string" },
        employmentType: { type: "string", enum: [...EMPLOYMENT_TYPES] },
        baseSalary: { type: "number" },
        laborInsuredSalary: { type: "number" },
        healthInsuredSalary: { type: "number" },
        salaryAccount: { type: "string" },
        startDate: { type: "string", description: "YYYY-MM-DD." },
        endDate: { type: "string", description: "YYYY-MM-DD." },
        hasLaborInsurance: { type: "boolean" },
        hasHealthInsurance: { type: "boolean" },
        hasPension: { type: "boolean" },
        isActive: { type: "boolean" },
        ...ORG_ARG,
      },
      required: ["id"],
      additionalProperties: false,
    },
    execute: async (args, ctx) => {
      const id = requireNumber(args, "id");
      const orgId = await resolveOrg(args, ctx);
      checkEmploymentType(optString(args, "employmentType"));
      const patch: Record<string, unknown> = {};
      if (optString(args, "name") !== undefined) patch.name = requireString(args, "name");
      if (optString(args, "nationalId") !== undefined) patch.nationalId = optString(args, "nationalId");
      if (optString(args, "employmentType") !== undefined)
        patch.employmentType = optString(args, "employmentType");
      if (optNumber(args, "baseSalary") !== undefined) patch.baseSalary = optDecimal(args, "baseSalary");
      if (optNumber(args, "laborInsuredSalary") !== undefined)
        patch.laborInsuredSalary = optDecimal(args, "laborInsuredSalary");
      if (optNumber(args, "healthInsuredSalary") !== undefined)
        patch.healthInsuredSalary = optDecimal(args, "healthInsuredSalary");
      if (optString(args, "salaryAccount") !== undefined)
        patch.salaryAccount = optString(args, "salaryAccount");
      if (optString(args, "startDate") !== undefined) patch.startDate = optString(args, "startDate");
      if (optString(args, "endDate") !== undefined) patch.endDate = optString(args, "endDate");
      if (optBoolean(args, "hasLaborInsurance") !== undefined)
        patch.hasLaborInsurance = optBoolean(args, "hasLaborInsurance");
      if (optBoolean(args, "hasHealthInsurance") !== undefined)
        patch.hasHealthInsurance = optBoolean(args, "hasHealthInsurance");
      if (optBoolean(args, "hasPension") !== undefined) patch.hasPension = optBoolean(args, "hasPension");
      if (optBoolean(args, "isActive") !== undefined) patch.isActive = optBoolean(args, "isActive");
      if (Object.keys(patch).length === 0) throw new Error("Nothing to update.");
      const [row] = await getDb()
        .update(employees)
        .set(patch)
        .where(and(eq(employees.organizationId, orgId), eq(employees.id, id)))
        .returning();
      if (!row) throw new Error(`Employee ${id} not found in your organization.`);
      return row;
    },
  },

  delete_employee: {
    description: "Delete an employee. Fails if payroll/transactions reference them — deactivate instead.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "number" }, ...ORG_ARG },
      required: ["id"],
      additionalProperties: false,
    },
    execute: async (args, ctx) => {
      const id = requireNumber(args, "id");
      const orgId = await resolveOrg(args, ctx);
      const db = getDb();
      await assertInOrg(db, employees, id, orgId, "Employee");
      try {
        await db.delete(employees).where(and(eq(employees.organizationId, orgId), eq(employees.id, id)));
        return { deleted: true, id };
      } catch (e) {
        throw fkError(
          e,
          "This employee has payroll or transaction records and can't be deleted. Deactivate instead (update_employee isActive=false).",
        );
      }
    },
  },

  // ---- payroll (read-only; payroll runs/payslips are created in the app) ----
  list_payroll_runs: {
    description: "List payroll runs with payslip counts and net totals.",
    inputSchema: {
      type: "object",
      properties: { limit: { type: "number", description: "Default 50." }, ...ORG_ARG },
      additionalProperties: false,
    },
    execute: async (args, ctx) => listPayrollRuns(await resolveOrg(args, ctx), optNumber(args, "limit") ?? 50),
  },

  list_payslips: {
    description: "List payslips with employee, period, pay date, and totals.",
    inputSchema: {
      type: "object",
      properties: { limit: { type: "number", description: "Default 200." }, ...ORG_ARG },
      additionalProperties: false,
    },
    execute: async (args, ctx) => listPayslipRecords(await resolveOrg(args, ctx), optNumber(args, "limit") ?? 200),
  },

  // ---- bank reconciliations ----
  list_reconciliations: {
    description: "List account reconciliations (statement balance vs. computed book balance per date).",
    inputSchema: {
      type: "object",
      properties: { limit: { type: "number", description: "Default 100." }, ...ORG_ARG },
      additionalProperties: false,
    },
    execute: async (args, ctx) => listReconciliations(await resolveOrg(args, ctx), optNumber(args, "limit") ?? 100),
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
    execute: async (args, ctx) => {
      const id = requireNumber(args, "id");
      const orgId = await resolveOrg(args, ctx);
      const db = getDb();
      await assertInOrg(db, accountReconciliations, id, orgId, "Reconciliation");
      await db
        .delete(accountReconciliations)
        .where(and(eq(accountReconciliations.organizationId, orgId), eq(accountReconciliations.id, id)));
      return { deleted: true, id };
    },
  },

  // ---- accountant notices (paper invoices needing manual notification) ----
  list_accountant_notices: {
    description: "Paper invoices (其他發票) that need to be / have been flagged to the accountant.",
    inputSchema: { type: "object", properties: { ...ORG_ARG }, additionalProperties: false },
    execute: async (args, ctx) => listAccountantNotices(await resolveOrg(args, ctx)),
  },

  mark_accountant_notified: {
    description: "Mark a document (paper invoice) as notified to the accountant.",
    inputSchema: {
      type: "object",
      properties: { documentId: { type: "number" }, ...ORG_ARG },
      required: ["documentId"],
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

import { and, asc, eq } from "drizzle-orm";
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
  todayStr,
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

  // ---- payroll ----
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

  list_salary_status: {
    description:
      "Per-employee salary status for a month: who has been paid, on what date, and the net amount. Defaults to the current month. Answers 'did everyone get paid this month, and when'.",
    inputSchema: {
      type: "object",
      properties: {
        periodYear: { type: "number", description: "Defaults to current year." },
        periodMonth: { type: "number", description: "1-12. Defaults to current month." },
        ...ORG_ARG,
      },
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
        .where(and(eq(employees.organizationId, orgId), eq(employees.isActive, true)))
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
      "Record a salary payment for one employee for a month. Creates the payslip AND posts a salary-expense transaction to the ledger (same as the app). One payment per employee per month — re-paying an already-paid month is rejected. Find ids via list_employees / list_bank_accounts. Amounts are TWD.",
    inputSchema: {
      type: "object",
      properties: {
        employeeId: { type: "number" },
        periodYear: { type: "number" },
        periodMonth: { type: "number", description: "1-12." },
        payDate: { type: "string", description: "Pay date, YYYY-MM-DD." },
        fromAccountId: { type: "number", description: "Account the salary is paid from." },
        book: {
          type: "string",
          enum: ["both", "internal", "external"],
          description: "Ledger book; default both (reported). Use internal to keep it off the tax books.",
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
    execute: async (args, ctx) => {
      const employeeId = requireNumber(args, "employeeId");
      const year = requireNumber(args, "periodYear");
      const month = requireNumber(args, "periodMonth");
      if (month < 1 || month > 12) throw new Error('"periodMonth" must be between 1 and 12.');
      const payDate = requireDate(args, "payDate");
      const fromAccountId = requireNumber(args, "fromAccountId");
      const bookRaw = optString(args, "book") ?? "both";
      const book = ["internal", "external", "both"].includes(bookRaw) ? bookRaw : "both";

      const raw = args.items;
      if (!Array.isArray(raw) || raw.length === 0) {
        throw new Error('"items" must be a non-empty array of salary line items.');
      }
      const items = raw
        .map((r, i) => {
          const o = (r ?? {}) as Record<string, unknown>;
          const name = typeof o.name === "string" ? o.name.trim() : "";
          const amount = typeof o.amount === "number" ? o.amount : Number(o.amount);
          if (!name) throw new Error(`items[${i}].name is required.`);
          if (!Number.isFinite(amount)) throw new Error(`items[${i}].amount must be a number.`);
          const direction = o.direction === "deduction" ? "deduction" : "earning";
          const isTaxable =
            direction === "deduction" ? false : o.isTaxable === undefined ? true : !!o.isTaxable;
          return {
            itemTypeId: typeof o.itemTypeId === "number" ? o.itemTypeId : null,
            name,
            direction,
            isTaxable,
            amount,
          };
        })
        .filter((r) => r.amount !== 0);
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
        try {
          const [created] = await db
            .insert(payrollRuns)
            .values({ organizationId: orgId, periodYear: year, periodMonth: month, payDate, status: "paid" })
            .returning({ id: payrollRuns.id });
          runId = created.id;
        } catch (e) {
          // neon-http has no interactive transactions, so the select-then-insert
          // above isn't atomic: a concurrent first call for the same org+month
          // can win the unique (uq_run_period) race. Recover by re-selecting.
          const err = e as { code?: string; cause?: { code?: string } };
          if (err?.code !== "23505" && err?.cause?.code !== "23505") throw e;
          const [existing] = await db
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
          if (!existing) throw e;
          runId = existing.id;
        }
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

      const [txn] = await db
        .insert(transactions)
        .values({
          organizationId: orgId,
          type: "expense",
          txnDate: payDate,
          description: `${period} 薪資 - ${emp?.name ?? ""}`.trim(),
          categoryId: cat?.id ?? null,
          settleEmployeeId: employeeId,
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

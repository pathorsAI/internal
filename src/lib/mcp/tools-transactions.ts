import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import {
  bankAccounts,
  categories,
  documents,
  employees,
  parties,
  payslips,
  projects,
  transactions,
} from "@/db/schema";
import {
  getOverview,
  getTransaction,
  listOutstandingAdvances,
  listTransactions,
} from "@/db/queries";
import { deleteDocument } from "@/lib/storage";
import {
  assertInOrg,
  fkError,
  normalizeCurrency,
  optBoolean,
  optDate,
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

const TXN_TYPES = ["expense", "income", "advance", "transfer"] as const;
const BOOKS = ["both", "internal", "external"] as const;

type Db = ReturnType<typeof getDb>;

async function getOrCreateParty(
  db: Db,
  orgId: string,
  name: string,
  label: string,
): Promise<number> {
  const found = await db
    .select({ id: parties.id })
    .from(parties)
    .where(and(eq(parties.organizationId, orgId), eq(parties.name, name)))
    .limit(1);
  if (found.length) return found[0].id;
  const [created] = await db
    .insert(parties)
    .values({ organizationId: orgId, name, label })
    .returning({ id: parties.id });
  return created.id;
}

async function getOrCreateEmployee(db: Db, orgId: string, name: string): Promise<number> {
  const found = await db
    .select({ id: employees.id })
    .from(employees)
    .where(and(eq(employees.organizationId, orgId), eq(employees.name, name)))
    .limit(1);
  if (found.length) return found[0].id;
  const [created] = await db
    .insert(employees)
    .values({ organizationId: orgId, name })
    .returning({ id: employees.id });
  return created.id;
}

type TxnFields = {
  fromAccountId: number | null;
  toAccountId: number | null;
  categoryId: number | null;
  partyId: number | null;
  settleEmployeeId: number | null;
};

// Mirrors mutations.ts resolveTxnFields, with org-scoped FK validation.
async function resolveTxnFields(
  db: Db,
  orgId: string,
  type: string,
  args: Record<string, unknown>,
): Promise<TxnFields> {
  const blank: TxnFields = {
    fromAccountId: null,
    toAccountId: null,
    categoryId: null,
    partyId: null,
    settleEmployeeId: null,
  };
  if (type === "expense" || type === "income") {
    const isIncome = type === "income";
    const accountId = requireNumber(args, "accountId");
    await assertInOrg(db, bankAccounts, accountId, orgId, "Account");
    const categoryId = requireNumber(args, "categoryId");
    await assertInOrg(db, categories, categoryId, orgId, "Category");
    const partyId = await getOrCreateParty(
      db,
      orgId,
      requireString(args, "partyName"),
      isIncome ? "customer" : "vendor",
    );
    return {
      ...blank,
      categoryId,
      partyId,
      fromAccountId: isIncome ? null : accountId,
      toAccountId: isIncome ? accountId : null,
    };
  }
  if (type === "advance") {
    const categoryId = requireNumber(args, "categoryId");
    await assertInOrg(db, categories, categoryId, orgId, "Category");
    return {
      ...blank,
      categoryId,
      partyId: await getOrCreateParty(db, orgId, requireString(args, "partyName"), "vendor"),
      settleEmployeeId: await getOrCreateEmployee(
        db,
        orgId,
        requireString(args, "settleEmployeeName"),
      ),
    };
  }
  if (type === "transfer") {
    const fromAccountId = requireNumber(args, "fromAccountId");
    const toAccountId = requireNumber(args, "toAccountId");
    await assertInOrg(db, bankAccounts, fromAccountId, orgId, "From account");
    await assertInOrg(db, bankAccounts, toAccountId, orgId, "To account");
    return { ...blank, fromAccountId, toAccountId };
  }
  throw new Error(`Unsupported transaction type "${type}".`);
}

async function optProjectId(
  db: Db,
  args: Record<string, unknown>,
  orgId: string,
): Promise<number | undefined> {
  const projectId = optNumber(args, "projectId");
  if (projectId !== undefined) await assertInOrg(db, projects, projectId, orgId, "Project");
  return projectId;
}

export const transactionTools: Record<string, ToolDef> = {
  list_transactions: {
    description:
      "List ledger transactions (內外帳), newest first. Optional filters: book, categoryId, accountId, projectId, period (YYYY-MM).",
    inputSchema: {
      type: "object",
      properties: {
        book: { type: "string", enum: [...BOOKS] },
        categoryId: { type: "number" },
        accountId: { type: "number", description: "Matches from OR to account." },
        projectId: { type: "number" },
        period: { type: "string", description: "Month filter, YYYY-MM." },
        limit: { type: "number", description: "Default 100." },
        ...ORG_ARG,
      },
      additionalProperties: false,
    },
    execute: async (args, ctx) => {
      const orgId = await resolveOrg(args, ctx);
      const filters = {
        book: optString(args, "book") as "internal" | "external" | "both" | undefined,
        categoryId: optNumber(args, "categoryId"),
        accountId: optNumber(args, "accountId"),
        projectId: optNumber(args, "projectId"),
        period: optString(args, "period"),
      };
      const db = getDb();
      if (filters.categoryId !== undefined)
        await assertInOrg(db, categories, filters.categoryId, orgId, "Category");
      if (filters.accountId !== undefined)
        await assertInOrg(db, bankAccounts, filters.accountId, orgId, "Account");
      if (filters.projectId !== undefined)
        await assertInOrg(db, projects, filters.projectId, orgId, "Project");
      return listTransactions(orgId, filters, optNumber(args, "limit") ?? 100);
    },
  },

  get_transaction: {
    description: "Get one transaction by id.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "number" }, ...ORG_ARG },
      required: ["id"],
      additionalProperties: false,
    },
    execute: async (args, ctx) =>
      (await getTransaction(await resolveOrg(args, ctx), requireNumber(args, "id"))) ?? {
        error: "Not found.",
      },
  },

  get_financial_overview: {
    description: "Income/expense/net totals grouped by currency for the organization.",
    inputSchema: { type: "object", properties: { ...ORG_ARG }, additionalProperties: false },
    execute: async (args, ctx) => getOverview(await resolveOrg(args, ctx)),
  },

  list_outstanding_advances: {
    description: "Employee cash advances (代墊) not yet reimbursed. Settle with create_reimbursement.",
    inputSchema: { type: "object", properties: { ...ORG_ARG }, additionalProperties: false },
    execute: async (args, ctx) => listOutstandingAdvances(await resolveOrg(args, ctx)),
  },

  create_transaction: {
    description:
      "Record a ledger transaction. Required per type — expense/income: accountId + partyName + categoryId; advance: partyName + categoryId + settleEmployeeName (no account); transfer: fromAccountId + toAccountId. Resolve ids with list_bank_accounts / list_categories / list_parties first. 'reported' (報稅/上外帳) sets the book to 'both', otherwise 'internal' (transfers are always 'both'). Invoice/統編 attachment must be done in the app. To reimburse an advance use create_reimbursement.",
    inputSchema: {
      type: "object",
      properties: {
        type: { type: "string", enum: [...TXN_TYPES] },
        txnDate: { type: "string", description: "YYYY-MM-DD." },
        amount: { type: "number" },
        currency: { type: "string", description: "3-letter; default TWD." },
        description: { type: "string" },
        reported: { type: "boolean", description: "Reported to tax (book=both). Default false." },
        accountId: { type: "number", description: "expense=paying acct, income=receiving acct." },
        partyName: { type: "string", description: "Vendor/customer; created if new." },
        categoryId: { type: "number" },
        settleEmployeeName: { type: "string", description: "For advance; employee created if new." },
        fromAccountId: { type: "number", description: "For transfer." },
        toAccountId: { type: "number", description: "For transfer." },
        projectId: { type: "number", description: "Optional project tag." },
        ...ORG_ARG,
      },
      required: ["type", "txnDate", "amount"],
      additionalProperties: false,
    },
    execute: async (args, ctx) => {
      const type = requireString(args, "type");
      if (!TXN_TYPES.includes(type as (typeof TXN_TYPES)[number])) {
        throw new Error(`"type" must be one of: ${TXN_TYPES.join(", ")}.`);
      }
      const orgId = await resolveOrg(args, ctx);
      const db = getDb();
      const f = await resolveTxnFields(db, orgId, type, args);
      const projectId = await optProjectId(db, args, orgId);
      const amount = requireDecimal(args, "amount");
      const currency = normalizeCurrency(args, "currency");
      const reported = type === "transfer" || optBoolean(args, "reported") === true;
      const [row] = await db
        .insert(transactions)
        .values({
          organizationId: orgId,
          type,
          txnDate: requireDate(args, "txnDate"),
          description: optString(args, "description") ?? null,
          categoryId: f.categoryId,
          partyId: f.partyId,
          settleEmployeeId: f.settleEmployeeId,
          projectId: projectId ?? null,
          amount,
          currency,
          amountTwd: currency === "TWD" ? amount : null,
          fromAccountId: f.fromAccountId,
          toAccountId: f.toAccountId,
          book: reported ? "both" : "internal",
          billedToCompanyTaxId: false,
        })
        .returning();
      return row;
    },
  },

  update_transaction: {
    description:
      "Edit a transaction's date, amount, currency, description, category, project, or reported flag (only provided fields change). To change the account or counterparty, delete and recreate, or use the app.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number" },
        txnDate: { type: "string", description: "YYYY-MM-DD." },
        amount: { type: "number" },
        currency: { type: "string" },
        description: { type: "string" },
        categoryId: { type: "number" },
        projectId: { type: "number" },
        reported: { type: "boolean" },
        ...ORG_ARG,
      },
      required: ["id"],
      additionalProperties: false,
    },
    execute: async (args, ctx) => {
      const id = requireNumber(args, "id");
      const orgId = await resolveOrg(args, ctx);
      const db = getDb();
      const [existing] = await db
        .select({
          type: transactions.type,
          amount: transactions.amount,
          currency: transactions.currency,
        })
        .from(transactions)
        .where(and(eq(transactions.organizationId, orgId), eq(transactions.id, id)))
        .limit(1);
      if (!existing) throw new Error(`Transaction ${id} not found in your organization.`);

      const patch: Record<string, unknown> = { updatedAt: new Date().toISOString() };
      if (optDate(args, "txnDate") !== undefined) patch.txnDate = optDate(args, "txnDate");
      if (optString(args, "description") !== undefined)
        patch.description = optString(args, "description");
      if (optNumber(args, "categoryId") !== undefined) {
        const categoryId = requireNumber(args, "categoryId");
        await assertInOrg(db, categories, categoryId, orgId, "Category");
        patch.categoryId = categoryId;
      }
      if (optNumber(args, "projectId") !== undefined) {
        patch.projectId = await optProjectId(db, args, orgId);
      }
      const amountProvided = optNumber(args, "amount") !== undefined;
      const currencyProvided = optString(args, "currency") !== undefined;
      if (amountProvided || currencyProvided) {
        const amount = amountProvided ? requireDecimal(args, "amount") : existing.amount;
        const currency = currencyProvided ? normalizeCurrency(args, "currency") : existing.currency;
        patch.amount = amount;
        patch.currency = currency;
        patch.amountTwd = currency === "TWD" ? amount : null;
      }
      if (optBoolean(args, "reported") !== undefined) {
        patch.book =
          existing.type === "transfer" || optBoolean(args, "reported") ? "both" : "internal";
      }
      const [row] = await db
        .update(transactions)
        .set(patch)
        .where(and(eq(transactions.organizationId, orgId), eq(transactions.id, id)))
        .returning();
      return row;
    },
  },

  delete_transaction: {
    description:
      "Delete a transaction (and its attachments). Fails for payroll-generated transactions (use payroll), or advances that already have a reimbursement (delete the reimbursement first).",
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
      const [owned] = await db
        .select({ id: transactions.id })
        .from(transactions)
        .where(and(eq(transactions.organizationId, orgId), eq(transactions.id, id)))
        .limit(1);
      if (!owned) throw new Error(`Transaction ${id} not found in your organization.`);

      const [slip] = await db
        .select({ id: payslips.id })
        .from(payslips)
        .where(eq(payslips.paidTransactionId, id))
        .limit(1);
      if (slip) {
        throw new Error(
          "This is a payroll-generated transaction; revoke the payment from the payroll screen instead.",
        );
      }

      const docs = await db
        .select({ r2Key: documents.r2Key })
        .from(documents)
        .where(eq(documents.transactionId, id));
      for (const d of docs) {
        if (d.r2Key && !d.r2Key.startsWith("meta/")) await deleteDocument(d.r2Key);
      }
      if (docs.length > 0) {
        await db.delete(documents).where(eq(documents.transactionId, id));
      }
      try {
        await db
          .delete(transactions)
          .where(and(eq(transactions.organizationId, orgId), eq(transactions.id, id)));
        return { deleted: true, id };
      } catch (e) {
        throw fkError(
          e,
          "This transaction is linked from another record (e.g. an advance that already has a reimbursement); resolve that first.",
        );
      }
    },
  },

  create_reimbursement: {
    description:
      "Pay back an employee advance: creates a reimbursement transaction linked to the advance. Find the advance via list_outstanding_advances.",
    inputSchema: {
      type: "object",
      properties: {
        advanceId: { type: "number", description: "The advance transaction id." },
        fromAccountId: { type: "number", description: "Account paying the employee." },
        payDate: { type: "string", description: "YYYY-MM-DD." },
        amount: { type: "number" },
        ...ORG_ARG,
      },
      required: ["advanceId", "fromAccountId", "payDate", "amount"],
      additionalProperties: false,
    },
    execute: async (args, ctx) => {
      const advanceId = requireNumber(args, "advanceId");
      const fromAccountId = requireNumber(args, "fromAccountId");
      const payDate = requireDate(args, "payDate");
      const amount = requireDecimal(args, "amount");
      const orgId = await resolveOrg(args, ctx);
      const db = getDb();
      await assertInOrg(db, bankAccounts, fromAccountId, orgId, "Account");
      const [adv] = await db
        .select({
          settleEmployeeId: transactions.settleEmployeeId,
          currency: transactions.currency,
          type: transactions.type,
        })
        .from(transactions)
        .where(and(eq(transactions.organizationId, orgId), eq(transactions.id, advanceId)))
        .limit(1);
      if (!adv) throw new Error(`Advance ${advanceId} not found in your organization.`);
      if (adv.type !== "advance") {
        throw new Error(`Transaction ${advanceId} is not an advance (type=${adv.type}).`);
      }
      const currency = adv.currency ?? "TWD";
      const [row] = await db
        .insert(transactions)
        .values({
          organizationId: orgId,
          type: "reimbursement",
          txnDate: payDate,
          settleEmployeeId: adv.settleEmployeeId,
          amount,
          currency,
          amountTwd: currency === "TWD" ? amount : null,
          fromAccountId,
          book: "internal",
          relatedToId: advanceId,
          description: "撥款還代墊",
        })
        .returning();
      return row;
    },
  },
};

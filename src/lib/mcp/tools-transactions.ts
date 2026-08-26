import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import {
  bankAccounts,
  categories,
  contracts,
  documents,
  employees,
  parties,
  payslips,
  projects,
  subscriptions,
  transactions,
} from "@/db/schema";
import {
  getOverview,
  getTransaction,
  listOutstandingAdvances,
  listTransactions,
} from "@/db/queries";
import {
  assertInOrg,
  getContractProgress,
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
import {
  assertAccountCurrency,
  findMismatchInMap,
  accountCurrencyErrorMessage,
  type AccountCurrencyRef,
} from "@/lib/account-currency";

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

// Resolve many party names to ids in two round trips (one select + one insert),
// creating any that don't exist yet. Used by bulk_create_transactions to avoid
// a getOrCreateParty round trip per row. `labelByName` carries the label to use
// when a name has to be created (income → customer, expense/advance → vendor).
async function resolvePartyNames(
  db: Db,
  orgId: string,
  labelByName: Map<string, string>,
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  const names = [...labelByName.keys()];
  if (names.length === 0) return map;
  const existing = await db
    .select({ id: parties.id, name: parties.name })
    .from(parties)
    .where(and(eq(parties.organizationId, orgId), inArray(parties.name, names)));
  for (const r of existing) map.set(r.name, r.id);
  const missing = names.filter((n) => !map.has(n));
  if (missing.length) {
    const created = await db
      .insert(parties)
      .values(missing.map((name) => ({ organizationId: orgId, name, label: labelByName.get(name)! })))
      .returning({ id: parties.id, name: parties.name });
    for (const r of created) map.set(r.name, r.id);
  }
  return map;
}

async function resolveEmployeeNames(
  db: Db,
  orgId: string,
  names: Set<string>,
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  const list = [...names];
  if (list.length === 0) return map;
  const existing = await db
    .select({ id: employees.id, name: employees.name })
    .from(employees)
    .where(and(eq(employees.organizationId, orgId), inArray(employees.name, list)));
  for (const r of existing) map.set(r.name, r.id);
  const missing = list.filter((n) => !map.has(n));
  if (missing.length) {
    const created = await db
      .insert(employees)
      .values(missing.map((name) => ({ organizationId: orgId, name })))
      .returning({ id: employees.id, name: employees.name });
    for (const r of created) map.set(r.name, r.id);
  }
  return map;
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
    const categoryId = optNumber(args, "categoryId") ?? null; // 可省略＝未分類
    if (categoryId !== null) await assertInOrg(db, categories, categoryId, orgId, "Category");
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
    const categoryId = optNumber(args, "categoryId") ?? null; // 可省略＝未分類
    if (categoryId !== null) await assertInOrg(db, categories, categoryId, orgId, "Category");
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

async function optContractId(
  db: Db,
  args: Record<string, unknown>,
  orgId: string,
): Promise<number | undefined> {
  const contractId = optNumber(args, "contractId");
  if (contractId !== undefined) await assertInOrg(db, contracts, contractId, orgId, "Contract");
  return contractId;
}

async function optSubscriptionId(
  db: Db,
  args: Record<string, unknown>,
  orgId: string,
): Promise<number | undefined> {
  const subscriptionId = optNumber(args, "subscriptionId");
  if (subscriptionId !== undefined)
    await assertInOrg(db, subscriptions, subscriptionId, orgId, "Subscription");
  return subscriptionId;
}

// ---- bulk_create_transactions helpers ----

type Norm = {
  type: string;
  txnDate: string;
  amount: string;
  currency: string;
  description: string | null;
  reported: boolean;
  projectId: number | null;
  contractId: number | null;
  subscriptionId: number | null;
  subscriptionPeriod: string | null;
  categoryId: number | null;
  fromAccountId: number | null;
  toAccountId: number | null;
  partyName: string | null;
  settleEmployeeName: string | null;
  billedToCompanyTaxId: boolean;
};

type BulkTxnSets = {
  acctSet: Set<number>;
  catSet: Set<number>;
  projSet: Set<number>;
  contractSet: Set<number>;
  subscriptionSet: Set<number>;
};

// A nullable FK, when present, must belong to the org's known ids.
function assertOrgRef(id: number | null, set: Set<number>, at: string, field: string) {
  if (id !== null && !set.has(id)) {
    throw new Error(`${at}.${field} ${id} not found in your organization.`);
  }
}

function fillIncomeExpense(
  n: Norm,
  it: Record<string, unknown>,
  at: string,
  acctSet: Set<number>,
  catSet: Set<number>,
  partyLabelByName: Map<string, string>,
) {
  const isIncome = n.type === "income";
  const accountId = requireNumber(it, "accountId");
  if (!acctSet.has(accountId)) {
    throw new Error(`${at}.accountId ${accountId} not found in your organization.`);
  }
  const categoryId = optNumber(it, "categoryId") ?? null; // 可省略＝未分類
  if (categoryId !== null && !catSet.has(categoryId)) {
    throw new Error(`${at}.categoryId ${categoryId} not found in your organization.`);
  }
  const partyName = requireString(it, "partyName");
  if (!partyLabelByName.has(partyName)) {
    partyLabelByName.set(partyName, isIncome ? "customer" : "vendor");
  }
  n.categoryId = categoryId;
  n.partyName = partyName;
  n.fromAccountId = isIncome ? null : accountId;
  n.toAccountId = isIncome ? accountId : null;
}

function fillAdvance(
  n: Norm,
  it: Record<string, unknown>,
  at: string,
  catSet: Set<number>,
  partyLabelByName: Map<string, string>,
  employeeNames: Set<string>,
) {
  const categoryId = optNumber(it, "categoryId") ?? null; // 可省略＝未分類
  if (categoryId !== null && !catSet.has(categoryId)) {
    throw new Error(`${at}.categoryId ${categoryId} not found in your organization.`);
  }
  const partyName = requireString(it, "partyName");
  if (!partyLabelByName.has(partyName)) partyLabelByName.set(partyName, "vendor");
  const emp = requireString(it, "settleEmployeeName");
  employeeNames.add(emp);
  n.categoryId = categoryId;
  n.partyName = partyName;
  n.settleEmployeeName = emp;
}

function fillTransfer(n: Norm, it: Record<string, unknown>, at: string, acctSet: Set<number>) {
  const fromAccountId = requireNumber(it, "fromAccountId");
  const toAccountId = requireNumber(it, "toAccountId");
  if (!acctSet.has(fromAccountId)) {
    throw new Error(`${at}.fromAccountId ${fromAccountId} not found in your organization.`);
  }
  if (!acctSet.has(toAccountId)) {
    throw new Error(`${at}.toAccountId ${toAccountId} not found in your organization.`);
  }
  n.fromAccountId = fromAccountId;
  n.toAccountId = toAccountId;
}

// Validate one raw bulk item and normalize it; accumulates party/employee names
// so they can be resolved to ids in a single round trip afterwards.
function normalizeBulkTxnItem(
  raw: unknown,
  i: number,
  sets: BulkTxnSets,
  partyLabelByName: Map<string, string>,
  employeeNames: Set<string>,
): Norm {
  if (typeof raw !== "object" || raw === null) {
    throw new Error(`items[${i}] must be an object.`);
  }
  const it = raw as Record<string, unknown>;
  const at = `items[${i}]`;
  const type = requireString(it, "type");
  if (!TXN_TYPES.includes(type as (typeof TXN_TYPES)[number])) {
    throw new Error(`${at}.type must be one of: ${TXN_TYPES.join(", ")}.`);
  }
  const projectId = optNumber(it, "projectId") ?? null;
  assertOrgRef(projectId, sets.projSet, at, "projectId");
  const contractId = optNumber(it, "contractId") ?? null;
  assertOrgRef(contractId, sets.contractSet, at, "contractId");
  const subscriptionId = optNumber(it, "subscriptionId") ?? null;
  assertOrgRef(subscriptionId, sets.subscriptionSet, at, "subscriptionId");
  const subscriptionPeriod = optDate(it, "subscriptionPeriod") ?? null;
  if (subscriptionId !== null && subscriptionPeriod === null) {
    throw new Error(`${at}.subscriptionPeriod (YYYY-MM-DD) is required when subscriptionId is set.`);
  }
  const n: Norm = {
    type,
    txnDate: requireDate(it, "txnDate"),
    amount: requireDecimal(it, "amount"),
    currency: normalizeCurrency(it, "currency"),
    description: optString(it, "description") ?? null,
    reported: type === "transfer" || optBoolean(it, "reported") === true,
    projectId,
    contractId,
    subscriptionId,
    subscriptionPeriod,
    categoryId: null,
    fromAccountId: null,
    toAccountId: null,
    partyName: null,
    settleEmployeeName: null,
    billedToCompanyTaxId: optBoolean(it, "billedToCompanyTaxId") === true,
  };
  if (type === "expense" || type === "income") {
    fillIncomeExpense(n, it, at, sets.acctSet, sets.catSet, partyLabelByName);
  } else if (type === "advance") {
    fillAdvance(n, it, at, sets.catSet, partyLabelByName, employeeNames);
  } else if (type === "transfer") {
    fillTransfer(n, it, at, sets.acctSet);
  }
  return n;
}

// ---- update_transaction helpers ----

// Apply the relation fields (category / project / contract / subscription) to
// the patch. Each is only touched when its arg was provided; 0 clears the link.
async function applyTxnRelationPatch(
  patch: Record<string, unknown>,
  db: Db,
  args: Record<string, unknown>,
  orgId: string,
) {
  if (optNumber(args, "categoryId") !== undefined) {
    const categoryId = requireNumber(args, "categoryId");
    if (categoryId === 0) {
      patch.categoryId = null; // 0＝清除分類（未分類）
    } else {
      await assertInOrg(db, categories, categoryId, orgId, "Category");
      patch.categoryId = categoryId;
    }
  }
  if (optNumber(args, "projectId") !== undefined) {
    patch.projectId = await optProjectId(db, args, orgId);
  }
  if (optNumber(args, "contractId") !== undefined) {
    const contractId = requireNumber(args, "contractId");
    if (contractId === 0) {
      patch.contractId = null;
    } else {
      await assertInOrg(db, contracts, contractId, orgId, "Contract");
      patch.contractId = contractId;
    }
  }
  if (optNumber(args, "subscriptionId") !== undefined) {
    const subscriptionId = requireNumber(args, "subscriptionId");
    if (subscriptionId === 0) {
      // 解除訂閱綁定時，期別一併清空。
      patch.subscriptionId = null;
      patch.subscriptionPeriod = null;
    } else {
      await assertInOrg(db, subscriptions, subscriptionId, orgId, "Subscription");
      patch.subscriptionId = subscriptionId;
    }
  }
  // 期別：空字串代表清除；未提供則不動。只有在沒有因 subscriptionId=0 清空時才處理。
  if (args.subscriptionPeriod !== undefined && patch.subscriptionPeriod === undefined) {
    patch.subscriptionPeriod = optDate(args, "subscriptionPeriod") ?? null;
  }
}

// Apply amount/currency and the reported→book flag to the patch, falling back to
// the existing row's values when only one of amount/currency is supplied.
function applyTxnAmountPatch(
  patch: Record<string, unknown>,
  args: Record<string, unknown>,
  existing: { type: string; amount: string; currency: string },
) {
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
      "Record a ledger transaction. Required per type — expense/income: accountId + partyName; advance: partyName + settleEmployeeName (no account); transfer: fromAccountId + toAccountId. categoryId is OPTIONAL — omit it to leave the txn 未分類 (unclassified; no need for a separate holding account). Resolve ids with list_bank_accounts / list_categories / list_parties first. 'reported' (報稅/上外帳) sets the book to 'both', otherwise 'internal' (transfers are always 'both'). Set billedToCompanyTaxId=true to mark 有報公司統編 (the invoice attachment itself is done in the app). To reimburse an advance use create_reimbursement. When contractId is set, the result carries `contractProgress` (amount/received/remaining/fullyCollected) — if `fullyCollected` is true while the contract is still draft/active, TELL THE USER the contract is now fully collected and ASK whether to set it to completed (已完成); on a yes, call update_contract with status='completed'. Never flip the status without asking.",
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
        contractId: {
          type: "number",
          description:
            "Optional contract to link. income counts toward the contract's 已收/未收; expense/advance are cost-only (does not reduce the contract amount). The response returns the contract's updated collection progress — check `contractProgress.fullyCollected` and follow the tool description when it is true.",
        },
        subscriptionId: {
          type: "number",
          description:
            "Optional subscription to link; income counts toward that subscription period's 已收.",
        },
        subscriptionPeriod: {
          type: "string",
          description:
            "YYYY-MM-DD, the billing period's start date this payment covers. Required when subscriptionId is set.",
        },
        billedToCompanyTaxId: {
          type: "boolean",
          description: "有報公司統編（進項可扣抵）。Default false.",
        },
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
      const contractId = await optContractId(db, args, orgId);
      const subscriptionId = await optSubscriptionId(db, args, orgId);
      const subscriptionPeriod = optDate(args, "subscriptionPeriod");
      if (subscriptionId !== undefined && subscriptionPeriod === undefined) {
        throw new Error(
          '"subscriptionPeriod" (YYYY-MM-DD) is required when "subscriptionId" is set.',
        );
      }
      const amount = requireDecimal(args, "amount");
      const currency = normalizeCurrency(args, "currency");
      // 每一腳（expense/income 的單一帳戶、transfer 的 from + to）都要跟自己的帳戶同幣別。
      await assertAccountCurrency(db, orgId, currency, [f.fromAccountId, f.toAccountId]);
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
          contractId: contractId ?? null,
          subscriptionId: subscriptionId ?? null,
          subscriptionPeriod: subscriptionPeriod ?? null,
          amount,
          currency,
          amountTwd: currency === "TWD" ? amount : null,
          fromAccountId: f.fromAccountId,
          toAccountId: f.toAccountId,
          book: reported ? "both" : "internal",
          billedToCompanyTaxId: optBoolean(args, "billedToCompanyTaxId") ?? false,
        })
        .returning();
      if (contractId === undefined) return row;
      const [progress] = await getContractProgress(db, orgId, [contractId]);
      return { ...row, contractProgress: progress ?? null };
    },
  },

  bulk_create_transactions: {
    description:
      "Insert MANY ledger transactions in ONE call — use this instead of calling create_transaction in a loop. Pass `items`: an array where each element mirrors create_transaction's arguments (type, txnDate, amount, currency?, description?, reported?, accountId?, partyName?, categoryId?, settleEmployeeName?, fromAccountId?, toAccountId?, projectId?, contractId?, subscriptionId?, subscriptionPeriod?). Per-type requirements match create_transaction (expense/income: accountId+partyName; advance: partyName+settleEmployeeName; transfer: fromAccountId+toAccountId); categoryId is optional (omit → 未分類, unclassified). Account/category/project/contract/subscription ids are validated against your org; party/employee names are created on demand and deduped within the batch. subscriptionPeriod (YYYY-MM-DD) is required on any item that sets subscriptionId. All rows are written in a single INSERT. Returns the created count, the ids, and — for every contract any item linked to — `contractProgress` (amount/received/remaining/fullyCollected). For each entry with `fullyCollected` true while the contract is still draft/active, TELL THE USER that contract is now fully collected and ASK whether to set it to completed (已完成); on a yes, call update_contract with status='completed'. Never flip the status without asking. Max 1000 items per call.",
    inputSchema: {
      type: "object",
      properties: {
        items: {
          type: "array",
          description: "Transactions to create; each item mirrors create_transaction's arguments.",
          items: {
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
              contractId: {
                type: "number",
                description:
                  "Optional contract to link (income → 已收; expense/advance → cost only). The response returns each linked contract's updated collection progress.",
              },
              subscriptionId: {
                type: "number",
                description: "Optional subscription to link (income → that period's 已收).",
              },
              subscriptionPeriod: {
                type: "string",
                description:
                  "YYYY-MM-DD period start this payment covers. Required when subscriptionId is set.",
              },
              billedToCompanyTaxId: {
                type: "boolean",
                description: "有報公司統編。Default false.",
              },
            },
            required: ["type", "txnDate", "amount"],
            additionalProperties: false,
          },
        },
        ...ORG_ARG,
      },
      required: ["items"],
      additionalProperties: false,
    },
    execute: async (args, ctx) => {
      const items = args.items;
      if (!Array.isArray(items) || items.length === 0) {
        throw new Error('"items" must be a non-empty array.');
      }
      if (items.length > 1000) {
        throw new Error(`"items" has ${items.length} rows; max 1000 per call.`);
      }
      const orgId = await resolveOrg(args, ctx);
      const db = getDb();

      // Load the org's valid FK ids once, so each row is validated in memory
      // instead of issuing an assertInOrg round trip per row.
      const [acctRows, catRows, projRows, contractRows, subscriptionRows] = await Promise.all([
        db
          .select({ id: bankAccounts.id, name: bankAccounts.name, currency: bankAccounts.currency })
          .from(bankAccounts)
          .where(eq(bankAccounts.organizationId, orgId)),
        db.select({ id: categories.id }).from(categories).where(eq(categories.organizationId, orgId)),
        db.select({ id: projects.id }).from(projects).where(eq(projects.organizationId, orgId)),
        db.select({ id: contracts.id }).from(contracts).where(eq(contracts.organizationId, orgId)),
        db.select({ id: subscriptions.id }).from(subscriptions).where(eq(subscriptions.organizationId, orgId)),
      ]);
      const acctSet = new Set(acctRows.map((r) => r.id));
      // 幣別驗證跟 FK 驗證一樣在記憶體裡做，避免每列各發一次 query。
      const acctById = new Map<number, AccountCurrencyRef>(acctRows.map((r) => [r.id, r]));
      const catSet = new Set(catRows.map((r) => r.id));
      const projSet = new Set(projRows.map((r) => r.id));
      const contractSet = new Set(contractRows.map((r) => r.id));
      const subscriptionSet = new Set(subscriptionRows.map((r) => r.id));

      const sets: BulkTxnSets = { acctSet, catSet, projSet, contractSet, subscriptionSet };
      const partyLabelByName = new Map<string, string>();
      const employeeNames = new Set<string>();
      const norms: Norm[] = items.map((raw, i) =>
        normalizeBulkTxnItem(raw, i, sets, partyLabelByName, employeeNames),
      );
      norms.forEach((n, i) => {
        const bad = findMismatchInMap(acctById, n.currency, [n.fromAccountId, n.toAccountId]);
        if (bad) throw new Error(`items[${i}]: ${accountCurrencyErrorMessage(bad)}`);
      });

      const partyId = await resolvePartyNames(db, orgId, partyLabelByName);
      const employeeId = await resolveEmployeeNames(db, orgId, employeeNames);

      const values = norms.map((n) => ({
        organizationId: orgId,
        type: n.type,
        txnDate: n.txnDate,
        description: n.description,
        categoryId: n.categoryId,
        partyId: n.partyName ? (partyId.get(n.partyName) ?? null) : null,
        settleEmployeeId: n.settleEmployeeName ? (employeeId.get(n.settleEmployeeName) ?? null) : null,
        projectId: n.projectId,
        contractId: n.contractId,
        subscriptionId: n.subscriptionId,
        subscriptionPeriod: n.subscriptionPeriod,
        amount: n.amount,
        currency: n.currency,
        amountTwd: n.currency === "TWD" ? n.amount : null,
        fromAccountId: n.fromAccountId,
        toAccountId: n.toAccountId,
        book: n.reported ? "both" : "internal",
        billedToCompanyTaxId: n.billedToCompanyTaxId,
      }));
      const inserted = await db.insert(transactions).values(values).returning({ id: transactions.id });
      const linkedContractIds = norms
        .map((n) => n.contractId)
        .filter((id): id is number => id !== null);
      const contractProgress = await getContractProgress(db, orgId, linkedContractIds);
      return {
        created: inserted.length,
        ids: inserted.map((r) => r.id),
        ...(contractProgress.length ? { contractProgress } : {}),
      };
    },
  },

  update_transaction: {
    description:
      "Edit a transaction's date, amount, currency, description, category (categoryId 0 clears it → 未分類), project, contract, subscription, subscription period, reported flag, or billedToCompanyTaxId (有報公司統編) — only provided fields change. To change the account or counterparty, delete and recreate, or use the app. If the edit touches a contract-linked transaction, the result carries `contractProgress` for the contracts involved — when an entry is `fullyCollected` while the contract is still draft/active, tell the user and ask whether to set that contract to completed (已完成) via update_contract; never flip the status without asking.",
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
        contractId: { type: "number", description: "Link/relink to a contract; 0 to unset." },
        subscriptionId: { type: "number", description: "Link/relink to a subscription; 0 to unset." },
        subscriptionPeriod: {
          type: "string",
          description: "Period start YYYY-MM-DD; empty string to unset.",
        },
        reported: { type: "boolean" },
        billedToCompanyTaxId: { type: "boolean", description: "有報公司統編（進項可扣抵）。" },
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
          contractId: transactions.contractId,
          fromAccountId: transactions.fromAccountId,
          toAccountId: transactions.toAccountId,
        })
        .from(transactions)
        .where(and(eq(transactions.organizationId, orgId), eq(transactions.id, id)))
        .limit(1);
      if (!existing) throw new Error(`Transaction ${id} not found in your organization.`);

      const patch: Record<string, unknown> = { updatedAt: new Date().toISOString() };
      if (optDate(args, "txnDate") !== undefined) patch.txnDate = optDate(args, "txnDate");
      if (optString(args, "description") !== undefined)
        patch.description = optString(args, "description");
      if (optBoolean(args, "billedToCompanyTaxId") !== undefined) {
        patch.billedToCompanyTaxId = optBoolean(args, "billedToCompanyTaxId");
      }
      await applyTxnRelationPatch(patch, db, args, orgId);
      applyTxnAmountPatch(patch, args, existing);
      // 這支工具改不了帳戶，但改得了幣別 —— 改完仍要跟原本綁的帳戶對得起來。
      if (typeof patch.currency === "string") {
        await assertAccountCurrency(db, orgId, patch.currency, [
          existing.fromAccountId,
          existing.toAccountId,
        ]);
      }
      const [row] = await db
        .update(transactions)
        .set(patch)
        .where(and(eq(transactions.organizationId, orgId), eq(transactions.id, id)))
        .returning();
      // 進度受影響的合約：原本綁的（可能被解綁或金額變動）＋改綁的新合約。
      const touchedContractIds = [existing.contractId, row.contractId].filter(
        (cid): cid is number => cid != null,
      );
      const contractProgress = await getContractProgress(db, orgId, touchedContractIds);
      return contractProgress.length ? { ...row, contractProgress } : row;
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

      const deletedAt = new Date().toISOString();
      await db
        .update(documents)
        .set({ deletedAt })
        .where(eq(documents.transactionId, id));
      await db
        .update(transactions)
        .set({ deletedAt })
        .where(and(eq(transactions.organizationId, orgId), eq(transactions.id, id)));
      return { deleted: true, id };
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
      // 撥款的幣別跟著原代墊走，付款帳戶必須是同一種幣別。
      await assertAccountCurrency(db, orgId, currency, [fromAccountId]);
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

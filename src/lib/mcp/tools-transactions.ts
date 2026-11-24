import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import {
  bankAccounts,
  billingItems,
  categories,
  contracts,
  documents,
  employees,
  payslips,
  projects,
  subscriptions,
  transactions,
} from "@/db/schema";
import {
  getMonthlySpendBreakdown,
  getOverview,
  getTransaction,
  listOutstandingAdvances,
  listTransactions,
} from "@/db/queries";
import {
  assertInOrg,
  getContractProgress,
  EFFECTIVE_TAX_PROPS,
  taxBreakdownProps,
  listResult,
  listSchema,
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
  rowSchema,
  type ToolDef,
} from "./shared";
import { resolvePayoutAccount } from "@/db/employee-accounts";
import { releaseLegacyMirror } from "@/db/allocations";
import { summarizeSpendTrend } from "@/lib/spend-trend";
import { PAYOUT_ACCOUNT_SCHEMA, payoutAccountOutput } from "./tools-employee-accounts";
import { externalSingleLegSide } from "@/lib/external-transfer";
import { resolvePartiesForWrite, resolvePartyForWrite } from "@/lib/linking/party";
import type { SimilarParty } from "@/lib/linking/party-similarity";
import {
  insertTransaction,
  insertTransactions,
  updateTransactionLinked,
  updateTransactionsPlainByIds,
  type LinkReport,
  type TxnInsert,
} from "@/lib/linking/write";
import {
  assertAccountCurrency,
  findMismatchInMap,
  accountCurrencyErrorMessage,
  type AccountCurrencyRef,
} from "@/lib/account-currency";

const TXN_TYPES = ["expense", "income", "advance", "transfer"] as const;
const BOOKS = ["both", "internal", "external"] as const;

// 建立/更新/撥款/查單筆都直接把 transactions 整列回出去，形狀共用一份避免各寫各的走鐘。
// 型別對照 db/schema.ts：numeric → string（drizzle 不轉 number，避免精度失真）、
// date 與 timestamp(mode:'string') → string、bigint(mode:'number') → number。
const TXN_ROW_PROPS: Record<string, unknown> = {
  id: { type: "number" },
  organizationId: { type: ["string", "null"] },
  type: { type: "string", description: "expense | income | advance | transfer | reimbursement" },
  txnDate: { type: "string", description: "YYYY-MM-DD." },
  description: { type: ["string", "null"] },
  amount: { type: "string", description: "Decimal as a string (numeric(18,2))." },
  currency: { type: "string", description: "3-letter code." },
  amountTwd: { type: ["string", "null"], description: "Only set when currency is TWD." },
  book: { type: "string", enum: [...BOOKS] },
  billedToCompanyTaxId: { type: "boolean" },
  categoryId: { type: ["number", "null"] },
  partyId: { type: ["number", "null"] },
  settleEmployeeId: { type: ["number", "null"] },
  projectId: { type: ["number", "null"] },
  contractId: { type: ["number", "null"] },
  subscriptionId: { type: ["number", "null"] },
  subscriptionPeriod: { type: ["string", "null"], description: "Period start, YYYY-MM-DD." },
  billingItemId: { type: ["number", "null"] },
  vendorBillingAccountId: {
    type: ["number", "null"],
    description: "Vendor billing account (固定支出) this expense pays; set automatically when the vendor has exactly one.",
  },
  reviewReason: {
    type: ["string", "null"],
    description:
      "待連結 state: link_suggested | link_ambiguous | link_amount_mismatch | party_similar | link_skipped; null = nothing to review.",
  },
  linkCandidates: {
    type: ["object", "null"],
    description: "Candidates kept for 待連結 review (billing items / subscription periods / contracts, or similar parties).",
  },
  invoiceId: { type: ["number", "null"] },
  relatedToId: { type: ["number", "null"], description: "The advance a reimbursement pays back." },
  externalSource: {
    type: ["string", "null"],
    description: "Where an imported row came from (e.g. 'wise'); null for entries typed in by hand.",
  },
  externalRef: {
    type: ["string", "null"],
    description: "The source's unique reference (Wise referenceNumber); dedupe key with externalSource.",
  },
  externalMeta: {
    type: ["object", "null"],
    description: "Raw non-secret details from the source (merchant, original amount, rate, fees, card last four).",
  },
  needsReview: {
    type: "boolean",
    description: "Imported automatically and not yet confirmed by a person (category still to be chosen).",
  },
  deletedAt: { type: ["string", "null"] },
  createdAt: { type: "string" },
  updatedAt: { type: "string" },
};

// 整列回傳時每個欄位都在（可為 null，但一定有 key）。
const TXN_ROW_REQUIRED = Object.keys(TXN_ROW_PROPS);

// 註：用到 TXN_ROW_PROPS 的 schema 一律不寫 additionalProperties: false —— 這些是
// `.returning()` 的整列回傳，資料表一加欄位就會多帶 key，封死等於讓下次 migration
// 靜靜地把 structuredContent 打成不合法。手工組出來的固定形狀才封。

// shared.ts 的 ContractProgress。`action` 只有在「已收滿但狀態還開著」時才附上，
// 所以不進 required。
export const CONTRACT_PROGRESS_SCHEMA = {
  type: "object",
  properties: {
    contractId: { type: "number" },
    title: { type: "string" },
    status: { type: "string" },
    currency: { type: "string" },
    amount: { type: ["number", "null"], description: "Contract amount as stored (basis per amountBasis)." },
    ...taxBreakdownProps(true),
    ...EFFECTIVE_TAX_PROPS,
    received: {
      type: "number",
      description: "已收 incl. absorbed fees: allocations to the contract, its billing items and bound subscriptions' periods.",
    },
    feeAbsorbed: { type: "number", description: "Absorbed bank fee / FX shortfall inside `received`." },
    remaining: { type: ["number", "null"], description: "gross − received." },
    fullyCollected: { type: "boolean", description: "received >= gross (and gross > 0)." },
    action: {
      type: "string",
      description: "Present only when the contract is fully collected but still open.",
    },
  },
  required: [
    "contractId",
    "title",
    "status",
    "currency",
    "amount",
    "net",
    "tax",
    "gross",
    "taxTreatment",
    "amountBasis",
    "received",
    "feeAbsorbed",
    "remaining",
    "fullyCollected",
  ],
};

// ---- 連結層的回報（src/lib/linking/write.ts 的 LinkReport）----
// 這幾個都不封 additionalProperties：連結層之後多帶欄位不該讓 structuredContent 變成不合法。

const LINK_REF_SCHEMA = {
  type: "object",
  properties: {
    kind: {
      type: "string",
      description: "billing_item | subscription | contract | project | vendor_billing_account",
    },
    id: { type: "number" },
    name: { type: ["string", "null"] },
    via: {
      type: "string",
      enum: ["given", "inherited", "matched"],
      description: "given = you passed it; inherited = derived from a parent link; matched = auto-matched by amount.",
    },
    subscriptionPeriod: { type: "string", description: "Subscription links only: period start YYYY-MM-DD." },
  },
  required: ["kind", "id", "name", "via"],
};

const LINK_CANDIDATE_SCHEMA = {
  type: "object",
  properties: {
    kind: { type: "string", enum: ["billing_item", "subscription", "contract"] },
    id: { type: "number", description: "billingItemId / subscriptionId / contractId to pass to update_transaction." },
    label: { type: "string" },
    contractId: { type: ["number", "null"] },
    projectId: { type: ["number", "null"] },
    subscriptionPeriod: {
      type: ["string", "null"],
      description: "Subscription candidates: pass as subscriptionPeriod together with subscriptionId.",
    },
    expected: { type: "number", description: "Still outstanding on this candidate." },
    currency: { type: "string" },
    gap: { type: "number", description: "expected − transaction amount (positive = paid less, e.g. bank fees)." },
    amountMatches: { type: "boolean" },
  },
  required: ["kind", "id", "label", "expected", "currency", "gap", "amountMatches"],
};

const SIMILAR_PARTY_SCHEMA = {
  type: "object",
  properties: {
    id: { type: "number" },
    name: { type: "string" },
    score: { type: "number", description: "0–1 similarity." },
    via: { type: "string", enum: ["name", "alias"] },
  },
  required: ["id", "name", "score", "via"],
};

const UNLINKED_SCHEMA = {
  anyOf: [
    {
      type: "object",
      properties: {
        reason: {
          type: "string",
          description: "link_suggested | link_ambiguous | link_amount_mismatch | party_similar",
        },
        message: { type: "string" },
        candidates: { type: "array", items: LINK_CANDIDATE_SCHEMA },
        party: {
          type: "object",
          properties: {
            name: { type: "string" },
            label: { type: "string" },
            candidates: { type: "array", items: SIMILAR_PARTY_SCHEMA },
          },
        },
      },
      required: ["reason", "message", "candidates"],
    },
    { type: "null" },
  ],
  description:
    "What could not be linked automatically (null = nothing to ask). Ask the user ONCE which candidate applies (or to skip) — never guess.",
};

const STATUS_HINT_SCHEMA = {
  type: "object",
  properties: {
    kind: { type: "string", enum: ["contract_fully_collected", "project_ready_to_close"] },
    message: { type: "string" },
    contractId: { type: "number" },
    projectId: { type: "number" },
    title: { type: "string" },
    name: { type: "string" },
    status: { type: "string" },
    currency: { type: "string" },
    amount: { type: "number" },
    received: { type: "number" },
  },
  required: ["kind", "message"],
};

const LINK_REPORT_PROPS: Record<string, unknown> = {
  links: { type: "array", items: LINK_REF_SCHEMA, description: "What this transaction is linked to." },
  unlinked: UNLINKED_SCHEMA,
  hints: {
    type: "array",
    items: STATUS_HINT_SCHEMA,
    description: "Contracts / projects that now look ready to close. Tell the user and ask before changing any status.",
  },
};
const LINK_REPORT_REQUIRED = ["links", "unlinked", "hints"];

const PARTY_SIMILAR_PROP = {
  type: "array",
  items: SIMILAR_PARTY_SCHEMA,
  description:
    "partyName created a NEW party that looks like these existing ones. Ask the user once whether it is the same party (merge_parties can merge them).",
};

/** LinkReport → 工具輸出；只有真的新建了、又有相似既有對象時才帶 partySimilar。 */
function linkOutput(report: LinkReport, similar: readonly SimilarParty[] = []) {
  return {
    links: report.links,
    unlinked: report.unlinked,
    hints: report.hints,
    ...(similar.length ? { partySimilar: [...similar] } : {}),
  };
}

const LINKING_NOTE =
  " Linking: the system links income automatically — it inherits contract/project from billingItemId / subscriptionId / contractId, and when none is given it matches open billing items, subscription periods and contracts of that customer by amount. When `unlinked` comes back with candidates, ask the user ONCE which candidate applies (or skip) — never guess — then call update_transaction with the chosen billingItemId, subscriptionId+subscriptionPeriod, or contractId. When `partySimilar` is non-empty, ask once whether it is the same party (merge_parties). When `hints` is non-empty, tell the user and ask before changing any contract/project status.";

// list_transactions 回的是 db/queries.ts listTransactions 的投影（不是整列）：
// 交易本身的欄位加上 join 出來的分類 / 帳戶 / 對象 / 員工 / 專案名稱。
const TXN_LIST_ROW = rowSchema({
  id: { type: "number" },
  txnDate: { type: "string", description: "YYYY-MM-DD." },
  description: { type: ["string", "null"] },
  amount: { type: "string", description: "Decimal as a string." },
  currency: { type: "string", description: "3-letter code." },
  amountTwd: { type: ["string", "null"] },
  book: { type: "string", enum: [...BOOKS] },
  type: { type: "string", description: "expense | income | advance | transfer | reimbursement" },
  createdAt: { type: "string", description: "ISO 8601 timestamp." },
  updatedAt: { type: "string", description: "ISO 8601 timestamp." },
  categoryId: { type: ["number", "null"] },
  billedToCompanyTaxId: { type: "boolean" },
  categoryName: { type: ["string", "null"] },
  categoryKind: { type: ["string", "null"] },
  fromAccountId: { type: ["number", "null"] },
  toAccountId: { type: ["number", "null"] },
  partyId: { type: ["number", "null"] },
  settleEmployeeId: { type: ["number", "null"] },
  projectId: { type: ["number", "null"] },
  projectName: { type: ["string", "null"] },
  contractId: { type: ["number", "null"] },
  fromAccount: { type: ["string", "null"], description: "Name of fromAccountId." },
  toAccount: { type: ["string", "null"], description: "Name of toAccountId." },
  partyName: { type: ["string", "null"] },
  settleName: { type: ["string", "null"], description: "Employee who fronted an advance." },
  settleToAccountId: {
    type: ["number", "null"],
    description: "Employee bank account a reimbursement / salary was recorded as paid into.",
  },
  settleToBankName: { type: ["string", "null"] },
  settleToAccountLast5: { type: ["string", "null"], description: "Masked: last 5 characters only." },
  needsReview: {
    type: "boolean",
    description: "Imported automatically (e.g. Wise sync) and not yet confirmed; set a category to clear it.",
  },
  externalSource: { type: ["string", "null"], description: "e.g. 'wise'; null when entered by hand." },
  externalRef: { type: ["string", "null"], description: "Source reference, e.g. Wise referenceNumber." },
  externalMeta: {
    type: ["object", "null"],
    description: "Raw details from the source (merchant, original amount, rate, fees; for a Wise conversion leg: conversion.counterCurrency).",
  },
});

// getOverview 已經把聚合結果轉成 number。
const SPEND_BREAKDOWN_ITEM = rowSchema({
  key: { type: "string", description: "category:<id>, party:<id>, category:none (未分類) or party:none (no counterparty)." },
  kind: { type: "string", enum: ["category", "party", "none"] },
  id: { type: ["number", "null"], description: "Category or party id; null for the unassigned bucket." },
  name: { type: ["string", "null"], description: "null for the unassigned bucket." },
  total: { type: "number", description: "TWD, whole period." },
  average: { type: "number", description: "TWD per month over the period." },
  lastMonth: { type: "number", description: "TWD in the current (partial) month." },
  previousMonth: { type: "number" },
  change: { type: "number", description: "lastMonth − previousMonth." },
  changePct: { type: ["number", "null"], description: "Ratio (0.25 = +25%); null when previousMonth ≤ 0." },
  firstSpendMonth: { type: ["string", "null"], description: "YYYY-MM of the first expense ever (same definition)." },
  isNew: { type: "boolean", description: "First expense falls inside the period." },
  monthly: {
    type: "array",
    items: rowSchema({ month: { type: "string", description: "YYYY-MM." }, amount: { type: "number" } }),
  },
});

const SPEND_BREAKDOWN_RESULT = rowSchema({
  dimension: { type: "string", enum: ["category", "vendor"] },
  currency: { type: "string", enum: ["TWD"] },
  months: { type: "array", items: { type: "string" }, description: "YYYY-MM, oldest first; the last is the current month (Asia/Taipei)." },
  monthTotals: { type: "array", items: { type: "number" }, description: "TWD per month, aligned with months." },
  periodTotal: { type: "number" },
  unconvertedCount: { type: "number", description: "Foreign-currency expenses with no TWD amount; excluded from all totals." },
  items: { type: "array", items: SPEND_BREAKDOWN_ITEM },
  count: { type: "number" },
});

const OVERVIEW_ROW = rowSchema({
  currency: { type: "string", description: "3-letter code." },
  income: { type: "number" },
  expense: { type: "number", description: "expense + advance." },
  net: { type: "number", description: "income − expense." },
});

const ADVANCE_ROW = rowSchema({
  id: { type: "number", description: "Pass this back as advanceId to create_reimbursement." },
  txnDate: { type: "string", description: "YYYY-MM-DD." },
  amount: { type: "string", description: "Decimal as a string." },
  amountTwd: { type: ["string", "null"] },
  currency: { type: "string", description: "3-letter code." },
  description: { type: ["string", "null"] },
  vendorName: { type: ["string", "null"], description: "Who the employee paid." },
  settleEmployeeId: {
    type: ["number", "null"],
    description: "Employee owed the money back; see list_employee_bank_accounts for where to repay.",
  },
  settleName: { type: ["string", "null"], description: "Employee owed the money back." },
  categoryName: { type: ["string", "null"] },
});

type Db = ReturnType<typeof getDb>;

/**
 * 名稱 → 交易對象 id（比對名稱 / 別名，只看未刪除的；查無就新建）。
 * 走連結層 mode "create"：AI 明確給了名字就照建，但把相似的既有對象一起回傳（partySimilar）。
 */
async function getOrCreateParty(
  db: Db,
  orgId: string,
  name: string,
  label: string,
): Promise<{ id: number; similar: SimilarParty[] }> {
  const r = await resolvePartyForWrite(db, orgId, name, label, "create");
  if (r.partyId == null) throw new Error(`Could not resolve party "${name}".`);
  return { id: r.partyId, similar: r.created ? r.similar : [] };
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
  /** partyName 新建了對象、而且跟既有對象很像時的候選（沒有就是空陣列） */
  partySimilar: SimilarParty[];
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
    partySimilar: [],
  };
  if (type === "expense" || type === "income") {
    const isIncome = type === "income";
    const accountId = requireNumber(args, "accountId");
    await assertInOrg(db, bankAccounts, accountId, orgId, "Account");
    const categoryId = optNumber(args, "categoryId") ?? null; // 可省略＝未分類
    if (categoryId !== null) await assertInOrg(db, categories, categoryId, orgId, "Category");
    const party = await getOrCreateParty(
      db,
      orgId,
      requireString(args, "partyName"),
      isIncome ? "customer" : "vendor",
    );
    return {
      ...blank,
      categoryId,
      partyId: party.id,
      partySimilar: party.similar,
      fromAccountId: isIncome ? null : accountId,
      toAccountId: isIncome ? accountId : null,
    };
  }
  if (type === "advance") {
    const categoryId = optNumber(args, "categoryId") ?? null; // 可省略＝未分類
    if (categoryId !== null) await assertInOrg(db, categories, categoryId, orgId, "Category");
    const party = await getOrCreateParty(db, orgId, requireString(args, "partyName"), "vendor");
    return {
      ...blank,
      categoryId,
      partyId: party.id,
      partySimilar: party.similar,
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

async function optBillingItemId(
  db: Db,
  args: Record<string, unknown>,
  orgId: string,
): Promise<number | undefined> {
  const billingItemId = optNumber(args, "billingItemId");
  if (billingItemId !== undefined)
    await assertInOrg(db, billingItems, billingItemId, orgId, "Billing item");
  return billingItemId;
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
  billingItemId: number | null;
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
  billingItemSet: Set<number>;
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
  const billingItemId = optNumber(it, "billingItemId") ?? null;
  assertOrgRef(billingItemId, sets.billingItemSet, at, "billingItemId");
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
    billingItemId,
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

type TxnPatch = Partial<TxnInsert>;

// 關聯 id 參數：有給才處理；0＝清除（回傳 null），其他值先確認屬於這個組織。
// 沒給則回傳 undefined（不動）。
async function optRelationId(
  db: Db,
  args: Record<string, unknown>,
  key: string,
  table: Parameters<typeof assertInOrg>[1],
  orgId: string,
  label: string,
): Promise<number | null | undefined> {
  if (optNumber(args, key) === undefined) return undefined;
  const id = requireNumber(args, key);
  if (id === 0) return null;
  await assertInOrg(db, table, id, orgId, label);
  return id;
}

// Apply the relation fields (category / project / contract / subscription / billing item)
// to the patch. Each is only touched when its arg was provided; 0 clears the link.
async function applyTxnRelationPatch(
  patch: TxnPatch,
  db: Db,
  args: Record<string, unknown>,
  orgId: string,
) {
  // 0＝清除分類（未分類）
  const categoryId = await optRelationId(db, args, "categoryId", categories, orgId, "Category");
  if (categoryId !== undefined) patch.categoryId = categoryId;
  if (optNumber(args, "projectId") !== undefined) {
    patch.projectId = await optProjectId(db, args, orgId);
  }
  const contractId = await optRelationId(db, args, "contractId", contracts, orgId, "Contract");
  if (contractId !== undefined) patch.contractId = contractId;
  const subscriptionId = await optRelationId(db, args, "subscriptionId", subscriptions, orgId, "Subscription");
  if (subscriptionId !== undefined) {
    patch.subscriptionId = subscriptionId;
    // 解除訂閱綁定時，期別一併清空。
    if (subscriptionId === null) patch.subscriptionPeriod = null;
  }
  const billingItemId = await optRelationId(db, args, "billingItemId", billingItems, orgId, "Billing item");
  if (billingItemId !== undefined) patch.billingItemId = billingItemId;
  // 期別：空字串代表清除；未提供則不動。只有在沒有因 subscriptionId=0 清空時才處理。
  if (args.subscriptionPeriod !== undefined && patch.subscriptionPeriod === undefined) {
    patch.subscriptionPeriod = optDate(args, "subscriptionPeriod") ?? null;
  }
}

// Apply amount/currency and the reported→book flag to the patch, falling back to
// the existing row's values when only one of amount/currency is supplied.
function applyTxnAmountPatch(
  patch: TxnPatch,
  args: Record<string, unknown>,
  existing: { type: string; amount: string; currency: string },
  singleLeg = false,
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
    // 外部同步的單腳轉帳（Wise 換匯）不套「轉帳固定 both」，照 reported 決定。
    patch.book =
      (existing.type === "transfer" && !singleLeg) || optBoolean(args, "reported")
        ? "both"
        : "internal";
  }
}

export const transactionTools: Record<string, ToolDef> = {
  list_transactions: {
    description:
      "List ledger transactions (management & tax books), newest first. Optional filters: book, categoryId, accountId, projectId, period (YYYY-MM), needsReview (true = rows imported by an integration such as the Wise sync that nobody has confirmed yet — review them and set a category with update_transaction).",
    inputSchema: {
      type: "object",
      properties: {
        book: {
          type: "string",
          enum: [...BOOKS],
          description: "internal = management books only; external = tax books only; both = recorded in both.",
        },
        categoryId: { type: "number" },
        accountId: { type: "number", description: "Matches from OR to account." },
        projectId: { type: "number" },
        period: { type: "string", description: "Month filter, YYYY-MM." },
        needsReview: {
          type: "boolean",
          description: "true = only imported rows awaiting review (待確認); false = only confirmed rows.",
        },
        limit: { type: "number", description: "Default 100." },
        ...ORG_ARG,
      },
      additionalProperties: false,
    },
    outputSchema: listSchema(TXN_LIST_ROW),
    execute: async (args, ctx) => {
      const orgId = await resolveOrg(args, ctx);
      const filters = {
        book: optString(args, "book") as "internal" | "external" | "both" | undefined,
        categoryId: optNumber(args, "categoryId"),
        accountId: optNumber(args, "accountId"),
        projectId: optNumber(args, "projectId"),
        period: optString(args, "period"),
        needsReview: optBoolean(args, "needsReview"),
      };
      const db = getDb();
      if (filters.categoryId !== undefined)
        await assertInOrg(db, categories, filters.categoryId, orgId, "Category");
      if (filters.accountId !== undefined)
        await assertInOrg(db, bankAccounts, filters.accountId, orgId, "Account");
      if (filters.projectId !== undefined)
        await assertInOrg(db, projects, filters.projectId, orgId, "Project");
      return listResult(await listTransactions(orgId, filters, optNumber(args, "limit") ?? 100));
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
    // 查不到時回的是 { error } 而不是丟錯，兩種形狀共用一個 schema，所以沒有任何欄位
    // 能列進 required。
    outputSchema: {
      type: "object",
      properties: {
        ...TXN_ROW_PROPS,
        error: { type: "string", description: "Present instead of the row when not found." },
      },
    },
    execute: async (args, ctx) =>
      (await getTransaction(await resolveOrg(args, ctx), requireNumber(args, "id"))) ?? {
        error: "Not found.",
      },
  },

  get_financial_overview: {
    description:
      "Income/expense/net totals grouped by currency, computed from the recorded ledger. One row per currency; currencies are never mixed.",
    inputSchema: { type: "object", properties: { ...ORG_ARG }, additionalProperties: false },
    outputSchema: listSchema(OVERVIEW_ROW),
    execute: async (args, ctx) => listResult(await getOverview(await resolveOrg(args, ctx))),
  },

  monthly_spend_breakdown: {
    description:
      "Monthly spend (支出分析) broken down by transaction category or by vendor (counterparty), in TWD, for the last N months ending with the current month (Asia/Taipei). Same definition as the dashboard's 支出去向 and the 報表 > 支出分析 page: type=expense only; transfers, owner/equity and income-categorised rows, advances and reimbursements excluded; foreign currency counted at its booked TWD amount (rows without one are reported in unconvertedCount and left out). Items are sorted by period total, include the 未分類 / no-counterparty bucket, and carry month-over-month change and whether the item is new in the period. Filter to one vendor or category with partyId / categoryId.",
    inputSchema: {
      type: "object",
      properties: {
        ...ORG_ARG,
        dimension: { type: "string", enum: ["category", "vendor"], description: "Default category." },
        months: { type: "number", description: "1–24, default 12." },
        partyId: { type: "number", description: "Only this vendor (see list_parties)." },
        categoryId: { type: "number", description: "Only this category (see list_categories)." },
      },
      additionalProperties: false,
    },
    outputSchema: SPEND_BREAKDOWN_RESULT,
    // 名稱不是 list_/get_ 開頭，handler 不會自動判成唯讀；這支只讀帳本。
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    execute: async (args, ctx) => {
      const orgId = await resolveOrg(args, ctx);
      const dimension = optString(args, "dimension") ?? "category";
      if (dimension !== "category" && dimension !== "vendor") {
        throw new Error('"dimension" must be "category" or "vendor".');
      }
      const months = Math.trunc(optNumber(args, "months") ?? 12);
      if (months < 1 || months > 24) throw new Error('"months" must be between 1 and 24.');
      const data = await getMonthlySpendBreakdown(orgId, months, {
        partyId: optNumber(args, "partyId"),
        categoryId: optNumber(args, "categoryId"),
      });
      const trend = summarizeSpendTrend(
        data.rows,
        data.months,
        months,
        dimension === "vendor" ? "party" : "category",
        Number.POSITIVE_INFINITY,
      );
      const items = trend.items.map((it) => ({
        key: it.key,
        kind: it.kind,
        id: it.id,
        name: it.name,
        total: it.total,
        average: it.average,
        lastMonth: it.last,
        previousMonth: it.prev,
        change: it.change,
        changePct: it.changePct,
        firstSpendMonth: it.firstMonth,
        isNew: it.isNew,
        monthly: trend.months.map((month, i) => ({ month, amount: it.monthly[i] })),
      }));
      return {
        dimension,
        currency: "TWD",
        months: trend.months,
        monthTotals: trend.monthTotals,
        periodTotal: trend.summary.periodTotal,
        unconvertedCount: trend.unconverted,
        items,
        count: items.length,
      };
    },
  },

  list_outstanding_advances: {
    description:
      "Employee cash advances (代墊) that have no reimbursement entry booked against them yet. Once the company has repaid the employee, record it with create_reimbursement.",
    inputSchema: { type: "object", properties: { ...ORG_ARG }, additionalProperties: false },
    outputSchema: listSchema(ADVANCE_ROW),
    execute: async (args, ctx) =>
      listResult(await listOutstandingAdvances(await resolveOrg(args, ctx))),
  },

  create_transaction: {
    description:
      "Write one bookkeeping entry into the ledger for money that has already moved elsewhere. This records history; it never sends, collects or transfers anything, and 'transfer' here means a book entry between two of the organization's own ledger accounts. Required per type — expense/income: accountId + partyName; advance: partyName + settleEmployeeName (no account); transfer: fromAccountId + toAccountId. categoryId is optional — omit it to leave the entry 未分類 (unclassified; no need for a separate holding account). Resolve ids with list_bank_accounts / list_categories / list_parties first. 'reported' (計入稅務帳 — include in the tax books) sets the book to 'both' (management + tax), otherwise 'internal' (management books only); transfers are always 'both'. Set billedToCompanyTaxId=true to mark 有報公司統編 (the invoice attachment itself is done in the app). To book a repaid advance use create_reimbursement. When contractId is set, the result carries `contractProgress` (amount/received/remaining/fullyCollected) — if `fullyCollected` is true while the contract is still draft/active, tell the user the contract is now fully collected and ask whether to set it to completed (已完成); on a yes, call update_contract with status='completed'. Never flip the status without asking." +
      LINKING_NOTE,
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
        billingItemId: {
          type: "number",
          description:
            "Optional billing item (請款項) this payment settles; the transaction inherits its contract and project.",
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
    // 建立成功回的是整列交易＋連結報告；有掛上合約（給的或繼承的）才多一個 contractProgress
    // （單一物件，跟 bulk/update 的陣列不同）。
    outputSchema: {
      type: "object",
      properties: {
        ...TXN_ROW_PROPS,
        ...LINK_REPORT_PROPS,
        partySimilar: PARTY_SIMILAR_PROP,
        contractProgress: {
          anyOf: [CONTRACT_PROGRESS_SCHEMA, { type: "null" }],
          description: "Only present when the transaction ended up linked to a contract.",
        },
      },
      required: [...TXN_ROW_REQUIRED, ...LINK_REPORT_REQUIRED],
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
      const billingItemId = await optBillingItemId(db, args, orgId);
      const amount = requireDecimal(args, "amount");
      const currency = normalizeCurrency(args, "currency");
      // 每一腳（expense/income 的單一帳戶、transfer 的 from + to）都要跟自己的帳戶同幣別。
      await assertAccountCurrency(db, orgId, currency, [f.fromAccountId, f.toAccountId]);
      const reported = type === "transfer" || optBoolean(args, "reported") === true;
      const { row, report } = await insertTransaction(
        { db, orgId, source: "mcp" },
        {
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
          billingItemId: billingItemId ?? null,
          amount,
          currency,
          amountTwd: currency === "TWD" ? amount : null,
          fromAccountId: f.fromAccountId,
          toAccountId: f.toAccountId,
          book: reported ? "both" : "internal",
          billedToCompanyTaxId: optBoolean(args, "billedToCompanyTaxId") ?? false,
        },
      );
      const out = { ...row, ...linkOutput(report, f.partySimilar) };
      // 合約可能是給的，也可能是從請款項 / 訂閱繼承或比對到的 —— 以實際寫進去的為準。
      if (row.contractId == null) return out;
      const [progress] = await getContractProgress(db, orgId, [row.contractId]);
      return { ...out, contractProgress: progress ?? null };
    },
  },

  bulk_create_transactions: {
    description:
      "Write many ledger entries in one call — use this instead of calling create_transaction in a loop. Like create_transaction, this only records entries in the organization's own books; no money is moved. Pass `items`: an array where each element mirrors create_transaction's arguments (type, txnDate, amount, currency?, description?, reported?, accountId?, partyName?, categoryId?, settleEmployeeName?, fromAccountId?, toAccountId?, projectId?, contractId?, subscriptionId?, subscriptionPeriod?). Per-type requirements match create_transaction (expense/income: accountId+partyName; advance: partyName+settleEmployeeName; transfer: fromAccountId+toAccountId); categoryId is optional (omit → 未分類, unclassified). Account/category/project/contract/subscription ids are validated against your org; party/employee names are created on demand and deduped within the batch. subscriptionPeriod (YYYY-MM-DD) is required on any item that sets subscriptionId. All rows are written in a single database insert. Returns the created count, the ids, and — for every contract any item linked to — `contractProgress` (amount/received/remaining/fullyCollected). For each entry with `fullyCollected` true while the contract is still draft/active, tell the user that contract is now fully collected and ask whether to set it to completed (已完成); on a yes, call update_contract with status='completed'. Never flip the status without asking. Max 1000 items per call. Items also accept billingItemId; `results` carries each row's id, links, unlinked and hints (and partySimilar when its partyName created a party that looks like an existing one)." +
      LINKING_NOTE,
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
              billingItemId: {
                type: "number",
                description: "Optional billing item (請款項) this payment settles; inherits its contract and project.",
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
    // 只回 id 與每列的連結報告，不回整列；沒有任何一列綁合約時 contractProgress 整個 key 不會出現。
    outputSchema: {
      type: "object",
      properties: {
        created: { type: "number" },
        ids: { type: "array", items: { type: "number" } },
        results: {
          type: "array",
          description: "One entry per created row, in input order.",
          items: {
            type: "object",
            properties: { id: { type: "number" }, ...LINK_REPORT_PROPS, partySimilar: PARTY_SIMILAR_PROP },
            required: ["id", ...LINK_REPORT_REQUIRED],
          },
        },
        contractProgress: {
          type: "array",
          items: CONTRACT_PROGRESS_SCHEMA,
          description: "One entry per contract any item linked to; omitted when none did.",
        },
      },
      required: ["created", "ids", "results"],
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
      const [acctRows, catRows, projRows, contractRows, subscriptionRows, billingItemRows] = await Promise.all([
        db
          .select({ id: bankAccounts.id, name: bankAccounts.name, currency: bankAccounts.currency })
          .from(bankAccounts)
          .where(eq(bankAccounts.organizationId, orgId)),
        db.select({ id: categories.id }).from(categories).where(eq(categories.organizationId, orgId)),
        db.select({ id: projects.id }).from(projects).where(eq(projects.organizationId, orgId)),
        db.select({ id: contracts.id }).from(contracts).where(eq(contracts.organizationId, orgId)),
        db.select({ id: subscriptions.id }).from(subscriptions).where(eq(subscriptions.organizationId, orgId)),
        db.select({ id: billingItems.id }).from(billingItems).where(eq(billingItems.organizationId, orgId)),
      ]);
      const acctSet = new Set(acctRows.map((r) => r.id));
      // 幣別驗證跟 FK 驗證一樣在記憶體裡做，避免每列各發一次 query。
      const acctById = new Map<number, AccountCurrencyRef>(acctRows.map((r) => [r.id, r]));
      const catSet = new Set(catRows.map((r) => r.id));
      const projSet = new Set(projRows.map((r) => r.id));
      const contractSet = new Set(contractRows.map((r) => r.id));
      const subscriptionSet = new Set(subscriptionRows.map((r) => r.id));

      const billingItemSet = new Set(billingItemRows.map((r) => r.id));

      const sets: BulkTxnSets = { acctSet, catSet, projSet, contractSet, subscriptionSet, billingItemSet };
      const partyLabelByName = new Map<string, string>();
      const employeeNames = new Set<string>();
      const norms: Norm[] = items.map((raw, i) =>
        normalizeBulkTxnItem(raw, i, sets, partyLabelByName, employeeNames),
      );
      norms.forEach((n, i) => {
        const bad = findMismatchInMap(acctById, n.currency, [n.fromAccountId, n.toAccountId]);
        if (bad) throw new Error(`items[${i}]: ${accountCurrencyErrorMessage(bad)}`);
      });

      const parties = await resolvePartiesForWrite(db, orgId, partyLabelByName, "create");
      const employeeId = await resolveEmployeeNames(db, orgId, employeeNames);
      const partyOf = (n: Norm) => (n.partyName ? parties.get(n.partyName) : undefined);

      const values: TxnInsert[] = norms.map((n) => ({
        organizationId: orgId,
        type: n.type,
        txnDate: n.txnDate,
        description: n.description,
        categoryId: n.categoryId,
        partyId: partyOf(n)?.partyId ?? null,
        settleEmployeeId: n.settleEmployeeName ? (employeeId.get(n.settleEmployeeName) ?? null) : null,
        projectId: n.projectId,
        contractId: n.contractId,
        subscriptionId: n.subscriptionId,
        subscriptionPeriod: n.subscriptionPeriod,
        billingItemId: n.billingItemId,
        amount: n.amount,
        currency: n.currency,
        amountTwd: n.currency === "TWD" ? n.amount : null,
        fromAccountId: n.fromAccountId,
        toAccountId: n.toAccountId,
        book: n.reported ? "both" : "internal",
        billedToCompanyTaxId: n.billedToCompanyTaxId,
      }));
      // 一次 insert 全部（chunkSize = 筆數），維持「整批成功或整批失敗」。
      const inserted = await insertTransactions({ db, orgId, source: "mcp" }, values, {
        chunkSize: values.length,
      });
      // 合約以實際寫進去的為準（含從請款項 / 訂閱繼承、或比對到的）。
      const linkedContractIds = inserted
        .map((r) => r.row.contractId)
        .filter((id): id is number => id !== null);
      const contractProgress = await getContractProgress(db, orgId, linkedContractIds);
      return {
        created: inserted.length,
        ids: inserted.map((r) => r.row.id),
        results: inserted.map((r, i) => {
          const party = partyOf(norms[i]);
          return { id: r.row.id, ...linkOutput(r.report, party?.created ? party.similar : []) };
        }),
        ...(contractProgress.length ? { contractProgress } : {}),
      };
    },
  },

  update_transaction: {
    description:
      "Edit a transaction's date, amount, currency, description, category (categoryId 0 clears it → 未分類; setting a category also clears needsReview on imported rows), needsReview (待確認 flag on rows imported by e.g. the Wise sync; pass false to confirm a row without choosing a category; a synced Wise currency conversion is a transfer with only one account set — that is expected and it can be edited like any other row), project, contract, subscription, subscription period, billing item (billingItemId; 0 clears it), reported flag, or billedToCompanyTaxId (有報公司統編) — only provided fields change. To change the account or counterparty, delete and recreate, or use the app. If the edit touches a contract-linked transaction, the result carries `contractProgress` for the contracts involved — when an entry is `fullyCollected` while the contract is still draft/active, tell the user and ask whether to set that contract to completed (已完成) via update_contract; never flip the status without asking. Linking a billingItemId / subscriptionId / contractId re-derives the inherited contract and project (values you set yourself are kept)." +
      LINKING_NOTE,
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
        billingItemId: {
          type: "number",
          description: "Link/relink to a billing item (請款項); 0 to unset. Inherits its contract and project.",
        },
        reported: { type: "boolean" },
        billedToCompanyTaxId: { type: "boolean", description: "有報公司統編（進項可扣抵）。" },
        needsReview: {
          type: "boolean",
          description: "待確認 flag of imported rows. false = mark as reviewed. Setting a non-zero categoryId clears it automatically.",
        },
        ...ORG_ARG,
      },
      required: ["id"],
      additionalProperties: false,
    },
    // 整列更新後的交易＋連結報告；有動到合約時才多一個 contractProgress（陣列，因為原本綁的與
    // 改綁的合約可能各算一次）。
    outputSchema: {
      type: "object",
      properties: {
        ...TXN_ROW_PROPS,
        ...LINK_REPORT_PROPS,
        contractProgress: {
          type: "array",
          items: CONTRACT_PROGRESS_SCHEMA,
          description: "The contracts whose progress this edit touched; omitted when none.",
        },
      },
      required: [...TXN_ROW_REQUIRED, ...LINK_REPORT_REQUIRED],
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
          billingItemId: transactions.billingItemId,
          fromAccountId: transactions.fromAccountId,
          toAccountId: transactions.toAccountId,
          externalSource: transactions.externalSource,
        })
        .from(transactions)
        .where(and(eq(transactions.organizationId, orgId), eq(transactions.id, id)))
        .limit(1);
      if (!existing) throw new Error(`Transaction ${id} not found in your organization.`);
      const singleLeg = externalSingleLegSide(existing) !== null;

      const patch: TxnPatch = {};
      if (optDate(args, "txnDate") !== undefined) patch.txnDate = optDate(args, "txnDate");
      if (optString(args, "description") !== undefined)
        patch.description = optString(args, "description");
      if (optBoolean(args, "billedToCompanyTaxId") !== undefined) {
        patch.billedToCompanyTaxId = optBoolean(args, "billedToCompanyTaxId");
      }
      await applyTxnRelationPatch(patch, db, args, orgId);
      // 指定了分類 = 有人看過這筆了；自動匯入（Wise 同步）的「待確認」一併清掉。
      if (typeof patch.categoryId === "number") patch.needsReview = false;
      if (optBoolean(args, "needsReview") !== undefined) {
        patch.needsReview = optBoolean(args, "needsReview");
      }
      applyTxnAmountPatch(patch, args, existing, singleLeg);
      // 這支工具改不了帳戶，但改得了幣別 —— 改完仍要跟原本綁的帳戶對得起來。
      if (typeof patch.currency === "string") {
        await assertAccountCurrency(db, orgId, patch.currency, [
          existing.fromAccountId,
          existing.toAccountId,
        ]);
      }
      // 收款分配（0042）：分配列若只是舊綁定的鏡像（剛好整筆分給同一個目標），先拿掉，這次改的綁定／金額才會生效。
      if (existing.type === "income") await releaseLegacyMirror(db, orgId, id);
      // 經連結層：換了請款項 / 訂閱 / 合約會重新繼承專案與合約；改了金額、日期會重新比對候選。
      const updated = await updateTransactionLinked({ db, orgId, source: "mcp" }, id, patch);
      if (!updated) throw new Error(`Transaction ${id} not found in your organization.`);
      const { row, report } = updated;
      const out = { ...row, ...linkOutput(report) };
      // 進度受影響的合約：原本綁的（可能被解綁或金額變動）＋改綁的新合約，
      // 以及原本／改綁的請款項目所屬的合約（請款項目的已收會累計到它的合約）。
      const itemIds = [existing.billingItemId, row.billingItemId].filter(
        (bid): bid is number => bid != null,
      );
      const itemContracts = itemIds.length
        ? await db
            .select({ contractId: billingItems.contractId })
            .from(billingItems)
            .where(and(eq(billingItems.organizationId, orgId), inArray(billingItems.id, itemIds)))
        : [];
      const touchedContractIds = [
        existing.contractId,
        row.contractId,
        ...itemContracts.map((r) => r.contractId),
      ].filter((cid): cid is number => cid != null);
      const contractProgress = await getContractProgress(db, orgId, touchedContractIds);
      return contractProgress.length ? { ...out, contractProgress } : out;
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
    outputSchema: {
      type: "object",
      properties: {
        deleted: { type: "boolean" },
        id: { type: "number" },
      },
      required: ["deleted", "id"],
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
      await updateTransactionsPlainByIds(db, orgId, [id], { deletedAt });
      return { deleted: true, id };
    },
  },

  create_reimbursement: {
    description:
      "Record that an employee advance (代墊) has been repaid: writes a reimbursement entry in the ledger linked to the original advance. Bookkeeping only — it does not send the employee any money; do that through your bank and record it here. Find the advance via list_outstanding_advances. The reimbursement inherits the advance's project and contract; `links` / `hints` report them (ask before changing any contract/project status).",
    inputSchema: {
      type: "object",
      properties: {
        advanceId: { type: "number", description: "The advance transaction id." },
        fromAccountId: { type: "number", description: "Ledger account the repayment is booked against." },
        payDate: { type: "string", description: "YYYY-MM-DD." },
        amount: { type: "number" },
        toEmployeeAccountId: {
          type: "number",
          description:
            "Optional: which of the employee's bank accounts the repayment went into (see list_employee_bank_accounts). Defaults to the employee's reimbursement-default account when omitted. Must belong to the advance's employee and be active.",
        },
        ...ORG_ARG,
      },
      required: ["advanceId", "fromAccountId", "payDate", "amount"],
      additionalProperties: false,
    },
    // 回的是新建的那一列（type='reimbursement'，relatedToId 指回原代墊）。
    outputSchema: {
      type: "object",
      properties: { ...TXN_ROW_PROPS, ...LINK_REPORT_PROPS, paidToAccount: PAYOUT_ACCOUNT_SCHEMA },
      required: [...TXN_ROW_REQUIRED, ...LINK_REPORT_REQUIRED, "paidToAccount"],
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
      // 匯入代墊人的哪個帳戶：有指定就驗歸屬與啟用，沒指定就用報銷預設（可能沒有）。
      const payout = await resolvePayoutAccount(
        orgId,
        adv.settleEmployeeId,
        "reimbursement",
        optNumber(args, "toEmployeeAccountId") ?? null,
      );
      // relatedToId 指回原代墊：連結層讓撥款繼承代墊的專案與合約。
      const { row, report } = await insertTransaction(
        { db, orgId, source: "reimbursement" },
        {
          organizationId: orgId,
          type: "reimbursement",
          txnDate: payDate,
          settleEmployeeId: adv.settleEmployeeId,
          settleToAccountId: payout?.id ?? null,
          amount,
          currency,
          amountTwd: currency === "TWD" ? amount : null,
          fromAccountId,
          book: "internal",
          relatedToId: advanceId,
          description: "撥款還代墊",
        },
      );
      return { ...row, ...linkOutput(report), paidToAccount: payoutAccountOutput(payout) };
    },
  },
};

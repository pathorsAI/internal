/**
 * 收款分配（migrations/0043）的 MCP 工具：set_payment_allocations（整組替換）與
 * list_payment_allocations（依交易／目標／期間列出）。規則見 src/lib/payment-allocation.ts，
 * 檢查與寫入跟網頁的「分配收款」Sheet 共用 src/db/allocations.ts。
 */
import { and, inArray, isNull, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { billingItems, subscriptions } from "@/db/schema";
import {
  listEffectiveAllocations,
  replaceTransactionAllocations,
  type EffectiveAllocationRow,
} from "@/db/allocations";
import { getSubscriptionSchedule, listBillingBoard } from "@/db/queries";
import { collectionProgress } from "@/lib/tax-amounts";
import {
  targetKey,
  type AllocationInput,
  type AllocationTarget,
} from "@/lib/payment-allocation";
import {
  getContractProgress,
  optDate,
  optNumber,
  optString,
  ORG_ARG,
  requireNumber,
  resolveOrg,
  type JsonSchemaObject,
  type ToolDef,
} from "./shared";
import { CONTRACT_PROGRESS_SCHEMA } from "./tools-transactions";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** 一個 allocation 物件（MCP 參數）→ 目標。三選一，不多不少。 */
function targetOfArg(a: Record<string, unknown>, i: number): AllocationTarget {
  const subscriptionId = optNumber(a, "subscriptionId");
  const period = optString(a, "subscriptionPeriod");
  const billingItemId = optNumber(a, "billingItemId");
  const contractId = optNumber(a, "contractId");
  const kinds = [subscriptionId !== undefined || period !== undefined, billingItemId !== undefined, contractId !== undefined];
  if (kinds.filter(Boolean).length !== 1) {
    throw new Error(
      `allocations[${i}] needs exactly one target: subscriptionId + subscriptionPeriod, billingItemId, or contractId.`,
    );
  }
  if (subscriptionId !== undefined || period !== undefined) {
    if (subscriptionId === undefined || period === undefined) {
      throw new Error(`allocations[${i}]: subscriptionId and subscriptionPeriod go together.`);
    }
    return { type: "subscription_period", subscriptionId, period };
  }
  if (billingItemId !== undefined) return { type: "billing_item", billingItemId };
  return { type: "contract", contractId: contractId as number };
}

function parseAllocations(raw: unknown): AllocationInput[] {
  if (!Array.isArray(raw)) throw new Error(`"allocations" must be an array (use [] to clear).`);
  return raw.map((item, i) => {
    if (!item || typeof item !== "object") throw new Error(`allocations[${i}] must be an object.`);
    const a = item as Record<string, unknown>;
    return {
      target: targetOfArg(a, i),
      amount: requireNumber(a, "amount"),
      fee: optNumber(a, "fee") ?? 0,
      note: optString(a, "note") ?? null,
    };
  });
}

function rowTargetKey(r: EffectiveAllocationRow): string | null {
  if (r.targetType === "subscription_period" && r.subscriptionId != null && r.subscriptionPeriod) {
    return targetKey({ type: "subscription_period", subscriptionId: r.subscriptionId, period: r.subscriptionPeriod });
  }
  if (r.targetType === "billing_item" && r.billingItemId != null) {
    return targetKey({ type: "billing_item", billingItemId: r.billingItemId });
  }
  if (r.targetType === "contract" && r.contractId != null) {
    return targetKey({ type: "contract", contractId: r.contractId });
  }
  return null;
}

type TargetProgress = {
  key: string;
  targetType: "subscription_period" | "billing_item" | "contract";
  title: string;
  currency: string;
  expected: number | null;
  paid: number;
  feeAbsorbed: number;
  remaining: number | null;
  fullyCollected: boolean;
  status: string;
};

type Db = ReturnType<typeof getDb>;

/** targetKey 依種類分組：請款項目、訂閱（各要哪幾期）、直接分給的合約。 */
function groupKeys(keys: Set<string>) {
  const itemIds: number[] = [];
  const subPeriods = new Map<number, Set<string>>();
  const directContracts: number[] = [];
  for (const k of keys) {
    const [kind, a, b] = k.split(":");
    if (kind === "bi") itemIds.push(Number(a));
    else if (kind === "sub") subPeriods.set(Number(a), (subPeriods.get(Number(a)) ?? new Set()).add(b));
    else if (kind === "c") directContracts.push(Number(a));
  }
  return { itemIds, subPeriods, directContracts };
}

function itemContractIds(db: Db, orgId: string, itemIds: number[]) {
  if (!itemIds.length) return Promise.resolve([]);
  return db
    .select({ contractId: billingItems.contractId })
    .from(billingItems)
    .where(and(eq(billingItems.organizationId, orgId), inArray(billingItems.id, itemIds)));
}

function subscriptionContractIds(db: Db, orgId: string, subscriptionIds: number[]) {
  if (!subscriptionIds.length) return Promise.resolve([]);
  return db
    .select({ contractId: subscriptions.contractId })
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.organizationId, orgId),
        inArray(subscriptions.id, subscriptionIds),
        isNull(subscriptions.deletedAt),
      ),
    );
}

function billingItemProgress(
  board: Awaited<ReturnType<typeof listBillingBoard>>,
  keys: Set<string>,
): TargetProgress[] {
  const out: TargetProgress[] = [];
  for (const r of board) {
    if (r.billingItemId == null || !keys.has(r.key)) continue;
    const { remaining, fullyCollected } = collectionProgress(r.expected, r.paid);
    out.push({
      key: r.key,
      targetType: "billing_item",
      title: r.title,
      currency: r.currency,
      expected: r.expected,
      paid: r.paid,
      feeAbsorbed: r.feeAbsorbed,
      remaining,
      fullyCollected,
      status: r.status,
    });
  }
  return out;
}

function subscriptionPeriodProgress(
  schedules: Awaited<ReturnType<typeof getSubscriptionSchedule>>[],
  subPeriods: Map<number, Set<string>>,
): TargetProgress[] {
  const out: TargetProgress[] = [];
  for (const s of schedules) {
    if (!s) continue;
    const wanted = subPeriods.get(s.id);
    for (const p of s.periods) {
      if (!wanted?.has(p.periodStart)) continue;
      const { remaining, fullyCollected } = collectionProgress(p.expected, p.paid);
      out.push({
        key: `sub:${s.id}:${p.periodStart}`,
        targetType: "subscription_period",
        title: `${s.name} (${p.periodLabel})`,
        currency: s.currency,
        expected: p.expected,
        paid: p.paid,
        feeAbsorbed: p.feeAbsorbed,
        remaining,
        fullyCollected,
        status: p.status,
      });
    }
  }
  return out;
}

function contractTargetProgress(
  contractProgress: Awaited<ReturnType<typeof getContractProgress>>,
  directContracts: number[],
): TargetProgress[] {
  return contractProgress
    .filter((c) => directContracts.includes(c.contractId))
    .map((c) => ({
      key: `c:${c.contractId}`,
      targetType: "contract" as const,
      title: c.title,
      currency: c.currency,
      expected: c.gross,
      paid: c.received,
      feeAbsorbed: c.feeAbsorbed,
      remaining: c.remaining,
      fullyCollected: c.fullyCollected,
      status: c.status,
    }));
}

/** 這次寫入前後碰到的應收，各自最新的收款進度；合約另外回 contractProgress（含 action 提示）。 */
async function progressOf(orgId: string, keys: Set<string>) {
  const db = getDb();
  const { itemIds, subPeriods, directContracts } = groupKeys(keys);
  const subscriptionIds = [...subPeriods.keys()];

  const [board, schedules, itemContracts, subContracts] = await Promise.all([
    itemIds.length ? listBillingBoard(orgId, { includeAllHistory: true }) : Promise.resolve([]),
    Promise.all(subscriptionIds.map((id) => getSubscriptionSchedule(orgId, id))),
    itemContractIds(db, orgId, itemIds),
    subscriptionContractIds(db, orgId, subscriptionIds),
  ]);

  const contractIds = [
    ...directContracts,
    ...itemContracts.map((r) => r.contractId),
    ...subContracts.map((r) => r.contractId),
  ].filter((id): id is number => id != null);
  const contractProgress = await getContractProgress(db, orgId, contractIds);
  const targets: TargetProgress[] = [
    ...billingItemProgress(board, keys),
    ...subscriptionPeriodProgress(schedules, subPeriods),
    ...contractTargetProgress(contractProgress, directContracts),
  ];
  return { targets, contractProgress };
}

const TARGET_PROPS = {
  targetType: { type: "string", enum: ["subscription_period", "billing_item", "contract"] },
  subscriptionId: { type: ["number", "null"] },
  subscriptionPeriod: { type: ["string", "null"], description: "Period start, YYYY-MM-DD." },
  billingItemId: { type: ["number", "null"] },
  contractId: { type: ["number", "null"] },
};

const STORED_ALLOCATION_ROW: JsonSchemaObject = {
  type: "object",
  properties: {
    id: { type: "number" },
    ...TARGET_PROPS,
    amount: { type: "number", description: "Money from this payment allocated to the target." },
    fee: { type: "number", description: "Absorbed bank fee / FX shortfall for this target (not money)." },
    note: { type: ["string", "null"] },
  },
  required: ["id", ...Object.keys(TARGET_PROPS), "amount", "fee", "note"],
  additionalProperties: false,
};

const TARGET_PROGRESS_ROW: JsonSchemaObject = {
  type: "object",
  properties: {
    key: { type: "string", description: "`sub:<id>:<period>` | `bi:<id>` | `c:<id>`." },
    targetType: TARGET_PROPS.targetType,
    title: { type: "string" },
    currency: { type: "string" },
    expected: { type: ["number", "null"], description: "Gross receivable (含稅); null for a contract without an amount." },
    paid: { type: "number", description: "已收 incl. absorbed fees." },
    feeAbsorbed: { type: "number" },
    remaining: { type: ["number", "null"], description: "expected − paid." },
    fullyCollected: { type: "boolean" },
    status: { type: "string", description: "Board / period status, or the contract's stored status." },
  },
  required: [
    "key",
    "targetType",
    "title",
    "currency",
    "expected",
    "paid",
    "feeAbsorbed",
    "remaining",
    "fullyCollected",
    "status",
  ],
  additionalProperties: false,
};


const ABSORBED_FEES = {
  type: "array",
  items: {
    type: "object",
    properties: { currency: { type: "string" }, total: { type: "number" } },
    required: ["currency", "total"],
    additionalProperties: false,
  },
};

const LIST_ROW: JsonSchemaObject = {
  type: "object",
  properties: {
    id: { type: ["number", "null"], description: "Allocation row id; null for a legacy single binding." },
    source: {
      type: "string",
      enum: ["allocation", "legacy"],
      description:
        "allocation = a stored allocation row; legacy = an income transaction with no allocations, counted in full through its single binding.",
    },
    transactionId: { type: "number" },
    txnDate: { type: "string" },
    currency: { type: "string" },
    book: { type: "string", enum: ["both", "internal", "external"] },
    ...TARGET_PROPS,
    amount: { type: "number" },
    fee: { type: "number" },
    note: { type: ["string", "null"] },
  },
  required: [
    "id",
    "source",
    "transactionId",
    "txnDate",
    "currency",
    "book",
    ...Object.keys(TARGET_PROPS),
    "amount",
    "fee",
    "note",
  ],
  additionalProperties: false,
};

const ALLOCATION_ARG = {
  type: "object",
  properties: {
    subscriptionId: { type: "number", description: "With subscriptionPeriod: a subscription period." },
    subscriptionPeriod: { type: "string", description: "Period start YYYY-MM-DD (from get_subscription_schedule)." },
    billingItemId: { type: "number", description: "A billing item (contract instalment / milestone / one-off charge)." },
    contractId: { type: "number", description: "Directly on a contract, when it has no matching billing item." },
    amount: { type: "number", description: "Money from this payment for this receivable (≥ 0, same currency)." },
    fee: {
      type: "number",
      description:
        "Absorbed shortfall for this receivable (bank fee / FX), ≥ 0. Not money: an agreed 少收 that counts toward collection. Default 0.",
    },
    note: { type: "string" },
  },
  required: ["amount"],
  additionalProperties: false,
};

export const allocationTools: Record<string, ToolDef> = {
  set_payment_allocations: {
    description:
      "Split one income transaction across several receivables, replacing its whole allocation set. Each allocation names exactly one target — a subscription period (subscriptionId + subscriptionPeriod), a billing item (billingItemId) or a contract (contractId) — in the transaction's currency, with `amount` (money from this payment) and optional `fee`. `fee` is NOT money: it is an agreed shortfall (the bank deducted a remittance fee, or FX left it a little short) that we absorb, so the receivable counts as collected — collected = Σ(amount + fee), compared with the gross (含稅) receivable. Σ amount must not exceed the transaction amount; fees don't count toward that limit. Example: a customer is billed 13,001.04 (period 4,000 + build instalment 6,000 + usage 3,001.04) and pays 12,935.62 → allocate 4,000 / 6,000 / 2,935.62 with fee 65.42 on the usage line, and all three are collected. Pass `allocations: []` to clear; the transaction then counts in full through its single contractId / billingItemId / subscription period binding again. Once a transaction has allocations, its single binding fields are ignored for collection. Returns the stored allocations and the updated progress of every receivable touched (before and after), plus `contractProgress` — when a contract comes back fullyCollected while still draft/active, ask the user before closing it with update_contract.",
    inputSchema: {
      type: "object",
      properties: {
        transactionId: { type: "number", description: "An income transaction." },
        allocations: { type: "array", items: ALLOCATION_ARG, description: "The full new set; [] clears." },
        ...ORG_ARG,
      },
      required: ["transactionId", "allocations"],
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        id: { type: "number", description: "The transaction id." },
        transactionId: { type: "number" },
        allocations: { type: "array", items: STORED_ALLOCATION_ROW },
        allocated: { type: "number", description: "Σ amount." },
        absorbedFees: { type: "number", description: "Σ fee." },
        targets: { type: "array", items: TARGET_PROGRESS_ROW },
        contractProgress: { type: "array", items: CONTRACT_PROGRESS_SCHEMA },
      },
      required: ["id", "transactionId", "allocations", "allocated", "absorbedFees", "targets", "contractProgress"],
      additionalProperties: false,
    },
    execute: async (args, ctx) => {
      const orgId = await resolveOrg(args, ctx);
      const transactionId = requireNumber(args, "transactionId");
      const inputs = parseAllocations(args.allocations);
      const before = await listEffectiveAllocations(orgId, { transactionId });
      const stored = await replaceTransactionAllocations(orgId, transactionId, inputs, ctx.userId);
      const keys = new Set<string>();
      for (const r of before) {
        const k = rowTargetKey(r);
        if (k) keys.add(k);
      }
      for (const a of inputs) keys.add(targetKey(a.target));
      const { targets, contractProgress } = await progressOf(orgId, keys);
      return {
        id: transactionId,
        transactionId,
        allocations: stored.map((a) => ({
          id: a.id,
          targetType: a.target.type,
          subscriptionId: a.target.type === "subscription_period" ? a.target.subscriptionId : null,
          subscriptionPeriod: a.target.type === "subscription_period" ? a.target.period : null,
          billingItemId: a.target.type === "billing_item" ? a.target.billingItemId : null,
          contractId: a.target.type === "contract" ? a.target.contractId : null,
          amount: a.amount,
          fee: a.fee,
          note: a.note ?? null,
        })),
        allocated: round2(stored.reduce((s, a) => s + a.amount, 0)),
        absorbedFees: round2(stored.reduce((s, a) => s + a.fee, 0)),
        targets,
        contractProgress,
      };
    },
  },

  list_payment_allocations: {
    description:
      "List effective payment allocations: how income transactions are split across receivables, including each line's absorbed `fee` (bank fee / FX shortfall, not money). Filter by `transactionId`, by one target (subscriptionId + subscriptionPeriod | billingItemId | contractId — direct allocations to that target only; a contract's billing items and subscription periods are separate targets), and/or by transaction date range `from` / `to`. At least one filter is required. Rows with source='legacy' are income transactions with no allocations, counted in full through their single binding (fee 0). `absorbedFees` totals the fees of the returned rows per currency; for the 管理帳 figure keep only rows whose book is both/internal.",
    inputSchema: {
      type: "object",
      properties: {
        transactionId: { type: "number" },
        subscriptionId: { type: "number" },
        subscriptionPeriod: { type: "string", description: "YYYY-MM-DD; with subscriptionId." },
        billingItemId: { type: "number" },
        contractId: { type: "number" },
        from: { type: "string", description: "Transaction date ≥ this (YYYY-MM-DD)." },
        to: { type: "string", description: "Transaction date ≤ this (YYYY-MM-DD)." },
        limit: { type: "number", description: "Max rows, default 500, max 2000." },
        ...ORG_ARG,
      },
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        items: { type: "array", items: LIST_ROW },
        count: { type: "number" },
        absorbedFees: { ...ABSORBED_FEES, description: "Σ fee of the returned rows, per currency." },
      },
      required: ["items", "count", "absorbedFees"],
      additionalProperties: false,
    },
    execute: async (args, ctx) => {
      const orgId = await resolveOrg(args, ctx);
      const transactionId = optNumber(args, "transactionId");
      const subscriptionId = optNumber(args, "subscriptionId");
      const subscriptionPeriod = optDate(args, "subscriptionPeriod");
      const billingItemId = optNumber(args, "billingItemId");
      const contractId = optNumber(args, "contractId");
      const from = optDate(args, "from");
      const to = optDate(args, "to");
      let target: AllocationTarget | undefined;
      const targetCount = [subscriptionId !== undefined, billingItemId !== undefined, contractId !== undefined].filter(Boolean).length;
      if (targetCount > 1) throw new Error("Pass at most one target (subscription period, billing item or contract).");
      if (subscriptionId !== undefined) {
        if (!subscriptionPeriod) throw new Error(`"subscriptionPeriod" is required with subscriptionId.`);
        target = { type: "subscription_period", subscriptionId, period: subscriptionPeriod };
      } else if (billingItemId !== undefined) {
        target = { type: "billing_item", billingItemId };
      } else if (contractId !== undefined) {
        target = { type: "contract", contractId };
      }
      if (transactionId === undefined && !target && !from && !to) {
        throw new Error("Pass transactionId, a target, or a from/to date range.");
      }
      const rows = await listEffectiveAllocations(orgId, {
        transactionId,
        target,
        from,
        to,
        limit: optNumber(args, "limit"),
      });
      const fees = new Map<string, number>();
      for (const r of rows) {
        if (r.fee > 0) fees.set(r.currency, round2((fees.get(r.currency) ?? 0) + r.fee));
      }
      return {
        items: rows,
        count: rows.length,
        absorbedFees: [...fees].map(([currency, total]) => ({ currency, total })),
      };
    },
  },
};

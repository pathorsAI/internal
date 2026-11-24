import { addMonths, format, isAfter, isBefore, parseISO } from "date-fns";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { contracts } from "@/db/schema";
import { contractCollected } from "@/db/allocations";
import { resolveOrgId } from "./org";
import { getOrgTaxSetting } from "@/db/org-tax";
import { collectionProgress, effectiveTaxSetting, taxedAmountOrNull } from "@/lib/tax-amounts";
import type { AmountBasis, TaxTreatment } from "@/lib/tax-treatment";

/** 用 API key 呼叫時才有：金鑰綁定的組織與權限範圍（src/lib/api-keys.ts）。 */
export type ToolApiKey = {
  id: number;
  name: string;
  organizationId: string;
  scope: "read" | "write";
};

/**
 * 工具執行時的身分。OAuth MCP / 站內 AI：userId = 登入的成員。API key：userId = 金鑰建立者，
 * apiKey 帶著金鑰本身 —— 組織被鎖在金鑰的組織（resolveOrg），scope = read 只能跑 [read] 工具
 * （handler 的 runToolWithAudit）。
 */
export type ToolContext = { userId: string; orgHint?: string; apiKey?: ToolApiKey };

export type ToolAnnotations = {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  // True only when the tool can change *publicly visible* internet state
  // (posting publicly, mailing external recipients, pushing to a third party).
  // Writes that stay inside this org's own data are `false`. Required by the
  // OpenAI plugin review; see docs/mcp.md.
  openWorldHint?: boolean;
};

export type JsonSchemaObject = {
  type: "object";
  properties?: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
  [key: string]: unknown;
};

export type ToolDef = {
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties: boolean;
  };
  // JSON Schema for the tool's return value. The handler advertises it on
  // tools/list AND mirrors the result into `structuredContent`, which MCP
  // requires to validate against it — so the schema is a promise, and it must
  // be derived from what `execute` actually returns (optional and nullable
  // fields included). Only object-rooted results can carry one; list tools get
  // there via `listResult` / `listSchema`. Every tool on this server declares
  // one; a new tool without a stable object-rooted shape may omit it and will
  // simply keep the JSON-in-a-text-block result shape.
  outputSchema?: JsonSchemaObject;
  // Optional override; otherwise derived from the tool's verb in the handler.
  annotations?: ToolAnnotations;
  execute: (args: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>;
};

// ---- list results ----

/**
 * The object root every list_* tool returns.
 *
 * MCP only mirrors a result into `structuredContent` when it is an object, so a
 * tool that answered with a bare array could never declare an `outputSchema`.
 * Wrapping the rows in `{ items, count }` is what lets every tool on this
 * server publish one. Pair it with `listSchema(itemSchema)`.
 */
export function listResult<T>(items: T[]): { items: T[]; count: number } {
  return { items, count: items.length };
}

/** The `outputSchema` matching `listResult`, given the schema of one row. */
export function listSchema(item: Record<string, unknown>): JsonSchemaObject {
  return {
    type: "object",
    properties: {
      items: { type: "array", items: item },
      count: { type: "number", description: "Number of rows in `items`." },
    },
    required: ["items", "count"],
    additionalProperties: false,
  };
}

/** A closed object schema whose every declared property is always present. */
export function rowSchema(properties: Record<string, unknown>): JsonSchemaObject {
  return {
    type: "object",
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  };
}

// ---- 營業稅別（migrations/0040、src/lib/tax-treatment.ts） ----

export const TAX_TREATMENT_ENUM = ["taxable", "zero_rated", "exempt", "none"] as const;
export const AMOUNT_BASIS_ENUM = ["net", "gross"] as const;

/** 列表工具回的有效稅別兩欄（已解析過沿用，永遠有值）。 */
export const EFFECTIVE_TAX_PROPS = {
  taxTreatment: {
    type: "string",
    enum: [...TAX_TREATMENT_ENUM],
    description:
      "Effective 營業稅別 (resolved: bound contract → own field → org default). taxable = 應稅 5%, zero_rated = 零稅率, exempt = 免稅, none = 不加收營業稅.",
  },
  amountBasis: {
    type: "string",
    enum: [...AMOUNT_BASIS_ENUM],
    description: "Effective basis of `amount`: net = 未稅 (tax is added on top), gross = 含稅 (tax is inside).",
  },
} as const;

/** net / tax / gross 三個數字（金額可為 null 時用 nullable）。 */
export function taxBreakdownProps(nullable = false) {
  const type = nullable ? ["number", "null"] : "number";
  return {
    net: { type, description: "未稅 — use this for revenue estimates." },
    tax: { type, description: "稅額 (5% when taxable, else 0)." },
    gross: { type, description: "含稅應收 — what the customer actually pays; compare received income against this." },
  };
}

/** 整列 `.returning()` 時那兩欄的原樣（NULL = 沿用）。 */
export const STORED_TAX_PROPS = {
  taxTreatment: {
    type: ["string", "null"],
    enum: [...TAX_TREATMENT_ENUM, null],
    description: "Stored 營業稅別; null = inherit (bound contract, else org default).",
  },
  amountBasis: {
    type: ["string", "null"],
    enum: [...AMOUNT_BASIS_ENUM, null],
    description: "Stored amount basis; null = inherit.",
  },
} as const;

/** create_/update_ 的稅別輸入參數。 */
export const TAX_INPUT_PROPS = {
  taxTreatment: {
    type: ["string", "null"],
    enum: [...TAX_TREATMENT_ENUM, null],
    description:
      "營業稅別: taxable (應稅 5%) | zero_rated (零稅率) | exempt (免稅) | none (不加收營業稅). Omit or null to inherit — the bound contract's setting if a contract is linked, otherwise the organization default.",
  },
  amountBasis: {
    type: ["string", "null"],
    enum: [...AMOUNT_BASIS_ENUM, null],
    description:
      "Whether `amount` is net (未稅, default) or gross (含稅). `amount` is net unless amountBasis=gross. Omit or null to inherit (contract if bound, else org default).",
  },
} as const;

/**
 * 讀 create/update 的稅別參數：沒帶這個 key → undefined（不動）；明確 null 或空字串 → null（沿用）；
 * 其他值必須在 enum 內。
 */
export function optTaxArgs(args: Record<string, unknown>): {
  taxTreatment?: string | null;
  amountBasis?: string | null;
} {
  const out: { taxTreatment?: string | null; amountBasis?: string | null } = {};
  const read = (key: "taxTreatment" | "amountBasis", allowed: readonly string[]) => {
    if (!(key in args) || args[key] === undefined) return;
    const v = args[key];
    if (v === null || v === "") {
      out[key] = null;
      return;
    }
    if (typeof v !== "string" || !allowed.includes(v)) {
      throw new Error(`"${key}" must be one of: ${allowed.join(", ")} (or null to inherit).`);
    }
    out[key] = v;
  };
  read("taxTreatment", TAX_TREATMENT_ENUM);
  read("amountBasis", AMOUNT_BASIS_ENUM);
  return out;
}

// ---- arg helpers (lightweight validation, no extra deps) ----

export function optString(
  args: Record<string, unknown>,
  key: string,
): string | undefined {
  const v = args[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string") throw new Error(`"${key}" must be a string.`);
  const t = v.trim();
  return t === "" ? undefined : t;
}

export function requireString(args: Record<string, unknown>, key: string): string {
  const v = optString(args, key);
  if (v === undefined) throw new Error(`"${key}" is required.`);
  return v;
}

export function requireNumber(args: Record<string, unknown>, key: string): number {
  const v = args[key];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) {
    return Number(v);
  }
  throw new Error(`"${key}" is required and must be a number.`);
}

export function optNumber(
  args: Record<string, unknown>,
  key: string,
): number | undefined {
  const v = args[key];
  if (v === undefined || v === null) return undefined;
  return requireNumber(args, key);
}

export function optBoolean(
  args: Record<string, unknown>,
  key: string,
): boolean | undefined {
  const v = args[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v === "boolean") return v;
  if (v === "true") return true;
  if (v === "false") return false;
  throw new Error(`"${key}" must be a boolean.`);
}

/** A decimal stored as a numeric string; any finite value (incl. negative/zero). */
export function requireDecimal(args: Record<string, unknown>, key: string): string {
  return requireNumber(args, key).toString();
}

export function optDecimal(
  args: Record<string, unknown>,
  key: string,
): string | undefined {
  const n = optNumber(args, key);
  return n === undefined ? undefined : n.toString();
}

/** A positive amount (> 0) as a numeric string. */
export function requireAmount(args: Record<string, unknown>, key: string): string {
  const n = requireNumber(args, key);
  if (n <= 0) throw new Error(`"${key}" must be greater than 0.`);
  return n.toString();
}

export function normalizeCurrency(
  args: Record<string, unknown>,
  key = "currency",
  fallback = "TWD",
): string {
  const c = (optString(args, key) ?? fallback).toUpperCase();
  if (c.length !== 3) {
    throw new Error(`"${key}" must be a 3-letter code (e.g. TWD, USD).`);
  }
  return c;
}

export function optDate(
  args: Record<string, unknown>,
  key: string,
): string | undefined {
  const v = optString(args, key);
  if (v === undefined) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    throw new Error(`"${key}" must be an ISO date (YYYY-MM-DD).`);
  }
  return v;
}

export function requireDate(args: Record<string, unknown>, key: string): string {
  const v = optDate(args, key);
  if (v === undefined) throw new Error(`"${key}" is required (YYYY-MM-DD).`);
  return v;
}

export function todayStr(): string {
  return format(new Date(), "yyyy-MM-dd");
}

/** Next charge date for a subscription on or after `fromStr`, or null if ended. */
export function nextChargeDate(
  startStr: string,
  intervalMonths: number,
  fromStr: string,
  endStr: string | null,
): string | null {
  if (!startStr || !intervalMonths || intervalMonths < 1) return null;
  const from = parseISO(fromStr);
  let d = parseISO(startStr);
  let guard = 0;
  while (isBefore(d, from) && guard < 1000) {
    d = addMonths(d, intervalMonths);
    guard++;
  }
  if (endStr && isAfter(d, parseISO(endStr))) return null;
  return format(d, "yyyy-MM-dd");
}

export const ORG_ARG = {
  organizationId: {
    type: "string",
    description:
      "Which organization to act on (id or slug). Only needed if you belong to multiple orgs; otherwise defaults to your org. Use list_organizations to discover values.",
  },
} as const;

/**
 * Resolve the target org from the tool args (organizationId) or the connection's ?org hint.
 * An API key is bound to one organization: the arg may name it (id or slug) but never another.
 */
export async function resolveOrg(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<string> {
  if (ctx.apiKey) {
    const requested = optString(args, "organizationId");
    const orgId = await resolveOrgId(ctx.userId, requested ?? ctx.apiKey.organizationId);
    if (orgId !== ctx.apiKey.organizationId) {
      throw new Error("This API key belongs to a different organization. Create a key in that organization instead.");
    }
    return orgId;
  }
  return resolveOrgId(ctx.userId, optString(args, "organizationId") ?? ctx.orgHint);
}

/**
 * Ensure a foreign-key id belongs to the caller's org before it is used. DB
 * FK constraints alone are NOT enough — a valid id from ANOTHER org would pass
 * the constraint and leak across tenants. `table` must have id + organizationId.
 */
export async function assertInOrg(
  db: ReturnType<typeof getDb>,
  // Drizzle table; typed loosely so one helper works for every entity.
  table: { id: unknown; organizationId: unknown },
  id: number,
  orgId: string,
  label: string,
): Promise<void> {
  const t = table as { id: never; organizationId: never };
  const rows = await db
    .select({ id: t.id })
    .from(t as never)
    .where(and(eq(t.id, id as never), eq(t.organizationId, orgId as never)))
    .limit(1);
  if (!rows[0]) throw new Error(`${label} ${id} not found in your organization.`);
}

export type ContractProgress = {
  contractId: number;
  title: string;
  status: string;
  currency: string;
  /** 合約金額原樣（基準看 amountBasis） */
  amount: number | null;
  net: number | null;
  tax: number | null;
  /** 含稅應收：收齊判斷拿這個比 */
  gross: number | null;
  taxTreatment: TaxTreatment;
  amountBasis: AmountBasis;
  /** 已收（含吸收的手續費），來自有效收款分配 */
  received: number;
  /** received 裡「同意少收」的手續費／匯差 */
  feeAbsorbed: number;
  /** gross − received */
  remaining: number | null;
  fullyCollected: boolean;
  /** Present only when the contract is collected in full but still open. */
  action?: string;
};

const OPEN_CONTRACT_STATUS = new Set(["draft", "active"]);

/**
 * Collection progress for the given contracts — the same rule list_contracts
 * uses: effective payment allocations (src/db/allocations.ts) to the contract,
 * its billing items and the periods of subscriptions bound to it, same currency
 * only, absorbed fees included. Returned by the transaction / allocation tools so
 * that a payment which fills a contract surfaces "已收滿" right where it happens —
 * otherwise a fully-collected contract silently stays 進行中 until someone
 * happens to run list_contracts. Status is never changed automatically; the
 * `action` hint asks the caller to confirm with the user first.
 */
export async function getContractProgress(
  db: ReturnType<typeof getDb>,
  orgId: string,
  contractIds: number[],
): Promise<ContractProgress[]> {
  const ids = [...new Set(contractIds)];
  if (ids.length === 0) return [];
  const [orgTax, rows, collected] = await Promise.all([
    getOrgTaxSetting(orgId),
    db
      .select({
        contractId: contracts.id,
        title: contracts.title,
        status: contracts.status,
        currency: contracts.currency,
        amount: contracts.amount,
        taxTreatment: contracts.taxTreatment,
        amountBasis: contracts.amountBasis,
      })
      .from(contracts)
      .where(
        and(
          eq(contracts.organizationId, orgId),
          inArray(contracts.id, ids),
          isNull(contracts.deletedAt),
        ),
      ),
    contractCollected(orgId, ids, db),
  ]);
  return rows.map((r) => {
    const amount = r.amount == null ? null : Number(r.amount);
    const got = collected.get(r.contractId);
    const received = got?.paid ?? 0;
    const taxed = taxedAmountOrNull(
      amount,
      effectiveTaxSetting(orgTax, { taxTreatment: r.taxTreatment, amountBasis: r.amountBasis }),
      r.currency,
    );
    // 入帳是含稅的錢，一律跟含稅應收比；amount 0/未填的合約沒有「收滿」可言，不要誤報。
    const { remaining, fullyCollected } = collectionProgress(taxed.gross, received);
    const progress: ContractProgress = {
      contractId: r.contractId,
      title: r.title,
      status: r.status,
      currency: r.currency,
      amount,
      ...taxed,
      received,
      feeAbsorbed: got?.fee ?? 0,
      remaining,
      fullyCollected,
    };
    if (fullyCollected && OPEN_CONTRACT_STATUS.has(r.status)) {
      progress.action =
        `合約「${r.title}」已收滿（未收 0），但狀態仍是 ${r.status}。` +
        "請告訴使用者這件事，並詢問是否要把合約狀態改成 completed（已完成）；" +
        "得到明確同意後才呼叫 update_contract({ id, status: \"completed\" })，不要自行更改。";
    }
    return progress;
  });
}

/** Map a Postgres FK-violation (23503) to a friendly message; rethrow otherwise. */
export function fkError(e: unknown, friendly: string): Error {
  const err = e as { code?: string; cause?: { code?: string } };
  if (err?.code === "23503" || err?.cause?.code === "23503") {
    return new Error(friendly);
  }
  return e instanceof Error ? e : new Error(String(e));
}

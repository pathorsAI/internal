import { addMonths, format, isAfter, isBefore, parseISO } from "date-fns";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { resolveOrgId } from "./org";

export type ToolContext = { userId: string; orgHint?: string };

export type ToolDef = {
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties: boolean;
  };
  execute: (args: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>;
};

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

/** Resolve the target org from the tool args (organizationId) or the connection's ?org hint. */
export function resolveOrg(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<string> {
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

/** Map a Postgres FK-violation (23503) to a friendly message; rethrow otherwise. */
export function fkError(e: unknown, friendly: string): Error {
  const err = e as { code?: string; cause?: { code?: string } };
  if (err?.code === "23503" || err?.cause?.code === "23503") {
    return new Error(friendly);
  }
  return e instanceof Error ? e : new Error(String(e));
}

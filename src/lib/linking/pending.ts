import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "@/db";
import { parties, transactions } from "@/db/schema";
import { PENDING_REVIEW_REASONS, type LinkCandidate, type LinkKind, type ReviewReason } from "./match";
import type { PendingParty } from "./party";
import type { SimilarParty } from "./party-similarity";
import { reviewMessage } from "./resolve";

/**
 * 待連結（review_reason 在 PENDING_REVIEW_REASONS 裡）的讀取：待連結頁、交易頁的標記、MCP 共用。
 * link_candidates 是 jsonb，讀出來一律重新整理成固定形狀（舊資料或手動改過的欄位不會讓頁面壞掉）。
 */

const KINDS: readonly LinkKind[] = ["billing_item", "subscription", "contract"];

function num(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

export function parseLinkCandidates(json: unknown): LinkCandidate[] {
  const list = (json as { links?: unknown } | null)?.links;
  if (!Array.isArray(list)) return [];
  const out: LinkCandidate[] = [];
  for (const raw of list) {
    const c = raw as Record<string, unknown>;
    const kind = c?.kind as LinkKind;
    const id = num(c?.id);
    if (!KINDS.includes(kind) || id == null) continue;
    out.push({
      kind,
      id,
      label: str(c.label) ?? `#${id}`,
      contractId: num(c.contractId),
      projectId: num(c.projectId),
      subscriptionPeriod: str(c.subscriptionPeriod),
      expected: num(c.expected) ?? 0,
      currency: str(c.currency) ?? "",
      gap: num(c.gap) ?? 0,
      amountMatches: c.amountMatches === true,
    });
  }
  return out;
}

export function parsePendingParty(json: unknown): PendingParty | null {
  const p = (json as { party?: unknown } | null)?.party as Record<string, unknown> | undefined;
  const name = str(p?.name);
  if (!p || !name) return null;
  const candidates: SimilarParty[] = [];
  if (Array.isArray(p.candidates)) {
    for (const raw of p.candidates) {
      const c = raw as Record<string, unknown>;
      const id = num(c?.id);
      if (id == null) continue;
      candidates.push({
        id,
        name: str(c.name) ?? `#${id}`,
        score: num(c.score) ?? 0,
        via: c.via === "alias" ? "alias" : "name",
      });
    }
  }
  return { name, label: str(p.label) ?? "other", candidates };
}

export type PendingLinkRow = {
  id: number;
  txnDate: string;
  type: string;
  amount: string;
  currency: string;
  description: string | null;
  partyId: number | null;
  partyName: string | null;
  reviewReason: ReviewReason;
  message: string;
  candidates: LinkCandidate[];
  party: PendingParty | null;
};

function pendingWhere(orgId: string) {
  return and(
    eq(transactions.organizationId, orgId),
    isNull(transactions.deletedAt),
    inArray(transactions.reviewReason, [...PENDING_REVIEW_REASONS]),
  );
}

/** 待連結的交易，新到舊。 */
export async function listPendingLinks(
  db: Db,
  orgId: string,
  opts: { partyId?: number; limit?: number } = {},
): Promise<PendingLinkRow[]> {
  const rows = await db
    .select({
      id: transactions.id,
      txnDate: transactions.txnDate,
      type: transactions.type,
      amount: transactions.amount,
      currency: transactions.currency,
      description: transactions.description,
      partyId: transactions.partyId,
      partyName: parties.name,
      reviewReason: transactions.reviewReason,
      linkCandidates: transactions.linkCandidates,
    })
    .from(transactions)
    .leftJoin(parties, eq(parties.id, transactions.partyId))
    .where(and(pendingWhere(orgId), opts.partyId ? eq(transactions.partyId, opts.partyId) : undefined))
    .orderBy(desc(transactions.txnDate), desc(transactions.id))
    .limit(Math.min(Math.max(opts.limit ?? 200, 1), 500));
  return rows.map((r) => {
    const reason = r.reviewReason as ReviewReason;
    return {
      id: r.id,
      txnDate: r.txnDate,
      type: r.type,
      amount: r.amount,
      currency: r.currency,
      description: r.description,
      partyId: r.partyId,
      partyName: r.partyName,
      reviewReason: reason,
      message: reviewMessage(reason),
      candidates: parseLinkCandidates(r.linkCandidates),
      party: parsePendingParty(r.linkCandidates),
    };
  });
}

/** 待連結筆數（側欄徽章、交易頁）。 */
export async function countPendingLinks(db: Db, orgId: string): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(transactions)
    .where(pendingWhere(orgId));
  return row?.count ?? 0;
}

/** 這幾筆交易裡哪些在待連結（交易頁的列標記）。 */
export async function pendingLinkIdsAmong(db: Db, orgId: string, ids: readonly number[]): Promise<Set<number>> {
  if (ids.length === 0) return new Set();
  const rows = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(and(pendingWhere(orgId), inArray(transactions.id, [...ids])));
  return new Set(rows.map((r) => r.id));
}

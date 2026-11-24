import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "@/db";
import { billingItems, contracts, parties, subscriptions, transactions } from "@/db/schema";
import { normalizeAliases } from "@/lib/party-aliases";
import type { LinkKind } from "./match";
import { resolvePartyForWrite } from "./party";
import { parseLinkCandidates, parsePendingParty } from "./pending";
import type { LinkSource } from "./resolve";
import { updateTransactionLinked, type InsertResult } from "./write";

/**
 * 處理一筆待連結：選候選掛上、略過、選既有對象、或建立新對象。網頁（待連結頁）與 MCP 共用，
 * 實際寫入一律走 updateTransactionLinked。
 */
export type LinkChoice =
  | { kind: "candidate"; candidateKind: LinkKind; id: number; subscriptionPeriod?: string | null }
  | { kind: "skip" }
  | { kind: "party"; partyId: number; addAlias?: boolean }
  | { kind: "new_party" };

export type LinkChoiceErrorCode =
  | "not_found"
  | "candidate_not_found"
  | "period_required"
  | "party_not_found"
  | "no_pending_party";

const MESSAGES: Record<LinkChoiceErrorCode, string> = {
  not_found: "Transaction not found in your organization.",
  candidate_not_found: "That billing item / subscription / contract was not found in your organization.",
  period_required: "subscriptionPeriod (YYYY-MM-DD, the period start) is required for a subscription not in the candidate list.",
  party_not_found: "Party not found in your organization.",
  no_pending_party: "This transaction has no held counterparty name to create a party from.",
};

export class LinkChoiceError extends Error {
  constructor(public code: LinkChoiceErrorCode) {
    super(MESSAGES[code]);
  }
}

export type LinkChoiceResult = InsertResult & {
  /** 選既有對象時，加到那個對象上的別名（原始名稱）；沒加就是 null */
  aliasAdded: string | null;
  /** 建立新對象時的 id */
  createdPartyId: number | null;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

async function candidateInOrg(db: Db, orgId: string, kind: LinkKind, id: number): Promise<boolean> {
  const table = kind === "billing_item" ? billingItems : kind === "subscription" ? subscriptions : contracts;
  const rows = await db
    .select({ id: table.id })
    .from(table)
    .where(and(eq(table.organizationId, orgId), eq(table.id, id), isNull(table.deletedAt)))
    .limit(1);
  return rows.length > 0;
}

export async function resolvePendingLink(
  db: Db,
  orgId: string,
  id: number,
  choice: LinkChoice,
  source: LinkSource,
): Promise<LinkChoiceResult> {
  const [row] = await db
    .select({ id: transactions.id, linkCandidates: transactions.linkCandidates })
    .from(transactions)
    .where(and(eq(transactions.organizationId, orgId), eq(transactions.id, id), isNull(transactions.deletedAt)))
    .limit(1);
  if (!row) throw new LinkChoiceError("not_found");
  const ctx = { db, orgId, source };

  const done = (r: InsertResult | null, extra: Partial<LinkChoiceResult> = {}): LinkChoiceResult => {
    if (!r) throw new LinkChoiceError("not_found");
    return { ...r, aliasAdded: null, createdPartyId: null, ...extra };
  };

  if (choice.kind === "skip") {
    return done(await updateTransactionLinked(ctx, id, { reviewReason: "link_skipped" }));
  }

  if (choice.kind === "candidate") {
    // 候選清單裡有的直接用（訂閱期別以候選為準）；不在清單裡的要確認是本組織的
    const listed = parseLinkCandidates(row.linkCandidates).find(
      (c) =>
        c.kind === choice.candidateKind &&
        c.id === choice.id &&
        (choice.candidateKind !== "subscription" || !choice.subscriptionPeriod || c.subscriptionPeriod === choice.subscriptionPeriod),
    );
    let period = listed?.subscriptionPeriod ?? choice.subscriptionPeriod ?? null;
    if (!listed) {
      if (!(await candidateInOrg(db, orgId, choice.candidateKind, choice.id))) {
        throw new LinkChoiceError("candidate_not_found");
      }
      if (choice.candidateKind === "subscription" && (!period || !DATE_RE.test(period))) {
        throw new LinkChoiceError("period_required");
      }
    }
    if (choice.candidateKind !== "subscription") period = null;
    const patch =
      choice.candidateKind === "billing_item"
        ? { billingItemId: choice.id }
        : choice.candidateKind === "subscription"
          ? { subscriptionId: choice.id, subscriptionPeriod: period }
          : { contractId: choice.id };
    return done(await updateTransactionLinked(ctx, id, patch));
  }

  const pending = parsePendingParty(row.linkCandidates);

  if (choice.kind === "party") {
    const [party] = await db
      .select({ id: parties.id, name: parties.name, aliases: parties.aliases })
      .from(parties)
      .where(and(eq(parties.organizationId, orgId), eq(parties.id, choice.partyId), isNull(parties.deletedAt)))
      .limit(1);
    if (!party) throw new LinkChoiceError("party_not_found");
    let aliasAdded: string | null = null;
    if (pending && choice.addAlias !== false) {
      const next = normalizeAliases([...party.aliases, pending.name], party.name);
      if (next.length !== party.aliases.length) {
        await db
          .update(parties)
          .set({ aliases: next })
          .where(and(eq(parties.organizationId, orgId), eq(parties.id, party.id)));
        aliasAdded = pending.name;
      }
    }
    const r = await updateTransactionLinked({ ...ctx, autoMatch: true }, id, { partyId: party.id, reviewReason: null });
    return done(r, { aliasAdded });
  }

  // new_party：用暫存的原始名稱建立（同名的已經有了就直接用那一筆）
  if (!pending) throw new LinkChoiceError("no_pending_party");
  const res = await resolvePartyForWrite(db, orgId, pending.name, pending.label, "create");
  if (res.partyId == null) throw new LinkChoiceError("party_not_found");
  const r = await updateTransactionLinked({ ...ctx, autoMatch: true }, id, { partyId: res.partyId, reviewReason: null });
  return done(r, { createdPartyId: res.created ? res.partyId : null });
}

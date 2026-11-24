import { getDb } from "@/db";
import { parties, transactions } from "@/db/schema";
import {
  LinkChoiceError,
  listPendingLinks,
  rescanUnlinkedIncome,
  resolvePendingLink,
  type LinkChoice,
  type LinkKind,
} from "@/lib/linking";
import {
  assertInOrg,
  listResult,
  listSchema,
  optBoolean,
  optNumber,
  ORG_ARG,
  requireNumber,
  resolveOrg,
  rowSchema,
  type JsonSchemaObject,
  type ToolDef,
} from "./shared";

/**
 * 待連結（docs/data-links.md）：收款還沒確定屬於哪一筆請款項 / 訂閱期別 / 合約，或對象名稱跟既有對象
 * 很像、沒有自動新建。寫入一律走連結層（src/lib/linking/choose.ts → updateTransactionLinked）。
 */

const KINDS = ["billing_item", "subscription", "contract"] as const;
const REVIEW_REASONS = ["link_suggested", "link_ambiguous", "link_amount_mismatch", "party_similar", "link_skipped"];

const LINK_CANDIDATE = rowSchema({
  kind: { type: "string", enum: [...KINDS] },
  id: { type: "number", description: "Billing item / subscription / contract id." },
  label: { type: "string" },
  contractId: { type: ["number", "null"], description: "Contract the transaction inherits when linked." },
  projectId: { type: ["number", "null"], description: "Project the transaction inherits when linked." },
  subscriptionPeriod: {
    type: ["string", "null"],
    description: "Subscription candidates only: the period start (YYYY-MM-DD) this payment would count for.",
  },
  expected: { type: "number", description: "Still due on this candidate (amount − already received)." },
  currency: { type: "string" },
  gap: { type: "number", description: "expected − transaction amount; positive = payment is short (often a wire fee)." },
  amountMatches: { type: "boolean", description: "Within the wire-fee tolerance." },
});

const SIMILAR_PARTY = rowSchema({
  id: { type: "number" },
  name: { type: "string" },
  score: { type: "number", description: "0–1 similarity." },
  via: { type: "string", enum: ["name", "alias"] },
});

const PENDING_PARTY = rowSchema({
  name: { type: "string", description: "The raw counterparty name from the source (e.g. Wise)." },
  label: { type: "string" },
  candidates: { type: "array", items: SIMILAR_PARTY },
});

const PENDING_ROW = rowSchema({
  id: { type: "number" },
  txnDate: { type: "string", description: "YYYY-MM-DD." },
  type: { type: "string" },
  amount: { type: "string", description: "Decimal as a string." },
  currency: { type: "string" },
  description: { type: ["string", "null"] },
  partyId: { type: ["number", "null"] },
  partyName: { type: ["string", "null"] },
  reviewReason: { type: "string", enum: REVIEW_REASONS.filter((r) => r !== "link_skipped") },
  message: { type: "string", description: "What the user has to decide." },
  candidates: { type: "array", items: LINK_CANDIDATE },
  party: { anyOf: [PENDING_PARTY, { type: "null" }], description: "party_similar only: the held name and similar parties." },
});

const LINKED_REF: JsonSchemaObject = {
  type: "object",
  properties: {
    kind: { type: "string", enum: [...KINDS, "project", "vendor_billing_account"] },
    id: { type: "number" },
    name: { type: ["string", "null"] },
    via: { type: "string", enum: ["given", "inherited", "matched"] },
    subscriptionPeriod: { type: "string" },
  },
  required: ["kind", "id", "name", "via"],
  additionalProperties: false,
};

const UNLINKED: JsonSchemaObject = {
  type: "object",
  properties: {
    reason: { type: "string", enum: REVIEW_REASONS },
    message: { type: "string" },
    candidates: { type: "array", items: LINK_CANDIDATE },
    party: PENDING_PARTY,
  },
  required: ["reason", "message", "candidates"],
  additionalProperties: false,
};

const STATUS_HINT = {
  anyOf: [
    rowSchema({
      kind: { type: "string", enum: ["contract_fully_collected"] },
      contractId: { type: "number" },
      title: { type: "string" },
      status: { type: "string" },
      currency: { type: "string" },
      amount: { type: "number" },
      received: { type: "number" },
      message: { type: "string" },
    }),
    rowSchema({
      kind: { type: "string", enum: ["project_ready_to_close"] },
      projectId: { type: "number" },
      name: { type: "string" },
      message: { type: "string" },
    }),
  ],
};

const TXN_LINK_ROW = rowSchema({
  id: { type: "number" },
  txnDate: { type: "string" },
  type: { type: "string" },
  amount: { type: "string" },
  currency: { type: "string" },
  partyId: { type: ["number", "null"] },
  billingItemId: { type: ["number", "null"] },
  subscriptionId: { type: ["number", "null"] },
  subscriptionPeriod: { type: ["string", "null"] },
  contractId: { type: ["number", "null"] },
  projectId: { type: ["number", "null"] },
  reviewReason: { type: ["string", "null"], enum: [...REVIEW_REASONS, null] },
});

const RESOLVE_RESULT = rowSchema({
  id: { type: "number", description: "The transaction id." },
  row: TXN_LINK_ROW,
  links: { type: "array", items: LINKED_REF, description: "What the transaction is linked to now." },
  unlinked: {
    anyOf: [UNLINKED, { type: "null" }],
    description: "Still pending (e.g. after choosing a party the payment matches several candidates); null = resolved.",
  },
  hints: { type: "array", items: STATUS_HINT, description: "Tell the user; ask before acting on them." },
  aliasAdded: { type: ["string", "null"], description: "Raw name added as an alias of the chosen party." },
  createdPartyId: { type: ["number", "null"] },
});

const RESCAN_ITEM = rowSchema({
  id: { type: "number" },
  txnDate: { type: "string" },
  amount: { type: "string" },
  currency: { type: "string" },
  partyId: { type: ["number", "null"] },
  partyName: { type: ["string", "null"] },
  links: { type: "array", items: LINKED_REF },
  unlinked: { anyOf: [UNLINKED, { type: "null" }] },
});

const RESCAN_RESULT = rowSchema({
  scanned: { type: "number" },
  flagged: { type: "number", description: "Rows that would be (dryRun) or were flagged as pending." },
  dryRun: { type: "boolean" },
  results: { type: "array", items: RESCAN_ITEM },
});

type TxnRow = typeof transactions.$inferSelect;

function linkRow(r: TxnRow) {
  return {
    id: r.id,
    txnDate: r.txnDate,
    type: r.type,
    amount: r.amount,
    currency: r.currency,
    partyId: r.partyId,
    billingItemId: r.billingItemId,
    subscriptionId: r.subscriptionId,
    subscriptionPeriod: r.subscriptionPeriod,
    contractId: r.contractId,
    projectId: r.projectId,
    reviewReason: r.reviewReason,
  };
}

/** 把 MCP 參數轉成一個選擇；必須剛好一種。 */
function parseChoice(args: Record<string, unknown>): LinkChoice {
  const choose = args.choose as Record<string, unknown> | undefined;
  const skip = optBoolean(args, "skip") === true;
  const partyId = optNumber(args, "partyId");
  const createParty = optBoolean(args, "createParty") === true;
  const given = [choose != null, skip, partyId !== undefined, createParty].filter(Boolean).length;
  if (given !== 1) throw new Error("Pass exactly one of choose, skip, partyId or createParty.");
  if (skip) return { kind: "skip" };
  if (createParty) return { kind: "new_party" };
  if (partyId !== undefined) return { kind: "party", partyId, addAlias: optBoolean(args, "addAlias") !== false };
  if (typeof choose !== "object" || choose === null) throw new Error('"choose" must be an object.');
  const kind = choose.kind as LinkKind;
  if (!KINDS.includes(kind as (typeof KINDS)[number])) throw new Error('"choose.kind" must be billing_item, subscription or contract.');
  const id = requireNumber(choose, "id");
  const period = choose.subscriptionPeriod;
  if (period !== undefined && period !== null && typeof period !== "string") {
    throw new Error('"choose.subscriptionPeriod" must be a YYYY-MM-DD string.');
  }
  return { kind: "candidate", candidateKind: kind, id, subscriptionPeriod: (period as string | undefined) ?? null };
}

export const linkTools: Record<string, ToolDef> = {
  list_unlinked_transactions: {
    description:
      "List transactions waiting for a link decision (待連結), newest first: income that could belong to several billing items / subscription periods / contracts (link_ambiguous), whose amount matches none of the customer's open receivables (link_amount_mismatch), a single suggested match on an old transaction (link_suggested), or a synced transaction whose counterparty name looks like an existing party and was held instead of creating a new one (party_similar). Each row carries the reason, a message saying what to decide, and the candidates (with expected amount and gap; amountMatches = within wire-fee tolerance). Show them to the user and let them pick; resolve with resolve_transaction_link.",
    inputSchema: {
      type: "object",
      properties: {
        partyId: { type: "number", description: "Only this counterparty; see list_parties." },
        limit: { type: "number", description: "Default 100, max 500." },
        ...ORG_ARG,
      },
      additionalProperties: false,
    },
    outputSchema: listSchema(PENDING_ROW),
    execute: async (args, ctx) => {
      const orgId = await resolveOrg(args, ctx);
      const db = getDb();
      const partyId = optNumber(args, "partyId");
      if (partyId !== undefined) await assertInOrg(db, parties, partyId, orgId, "Party");
      return listResult(await listPendingLinks(db, orgId, { partyId, limit: optNumber(args, "limit") ?? 100 }));
    },
  },

  resolve_transaction_link: {
    description:
      "Resolve one pending transaction (see list_unlinked_transactions). Pass exactly one of: choose = { kind, id, subscriptionPeriod? } to link the candidate the user picked (the transaction then inherits its contract and project; a billing item gets its paid date); skip = true to leave it unlinked for good (it is not matched automatically again); partyId = an existing party for a party_similar row (the held raw name is added to that party's aliases unless addAlias = false, then matching runs again); createParty = true to create a new party from the held name. Only call this after the user has chosen — never guess between candidates. The result says what is linked now, whether it is still pending (e.g. after setting the party the payment matches several items), and status hints such as a contract now fully collected (tell the user; ask before calling update_contract).",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number", description: "Transaction id." },
        choose: {
          type: "object",
          properties: {
            kind: { type: "string", enum: [...KINDS] },
            id: { type: "number" },
            subscriptionPeriod: {
              type: "string",
              description: "YYYY-MM-DD period start. Taken from the candidate when omitted; required for a subscription not in the candidate list.",
            },
          },
          required: ["kind", "id"],
          additionalProperties: false,
        },
        skip: { type: "boolean" },
        partyId: { type: "number", description: "Existing party for a party_similar row; see list_parties." },
        addAlias: { type: "boolean", description: "With partyId: add the held raw name as an alias. Default true." },
        createParty: { type: "boolean", description: "party_similar only: create a new party from the held name." },
        ...ORG_ARG,
      },
      required: ["id"],
      additionalProperties: false,
    },
    outputSchema: RESOLVE_RESULT,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    execute: async (args, ctx) => {
      const orgId = await resolveOrg(args, ctx);
      const id = requireNumber(args, "id");
      const choice = parseChoice(args);
      try {
        const res = await resolvePendingLink(getDb(), orgId, id, choice, "mcp");
        return {
          id: res.row.id,
          row: linkRow(res.row),
          links: res.report.links,
          unlinked: res.report.unlinked,
          hints: res.report.hints,
          aliasAdded: res.aliasAdded,
          createdPartyId: res.createdPartyId,
        };
      } catch (e) {
        if (e instanceof LinkChoiceError) throw new Error(e.message);
        throw e;
      }
    },
  },

  rescan_transaction_links: {
    description:
      "Run the linking layer again over existing income: transactions with a customer but no billing item / subscription / contract that nobody has reviewed yet are compared with that customer's open receivables. Historic rows are never linked automatically — matches are only flagged as pending (list_unlinked_transactions). dryRun defaults to true: returns what would be flagged and writes nothing; pass dryRun = false (after the user agreed) to flag them. transactionId previews a single transaction regardless of its review state, ignoring its current links (always a dry run) — useful for \"run the linking on this payment and show me the result\".",
    inputSchema: {
      type: "object",
      properties: {
        dryRun: { type: "boolean", description: "Default true (write nothing)." },
        partyId: { type: "number", description: "Only this customer; see list_parties." },
        transactionId: { type: "number", description: "Preview just this transaction (always a dry run)." },
        limit: { type: "number", description: "Max transactions to scan, newest first. Default 500, max 2000." },
        ...ORG_ARG,
      },
      additionalProperties: false,
    },
    outputSchema: RESCAN_RESULT,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    execute: async (args, ctx) => {
      const orgId = await resolveOrg(args, ctx);
      const db = getDb();
      const partyId = optNumber(args, "partyId");
      const transactionId = optNumber(args, "transactionId");
      if (partyId !== undefined) await assertInOrg(db, parties, partyId, orgId, "Party");
      if (transactionId !== undefined) await assertInOrg(db, transactions, transactionId, orgId, "Transaction");
      return rescanUnlinkedIncome(db, orgId, {
        partyId,
        transactionId,
        limit: optNumber(args, "limit"),
        dryRun: optBoolean(args, "dryRun") !== false,
        source: "mcp",
      });
    },
  },
};

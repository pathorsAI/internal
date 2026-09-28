import { and, eq, inArray, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { bankAccounts } from "@/db/schema";
import { withWiseClient, profileName } from "@/lib/integrations/wise";
import {
  getWiseStatement,
  isIsoDate,
  parseWiseConfig,
  syncWiseTransactions,
  taipeiDate,
} from "@/lib/wise-sync";
import { auditIntegrationCall, requireIntegrationForTool } from "./tools-integrations";
import {
  assertInOrg,
  optBoolean,
  optNumber,
  optString,
  ORG_ARG,
  requireString,
  resolveOrg,
  type ToolDef,
} from "./shared";

// ---- Wise（唯讀整合）----
//
// 三支工具都只對 Wise 發 GET（見 src/lib/integrations/wise.ts 的白名單）。唯一會寫的是
// wise_sync_transactions，而它寫的是「本組織自己的帳本」，不是 Wise：不建立轉帳、
// 不換匯、不動任何錢。dryRun 預設 true。

const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true };

const BALANCE_ROW = {
  type: "object",
  properties: {
    profileId: { type: "number" },
    profileName: { type: "string" },
    profileType: { type: "string", description: "PERSONAL | BUSINESS" },
    balanceId: { type: "number" },
    currency: { type: "string" },
    amount: { type: ["number", "null"], description: "Current balance in Wise, live." },
    mappedAccountId: {
      type: ["number", "null"],
      description: "Ledger account (bank_accounts id) this balance syncs into; null = unmapped, skipped by sync.",
    },
    mappedAccountName: { type: ["string", "null"] },
    syncFrom: {
      type: ["string", "null"],
      description: "Cutover date (YYYY-MM-DD, Asia/Taipei). Wise transactions before it are never synced (they were booked by hand).",
    },
  },
  required: [
    "profileId",
    "profileName",
    "profileType",
    "balanceId",
    "currency",
    "amount",
    "mappedAccountId",
    "mappedAccountName",
    "syncFrom",
  ],
  additionalProperties: false,
};

const COMPACT_TXN = {
  type: "object",
  properties: {
    date: { type: "string", description: "YYYY-MM-DD in Asia/Taipei." },
    dateTime: { type: "string", description: "ISO 8601 from Wise." },
    direction: { type: "string", description: "DEBIT | CREDIT" },
    detailsType: { type: "string", description: "CARD | TRANSFER | CONVERSION | DEPOSIT | MONEY_ADDED | …" },
    amount: { type: "number", description: "Signed, in the balance currency (negative = money out, fees included)." },
    currency: { type: "string" },
    fee: { type: ["number", "null"] },
    description: { type: ["string", "null"] },
    merchant: { type: ["string", "null"], description: "Merchant, sender or recipient name." },
    originalAmount: {
      anyOf: [
        {
          type: "object",
          properties: { value: { type: "number" }, currency: { type: "string" } },
          required: ["value", "currency"],
        },
        { type: "null" },
      ],
    },
    referenceNumber: { type: "string", description: "Wise's unique reference, e.g. CARD-4370840324." },
    runningBalance: { type: ["number", "null"] },
  },
  required: [
    "date",
    "dateTime",
    "direction",
    "detailsType",
    "amount",
    "currency",
    "fee",
    "description",
    "merchant",
    "originalAmount",
    "referenceNumber",
    "runningBalance",
  ],
};

const SYNC_ACCOUNT_ROW = {
  type: "object",
  properties: {
    bankAccountId: { type: "number" },
    bankAccountName: { type: "string" },
    profileId: { type: "number" },
    profileName: { type: "string" },
    balanceId: { type: "number" },
    currency: { type: "string" },
    syncFrom: { type: "string", description: "Cutover date used." },
    rangeStart: { type: "string", description: "First date fetched (YYYY-MM-DD)." },
    rangeEnd: { type: "string", description: "Last date fetched (today, Asia/Taipei)." },
    fetched: { type: "number", description: "Wise transactions read." },
    beforeCutover: { type: "number", description: "Ignored because they are before syncFrom." },
    alreadySynced: { type: "number", description: "Already in the ledger (deduped by reference)." },
    created: { type: "number", description: "dryRun: would be created. Otherwise: created." },
    needsReview: { type: "number", description: "Of those, flagged 待確認 (category to be chosen)." },
  },
};

const SYNC_OUTPUT = {
  type: "object" as const,
  properties: {
    dryRun: { type: "boolean" },
    accounts: { type: "array", items: SYNC_ACCOUNT_ROW },
    skippedBalances: {
      type: "array",
      description: "Wise balances not synced: unmapped, no cutover date, ledger account missing or currency mismatch.",
      items: {
        type: "object",
        properties: {
          profileId: { type: "number" },
          profileName: { type: "string" },
          balanceId: { type: "number" },
          currency: { type: "string" },
          reason: {
            type: "string",
            enum: ["unmapped", "no_sync_from", "account_missing", "currency_mismatch"],
          },
        },
      },
    },
    totals: {
      type: "object",
      properties: {
        created: { type: "number" },
        alreadySynced: { type: "number" },
        beforeCutover: { type: "number" },
      },
    },
    duplicateRefs: {
      type: "array",
      items: { type: "string" },
      description: "References Wise returned twice in one run; only the first was used.",
    },
    sample: {
      type: "array",
      description: "First 50 rows that would be / were created, oldest first.",
      items: {
        type: "object",
        properties: {
          bankAccountId: { type: "number" },
          txnDate: { type: "string" },
          type: { type: "string", description: "income | expense | transfer (one leg of a currency conversion)" },
          amount: { type: "string" },
          currency: { type: "string" },
          partyName: { type: ["string", "null"] },
          description: { type: "string" },
          externalRef: { type: "string" },
          needsReview: { type: "boolean" },
        },
      },
    },
  },
  required: ["dryRun", "accounts", "skippedBalances", "totals", "duplicateRefs", "sample"],
};

function optIsoDate(args: Record<string, unknown>, key: string): string | undefined {
  const v = optString(args, key);
  if (v === undefined) return undefined;
  if (!isIsoDate(v)) throw new Error(`"${key}" must be a date in YYYY-MM-DD format.`);
  return v;
}

export const wiseTools: Record<string, ToolDef> = {
  wise_list_balances: {
    description:
      "Read-only. List the Wise profiles and balances this organization's Wise token can see, with each balance's live amount and the ledger account it is mapped to for syncing (plus its cutover date). Calls Wise with GET requests only — nothing is moved or changed in Wise. Requires the Wise integration to be connected and switched on (設定 › 整合).",
    inputSchema: { type: "object", properties: { ...ORG_ARG }, additionalProperties: false },
    outputSchema: {
      type: "object",
      properties: {
        items: { type: "array", items: BALANCE_ROW },
        count: { type: "number" },
      },
      required: ["items", "count"],
      additionalProperties: false,
    },
    annotations: { ...READ, title: "Wise balances" },
    execute: async (args, ctx) => {
      const orgId = await resolveOrg(args, ctx);
      await requireIntegrationForTool(orgId, "wise");
      const items = await withWiseClient(orgId, async (client, row) => {
        const cfg = parseWiseConfig(row.config);
        const profiles = await client.listProfiles();
        const out = [];
        for (const p of profiles) {
          const balances = await client.listBalances(p.id);
          for (const b of balances) {
            const m = cfg.accountMappings.find((x) => x.balanceId === b.id);
            out.push({
              profileId: p.id,
              profileName: profileName(p),
              profileType: String(p.type),
              balanceId: b.id,
              currency: b.currency,
              amount: typeof b.amount?.value === "number" ? b.amount.value : null,
              mappedAccountId: m?.bankAccountId ?? null,
              mappedAccountName: null as string | null,
              syncFrom: m?.bankAccountId ? (m.syncFrom ?? cfg.syncFrom) : null,
            });
          }
        }
        return out;
      });
      const ids = items.map((i) => i.mappedAccountId).filter((x): x is number => x !== null);
      if (ids.length) {
        const accts = await getDb()
          .select({ id: bankAccounts.id, name: bankAccounts.name })
          .from(bankAccounts)
          .where(
            and(
              eq(bankAccounts.organizationId, orgId),
              inArray(bankAccounts.id, ids),
              isNull(bankAccounts.deletedAt),
            ),
          );
        for (const i of items) {
          i.mappedAccountName = accts.find((a) => a.id === i.mappedAccountId)?.name ?? null;
        }
      }
      await auditIntegrationCall(ctx, orgId, "wise", "read", `列出 ${items.length} 個餘額`);
      return { items, count: items.length };
    },
  },

  wise_get_statement: {
    description:
      "Read-only. Fetch Wise balance-statement transactions for a date range (inclusive, Asia/Taipei dates) as compact rows: date, direction, type (CARD/TRANSFER/CONVERSION/…), signed amount incl. fees, fee, merchant/counterparty, original-currency amount, Wise reference and running balance. Identify the balance either by ledger accountId (a bank account mapped to a Wise balance — see wise_list_balances) or by profileId + balanceId. Does not write anything. Max range 400 days.",
    inputSchema: {
      type: "object",
      properties: {
        accountId: { type: "number", description: "Ledger bank account mapped to a Wise balance." },
        profileId: { type: "number", description: "Wise profile id (with balanceId)." },
        balanceId: { type: "number", description: "Wise balance id (with profileId)." },
        startDate: { type: "string", description: "YYYY-MM-DD (Asia/Taipei)." },
        endDate: { type: "string", description: "YYYY-MM-DD (Asia/Taipei); default today." },
        limit: { type: "number", description: "Max rows returned (most recent kept). Default 200." },
        ...ORG_ARG,
      },
      required: ["startDate"],
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        profileId: { type: "number" },
        balanceId: { type: "number" },
        currency: { type: "string" },
        startDate: { type: "string" },
        endDate: { type: "string" },
        total: { type: "number", description: "Transactions in the range (before limit)." },
        items: { type: "array", items: COMPACT_TXN },
        count: { type: "number" },
      },
      required: ["profileId", "balanceId", "currency", "startDate", "endDate", "total", "items", "count"],
      additionalProperties: false,
    },
    annotations: { ...READ, title: "Wise statement" },
    execute: async (args, ctx) => {
      const orgId = await resolveOrg(args, ctx);
      const { row } = await requireIntegrationForTool(orgId, "wise");
      const cfg = parseWiseConfig(row.config);
      const startDate = optIsoDate(args, "startDate") ?? requireString(args, "startDate");
      const endDate = optIsoDate(args, "endDate") ?? taipeiDate(new Date());
      if (endDate < startDate) throw new Error('"endDate" must not be before "startDate".');
      const days = (Date.parse(endDate) - Date.parse(startDate)) / 86_400_000;
      if (days > 400) throw new Error("Date range too long; keep it within 400 days.");

      const accountId = optNumber(args, "accountId");
      let profileId = optNumber(args, "profileId");
      let balanceId = optNumber(args, "balanceId");
      if (accountId !== undefined) {
        await assertInOrg(getDb(), bankAccounts, accountId, orgId, "Account");
        const m = cfg.accountMappings.find((x) => x.bankAccountId === accountId);
        if (!m) {
          throw new Error(
            `Account ${accountId} is not mapped to a Wise balance. Use wise_list_balances, or pass profileId + balanceId.`,
          );
        }
        profileId = m.profileId;
        balanceId = m.balanceId;
      }
      if (profileId === undefined || balanceId === undefined) {
        throw new Error('Pass either "accountId" or both "profileId" and "balanceId".');
      }
      const bal = cfg.balances.find((b) => b.balanceId === balanceId && b.profileId === profileId);
      if (!bal) {
        throw new Error(
          `Wise balance ${balanceId} (profile ${profileId}) is not known for this organization. Call wise_list_balances, or ask an owner/admin to refresh the balances in 設定 › 整合.`,
        );
      }
      const all = await getWiseStatement(
        orgId,
        { profileId, balanceId, currency: bal.currency },
        startDate,
        endDate,
      );
      const limit = Math.max(1, Math.min(1000, optNumber(args, "limit") ?? 200));
      const items = all.slice(-limit);
      await auditIntegrationCall(
        ctx,
        orgId,
        "wise",
        "read",
        `讀取對帳單 ${bal.currency} ${startDate}～${endDate}（${all.length} 筆）`,
      );
      return {
        profileId,
        balanceId,
        currency: bal.currency,
        startDate,
        endDate,
        total: all.length,
        items,
        count: items.length,
      };
    },
  },

  wise_sync_transactions: {
    description:
      "Import Wise balance-statement transactions into this organization's own ledger (transactions), for every Wise balance mapped to a ledger account (or only `accountId`). Reads Wise with GET only and writes ONLY to the internal books — it never creates transfers, quotes or conversions in Wise and moves no money. dryRun defaults to TRUE: first call it without dryRun, show the user the preview (rows per account, date ranges, sample rows, skipped/unmapped balances), and only after the user explicitly approves call it again with dryRun:false to write. Rows are deduped by Wise reference (never inserted twice; existing rows are never modified), start at each mapping's cutover date (syncFrom) so hand-entered monthly aggregates are not double counted, are booked as 'internal', uncategorized (未分類) and flagged needsReview (待確認). CREDIT → income, DEBIT → expense (amount already includes Wise fees; the fee is noted in the description); a currency conversion between two mapped balances becomes one single-leg transfer row per balance. startDate (YYYY-MM-DD) overrides the automatic start (last synced date − 3 days) but cannot be earlier than the cutover date.",
    inputSchema: {
      type: "object",
      properties: {
        accountId: { type: "number", description: "Only sync this ledger account (must be mapped)." },
        startDate: {
          type: "string",
          description: "YYYY-MM-DD (Asia/Taipei). Override the start; must not be before the cutover date.",
        },
        dryRun: {
          type: "boolean",
          description: "Default true = preview only, nothing written. Pass false only after the user approved the preview.",
        },
        ...ORG_ARG,
      },
      additionalProperties: false,
    },
    outputSchema: SYNC_OUTPUT,
    annotations: {
      title: "Sync Wise transactions into the ledger",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
    execute: async (args, ctx) => {
      const orgId = await resolveOrg(args, ctx);
      await requireIntegrationForTool(orgId, "wise");
      const accountId = optNumber(args, "accountId");
      if (accountId !== undefined) {
        await assertInOrg(getDb(), bankAccounts, accountId, orgId, "Account");
      }
      const dryRun = optBoolean(args, "dryRun") ?? true;
      const result = await syncWiseTransactions(orgId, {
        accountId,
        startDate: optIsoDate(args, "startDate"),
        dryRun,
      });
      const ranges = result.accounts
        .map((a) => `${a.bankAccountName} ${a.rangeStart}～${a.rangeEnd}: ${a.created}`)
        .join("; ");
      await auditIntegrationCall(
        ctx,
        orgId,
        "wise",
        dryRun ? "read" : "create",
        dryRun
          ? `同步試算：會新增 ${result.totals.created} 筆（${ranges}）`
          : `同步交易：新增 ${result.totals.created} 筆、略過 ${result.totals.alreadySynced} 筆已存在（${ranges}）`,
      );
      return result;
    },
  },
};

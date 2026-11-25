import { addDays, differenceInCalendarDays, format, parseISO } from "date-fns";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { billingItems, contracts, parties, subscriptions, transactions } from "@/db/schema";
import {
  deleteSubscriptionPeriod,
  getSubscriptionSchedule,
  listActivity,
  listMyOrgs,
  listProjects,
  upsertSubscriptionPeriod,
} from "@/db/queries";
import { getOrgTaxSetting } from "@/db/org-tax";
import { getOrgRole } from "@/lib/session";
import { executeUndo, planUndoMany, type UndoChannel } from "@/lib/undo";
import { contractCollected } from "@/db/allocations";
import {
  collectionProgress,
  effectiveTaxSetting,
  taxedAmount,
  taxedAmountOrNull,
} from "@/lib/tax-amounts";
import {
  assertInOrg,
  EFFECTIVE_TAX_PROPS,
  taxBreakdownProps,
  nextChargeDate,
  optNumber,
  optString,
  ORG_ARG,
  requireDate,
  requireNumber,
  resolveOrg,
  todayStr,
  listResult,
  listSchema,
  rowSchema,
  type JsonSchemaObject,
  type ToolDef,
} from "./shared";
import { accountingTools } from "./tools-accounting";
import { transactionTools } from "./tools-transactions";
import { clientTools } from "./tools-client";
import { hrTools } from "./tools-hr";
import { employeeAccountTools } from "./tools-employee-accounts";
import { billingItemTools } from "./tools-billing";
import { orgTools } from "./tools-org";
import { integrationTools } from "./tools-integrations";
import { wiseTools } from "./tools-wise";
import { simpanyTools } from "./tools-simpany";
import { vendorBillingTools } from "./tools-vendor-billing";
import { recurringExpenseTools } from "./tools-recurring-expenses";
import { settingsTools } from "./tools-settings";
import { vendorBillingAdminTools } from "./tools-vendor-billing-admin";
import { linkTools } from "./tools-links";
import { allocationTools } from "./tools-allocations";
import { aiRuleTools } from "./tools-ai-rules";

export type { ToolContext, ToolDef } from "./shared";

// ---- outputSchema 素材 ----
// 這幾支是自己組 select 的清單工具，形狀就是 select 裡列的欄位：drizzle 的 numeric
// 讀回來是字串、date 是 YYYY-MM-DD 字串、leftJoin 帶出來的欄位可能是 null。

const SUBSCRIPTION_LIST_ROW: JsonSchemaObject = rowSchema({
  id: { type: "number" },
  name: { type: "string" },
  amount: { type: "string", description: "Decimal as a string." },
  currency: { type: "string", description: "3-letter code." },
  intervalMonths: { type: "number" },
  startDate: { type: "string", description: "YYYY-MM-DD." },
  endDate: { type: ["string", "null"], description: "YYYY-MM-DD." },
  status: { type: "string", enum: ["active", "paused", "ended"] },
  customer: { type: ["string", "null"], description: "Customer party name." },
  contractId: { type: ["number", "null"], description: "Linked contract; see list_contracts." },
  contractTitle: { type: ["string", "null"] },
  nextChargeDate: {
    type: ["string", "null"],
    description: "YYYY-MM-DD; null unless the subscription is active and still running.",
  },
  ...taxBreakdownProps(),
  ...EFFECTIVE_TAX_PROPS,
});

const CONTRACT_LIST_ROW: JsonSchemaObject = rowSchema({
  id: { type: "number" },
  title: { type: "string" },
  amount: { type: ["string", "null"], description: "Decimal as a string; null when not agreed." },
  currency: { type: "string", description: "3-letter code." },
  startDate: { type: ["string", "null"], description: "YYYY-MM-DD." },
  endDate: { type: ["string", "null"], description: "YYYY-MM-DD." },
  status: { type: "string", enum: ["draft", "active", "completed", "cancelled"] },
  fileUrl: { type: ["string", "null"] },
  customer: { type: ["string", "null"], description: "Customer party name." },
  ...taxBreakdownProps(true),
  ...EFFECTIVE_TAX_PROPS,
  received: {
    type: "number",
    description:
      "已收 in the contract currency: payment allocations to the contract itself + to its billing items + to periods of subscriptions bound to it (an income transaction without allocations counts through its single binding). Includes feeAbsorbed.",
  },
  feeAbsorbed: {
    type: "number",
    description: "The part of `received` that is an absorbed bank fee / FX shortfall (allocation `fee`), not money.",
  },
  cost: { type: "number", description: "Linked expense/advance; reference only." },
  remaining: { type: ["number", "null"], description: "未收 = gross − received; null when amount is unset." },
});

const DERIVED_PROJECT_STATUS = ["active", "completed", "empty", "archived"] as const;

const PROJECT_LIST_ROW: JsonSchemaObject = rowSchema({
  id: { type: "number" },
  name: { type: "string" },
  status: {
    type: "string",
    enum: ["active", "archived"],
    description:
      "Stored status. Only `archived` (a manual override) carries meaning; read derivedStatus for what the project actually is.",
  },
  derivedStatus: {
    type: "string",
    enum: [...DERIVED_PROJECT_STATUS],
    description:
      "Derived from the project's contracts and subscriptions: archived = manually archived; active = has a draft/active contract or an active/paused subscription; completed = has contracts/subscriptions and all are completed/cancelled/ended; empty = nothing under it yet.",
  },
  hint: {
    type: ["string", "null"],
    description:
      "Set when the project looks ready to close (derivedStatus completed, not archived). Tell the user and ASK before archiving; only call update_project with status archived after they agree.",
  },
  description: { type: ["string", "null"] },
  client: { type: ["string", "null"], description: "Owning customer party name." },
  clientPartyId: { type: ["number", "null"] },
  contractCount: { type: "number" },
  subscriptionCount: { type: "number" },
  income: {
    type: "number",
    description:
      "TWD (amount_twd, falling back to amount). Includes transactions tagged with the project AND those linked via its contracts, subscriptions or billing items; each transaction counted once.",
  },
  expense: { type: "number", description: "TWD; expense + advance, same membership rule as income." },
  net: { type: "number", description: "income − expense (TWD)." },
});

const CUSTOMER_LIST_ROW: JsonSchemaObject = rowSchema({
  id: { type: "number", description: "Pass this back as customerPartyId." },
  name: { type: "string" },
  taxId: { type: ["string", "null"] },
  defaultCurrency: { type: ["string", "null"], description: "3-letter code." },
  contact: { type: ["string", "null"] },
});

const ACTIVITY_ROW: JsonSchemaObject = rowSchema({
  id: { type: "number" },
  actorName: { type: ["string", "null"] },
  actorEmail: { type: ["string", "null"] },
  channel: {
    type: "string",
    enum: ["web", "mcp", "ai", "system", "api", "line", "whatsapp"],
    description: "ai = the in-app AI assistant acting for the signed-in member; api = a call made with an organization API key (REST /api/v1 or MCP), actor = the member who created the key, summary starts with the key name; system = scheduled work with no human actor (e.g. the daily integration auto-sync); actor fields are null.",
  },
  action: { type: "string", enum: ["create", "update", "delete", "read"] },
  entityType: { type: "string" },
  entityId: { type: ["number", "null"] },
  summary: { type: ["string", "null"] },
  createdAt: { type: "string", description: "ISO 8601 timestamp." },
  undoable: {
    type: "boolean",
    description: "Whether undo_activity can undo this entry for the caller right now.",
  },
  undoBlockedReason: {
    type: ["string", "null"],
    description: "Why it cannot be undone (and what to do instead); null when undoable.",
  },
});

const UNDO_RESULT: JsonSchemaObject = rowSchema({
  activityId: {
    type: ["number", "null"],
    description: "The new activity entry written for this undo (undo it again to redo).",
  },
  undoneActivityId: { type: "number" },
  kind: {
    type: "string",
    enum: ["softDelete", "delete", "restore", "undelete", "reinsert"],
    description: "softDelete/delete = removed what was created; restore = changed fields set back; undelete/reinsert = deleted record brought back.",
  },
  entityType: { type: "string" },
  entityId: { type: "number" },
  restoredFields: { type: "array", items: { type: "string" }, description: "restore only: the columns set back." },
  summary: { type: "string" },
});

/** 工具呼叫的操作紀錄入口：API key → api（帶金鑰名稱），其餘照 ctx.channel（預設 mcp）。 */
function undoChannel(ctx: Parameters<ToolDef["execute"]>[1]): UndoChannel {
  if (ctx.apiKey) return { apiKeyName: ctx.apiKey.name };
  return ctx.channel ?? "mcp";
}

// Discovery + the recurring-billing tools. Domain CRUD lives in the tools-*.ts
// modules and is merged into `tools` at the bottom.
const billingTools: Record<string, ToolDef> = {
  list_organizations: {
    description:
      "List the organizations the signed-in user can access. Call this first in a session, show the user the options, and ask which organization to work in — then pass the chosen value as `organizationId` to every other tool. Required when the account belongs to more than one organization.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    // Reference implementation of an `outputSchema` (see ToolDef in shared.ts).
    // Declaring one makes the handler also return the result as MCP
    // `structuredContent`, which ChatGPT/Codex prefer over parsing the JSON text
    // block. Every tool here declares one; the schema is a promise, so derive it
    // from what `execute` really returns, nullable fields included.
    outputSchema: {
      type: "object",
      properties: {
        organizations: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              organizationId: {
                type: "string",
                description: "Pass this back as `organizationId` on other tools.",
              },
              id: { type: "string" },
              slug: { type: ["string", "null"] },
            },
            required: ["name", "organizationId", "id"],
          },
        },
        hint: { type: "string" },
      },
      required: ["organizations", "hint"],
      additionalProperties: false,
    },
    execute: async (_args, ctx) => {
      const all = await listMyOrgs(ctx.userId);
      // An API key only ever sees the one organization it was created in.
      const orgs = ctx.apiKey ? all.filter((o) => o.id === ctx.apiKey?.organizationId) : all;
      return {
        organizations: orgs.map((o) => ({
          name: o.name,
          organizationId: o.slug ?? o.id,
          id: o.id,
          slug: o.slug,
        })),
        hint:
          orgs.length > 1
            ? "Ask the user which organization to use, then pass its organizationId to the other tools."
            : "Single organization — you can call the other tools directly.",
      };
    },
  },

  list_upcoming_billing: {
    description:
      "Charges coming due within the next N days, projected from the organization's own records: both active recurring subscriptions (next charge computed from start_date + interval_months) and planned one-off billing items (contract instalments / project milestones). A reminder view — it bills nobody and collects nothing. Use it to answer 'who do I need to bill, and when'. For the full picture including overdue and unpaid items, use list_billing_status.",
    inputSchema: {
      type: "object",
      properties: {
        days: { type: "number", description: "Look-ahead window in days (default 60)." },
        ...ORG_ARG,
      },
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        today: { type: "string", description: "YYYY-MM-DD." },
        windowDays: { type: "number" },
        upcomingCount: { type: "number" },
        upcoming: {
          type: "array",
          items: {
            type: "object",
            properties: {
              kind: { type: "string", enum: ["subscription_projected", "billing_item"] },
              id: {
                type: "number",
                description: "Subscription id or billing item id, per `kind`.",
              },
              customer: { type: ["string", "null"] },
              label: { type: "string" },
              // 金額直接來自 numeric 欄位，drizzle 回的是字串。
              amount: { type: "string", description: "Stored amount (basis per amountBasis)." },
              ...taxBreakdownProps(),
              ...EFFECTIVE_TAX_PROPS,
              currency: { type: "string" },
              date: { type: "string", description: "Charge / due date, YYYY-MM-DD." },
              daysUntilDue: { type: "number" },
            },
            required: [
              "kind",
              "id",
              "customer",
              "label",
              "amount",
              "net",
              "tax",
              "gross",
              "taxTreatment",
              "amountBasis",
              "currency",
              "date",
              "daysUntilDue",
            ],
            additionalProperties: false,
          },
        },
        note: { type: "string" },
      },
      required: ["today", "windowDays", "upcomingCount", "upcoming", "note"],
      additionalProperties: false,
    },
    execute: async (args, ctx) => {
      const days = optNumber(args, "days") ?? 60;
      const orgId = await resolveOrg(args, ctx);
      const db = getDb();
      const today = todayStr();
      const horizon = format(addDays(parseISO(today), days), "yyyy-MM-dd");

      const orgTax = await getOrgTaxSetting(orgId);
      const subRows = await db
        .select({
          id: subscriptions.id,
          name: subscriptions.name,
          amount: subscriptions.amount,
          currency: subscriptions.currency,
          intervalMonths: subscriptions.intervalMonths,
          startDate: subscriptions.startDate,
          endDate: subscriptions.endDate,
          customer: parties.name,
          contractId: subscriptions.contractId,
          taxTreatment: subscriptions.taxTreatment,
          amountBasis: subscriptions.amountBasis,
          contractTaxTreatment: contracts.taxTreatment,
          contractAmountBasis: contracts.amountBasis,
        })
        .from(subscriptions)
        .leftJoin(parties, eq(subscriptions.customerPartyId, parties.id))
        .leftJoin(contracts, eq(subscriptions.contractId, contracts.id))
        .where(
          and(
            eq(subscriptions.organizationId, orgId),
            eq(subscriptions.status, "active"),
            isNull(subscriptions.deletedAt),
          ),
        );

      type Item = {
        kind: "subscription_projected" | "billing_item";
        id: number;
        customer: string | null;
        label: string;
        amount: string;
        net: number;
        tax: number;
        gross: number;
        taxTreatment: string;
        amountBasis: string;
        currency: string;
        date: string;
        daysUntilDue: number;
      };
      const items: Item[] = [];

      // 已排定但還沒請款的一次性項目（分期 / 里程碑）也算「接下來要請的款」。
      const itemRows = await db
        .select({
          id: billingItems.id,
          title: billingItems.title,
          amount: billingItems.amount,
          currency: billingItems.currency,
          dueDate: billingItems.dueDate,
          customer: parties.name,
          contractId: billingItems.contractId,
          taxTreatment: billingItems.taxTreatment,
          amountBasis: billingItems.amountBasis,
          contractTaxTreatment: contracts.taxTreatment,
          contractAmountBasis: contracts.amountBasis,
        })
        .from(billingItems)
        .leftJoin(parties, eq(billingItems.customerPartyId, parties.id))
        .leftJoin(contracts, eq(billingItems.contractId, contracts.id))
        .where(
          and(
            eq(billingItems.organizationId, orgId),
            isNull(billingItems.deletedAt),
            isNull(billingItems.billedOn),
            sql`${billingItems.status} not in ('paid', 'cancelled')`,
          ),
        );
      for (const b of itemRows) {
        if (!b.dueDate || b.dueDate > horizon) continue;
        items.push({
          kind: "billing_item",
          id: b.id,
          customer: b.customer,
          label: b.title,
          amount: b.amount,
          ...taxedAmount(
            Number(b.amount),
            effectiveTaxSetting(orgTax, b, b.contractId, {
              taxTreatment: b.contractTaxTreatment,
              amountBasis: b.contractAmountBasis,
            }),
            b.currency,
          ),
          currency: b.currency,
          date: b.dueDate,
          daysUntilDue: differenceInCalendarDays(parseISO(b.dueDate), parseISO(today)),
        });
      }

      for (const s of subRows) {
        const next = nextChargeDate(s.startDate, s.intervalMonths, today, s.endDate);
        if (!next || next > horizon) continue;
        items.push({
          kind: "subscription_projected",
          id: s.id,
          customer: s.customer,
          label: `${s.name} (every ${s.intervalMonths}mo)`,
          amount: s.amount,
          ...taxedAmount(
            Number(s.amount),
            effectiveTaxSetting(orgTax, s, s.contractId, {
              taxTreatment: s.contractTaxTreatment,
              amountBasis: s.contractAmountBasis,
            }),
            s.currency,
          ),
          currency: s.currency,
          date: next,
          daysUntilDue: differenceInCalendarDays(parseISO(next), parseISO(today)),
        });
      }

      items.sort((a, b) => a.date.localeCompare(b.date));
      return {
        today,
        windowDays: days,
        upcomingCount: items.length,
        upcoming: items,
        note: "gross is what the customer pays (含稅); net is 未稅. subscription_projected rows are computed from the subscription schedule; billing_item rows are explicitly scheduled charges that have not been billed yet. Overdue items are NOT included here — use list_billing_status for those.",
      };
    },
  },

  list_subscriptions: {
    description:
      "Recurring subscriptions / retainers with their interval and the next computed charge date. Filter by status (active/paused/ended). Each row carries the effective 營業稅別 and the per-period amount split into net (未稅, for revenue / MRR) and gross (含稅, what the customer pays per period).",
    inputSchema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["active", "paused", "ended"],
          description: "Optional status filter; defaults to all.",
        },
        ...ORG_ARG,
      },
      additionalProperties: false,
    },
    outputSchema: listSchema(SUBSCRIPTION_LIST_ROW),
    execute: async (args, ctx) => {
      const orgId = await resolveOrg(args, ctx);
      const status = optString(args, "status");
      const db = getDb();
      const today = todayStr();
      const where = status
        ? and(
            eq(subscriptions.organizationId, orgId),
            eq(subscriptions.status, status),
            isNull(subscriptions.deletedAt),
          )
        : and(eq(subscriptions.organizationId, orgId), isNull(subscriptions.deletedAt));
      const orgTax = await getOrgTaxSetting(orgId);
      const rows = await db
        .select({
          id: subscriptions.id,
          name: subscriptions.name,
          amount: subscriptions.amount,
          currency: subscriptions.currency,
          intervalMonths: subscriptions.intervalMonths,
          startDate: subscriptions.startDate,
          endDate: subscriptions.endDate,
          status: subscriptions.status,
          customer: parties.name,
          contractId: subscriptions.contractId,
          contractTitle: contracts.title,
          ownTaxTreatment: subscriptions.taxTreatment,
          ownAmountBasis: subscriptions.amountBasis,
          contractTaxTreatment: contracts.taxTreatment,
          contractAmountBasis: contracts.amountBasis,
        })
        .from(subscriptions)
        .leftJoin(parties, eq(subscriptions.customerPartyId, parties.id))
        .leftJoin(contracts, eq(subscriptions.contractId, contracts.id))
        .where(where)
        .orderBy(asc(subscriptions.startDate));
      return listResult(
        rows.map(
          ({ ownTaxTreatment, ownAmountBasis, contractTaxTreatment, contractAmountBasis, ...s }) => ({
            ...s,
            nextChargeDate:
              s.status === "active"
                ? nextChargeDate(s.startDate, s.intervalMonths, today, s.endDate)
                : null,
            ...taxedAmount(
              Number(s.amount),
              effectiveTaxSetting(
                orgTax,
                { taxTreatment: ownTaxTreatment, amountBasis: ownAmountBasis },
                s.contractId,
                { taxTreatment: contractTaxTreatment, amountBasis: contractAmountBasis },
              ),
              s.currency,
            ),
          }),
        ),
      );
    },
  },

  get_subscription_schedule: {
    description:
      "Per-period collection status for one subscription: lists each billing period (from start_date + interval_months, up to and including the next due one) with 應收/已收 and a status — paid (已收滿), partial (部分), overdue (未收且已到期), upcoming (未到期). A period's 已收 is the sum of payment allocations to that subscription + period (amount + absorbed fee; an income transaction without allocations counts through its subscriptionId + subscriptionPeriod binding, full amount). See set_payment_allocations. Use this to answer 'which 期/季 is collected vs outstanding'. totalOutstanding sums the未收 of every non-upcoming period. Each period's `expected` is the gross receivable (含稅): `amount` (the default or a set_subscription_period override, in the subscription's amountBasis) plus 5% when taxable; `net`/`tax` split it.",
    inputSchema: {
      type: "object",
      properties: {
        subscriptionId: { type: "number" },
        ...ORG_ARG,
      },
      required: ["subscriptionId"],
      additionalProperties: false,
    },
    // 對應 db/queries.ts 的 SubscriptionSchedule。amount 是 numeric 欄位（字串），
    // 但 periods 裡的 expected/paid 已經在 computeSubscriptionSchedule 轉成 number。
    outputSchema: {
      type: "object",
      properties: {
        id: { type: "number" },
        name: { type: "string" },
        customerName: { type: ["string", "null"] },
        amount: { type: "string", description: "The subscription's default per-period amount." },
        currency: { type: "string" },
        intervalMonths: { type: "number" },
        startDate: { type: "string" },
        endDate: { type: ["string", "null"] },
        status: { type: "string", enum: ["active", "paused", "ended"] },
        nextChargeDate: { type: ["string", "null"] },
        ...taxBreakdownProps(),
        ...EFFECTIVE_TAX_PROPS,
        periods: {
          type: "array",
          items: {
            type: "object",
            properties: {
              periodStart: { type: "string", description: "YYYY-MM-DD." },
              periodLabel: { type: "string" },
              amount: {
                type: "number",
                description: "The period amount as entered (default or override), in the subscription's amountBasis.",
              },
              net: { type: "number", description: "未稅." },
              tax: { type: "number", description: "稅額." },
              expected: { type: "number", description: "應收 for the period = gross (含稅)." },
              paid: { type: "number", description: "已收 for the period, including feeAbsorbed." },
              feeAbsorbed: {
                type: "number",
                description: "Absorbed bank fee / FX shortfall counted in `paid` (allocation fees), not money.",
              },
              status: {
                type: "string",
                enum: ["paid", "partial", "overdue", "upcoming"],
              },
              note: { type: ["string", "null"] },
              isOverride: {
                type: "boolean",
                description: "True when `expected` comes from a set_subscription_period override.",
              },
              dueDate: { type: ["string", "null"] },
              billedOn: { type: ["string", "null"] },
              invoicedOn: { type: ["string", "null"] },
            },
            required: [
              "periodStart",
              "periodLabel",
              "amount",
              "net",
              "tax",
              "expected",
              "paid",
              "feeAbsorbed",
              "status",
              "note",
              "isOverride",
              "dueDate",
              "billedOn",
              "invoicedOn",
            ],
            additionalProperties: false,
          },
        },
        totalOutstanding: { type: "number" },
      },
      required: [
        "id",
        "name",
        "customerName",
        "amount",
        "currency",
        "intervalMonths",
        "startDate",
        "endDate",
        "status",
        "nextChargeDate",
        "net",
        "tax",
        "gross",
        "taxTreatment",
        "amountBasis",
        "periods",
        "totalOutstanding",
      ],
      additionalProperties: false,
    },
    execute: async (args, ctx) => {
      const orgId = await resolveOrg(args, ctx);
      const subscriptionId = requireNumber(args, "subscriptionId");
      const schedule = await getSubscriptionSchedule(orgId, subscriptionId);
      if (!schedule) throw new Error(`Subscription ${subscriptionId} not found in your organization.`);
      return schedule;
    },
  },

  set_subscription_period: {
    description:
      "Set (upsert) the amount for one billing period of a subscription. Use for irregular periods (e.g. a 2-month transition quarter). periodStart is the period's start date. expectedAmount is in the subscription's effective amountBasis (net/未稅 unless the subscription or its contract says gross); the 應收 shown by get_subscription_schedule adds 5% tax on top when taxable.",
    inputSchema: {
      type: "object",
      properties: {
        subscriptionId: { type: "number" },
        periodStart: { type: "string", description: "The period's start date (YYYY-MM-DD)." },
        expectedAmount: {
          type: "number",
          description: "Amount for this period, same basis as the subscription amount (net unless amountBasis=gross).",
        },
        note: { type: "string", description: "Optional reason for the override." },
        ...ORG_ARG,
      },
      required: ["subscriptionId", "periodStart", "expectedAmount"],
      additionalProperties: false,
    },
    // upsertSubscriptionPeriod 只回覆寫本身（已轉成 number），不回整列。
    outputSchema: {
      type: "object",
      properties: {
        periodStart: { type: "string", description: "YYYY-MM-DD." },
        expectedAmount: { type: "number" },
        note: { type: ["string", "null"] },
      },
      required: ["periodStart", "expectedAmount", "note"],
      additionalProperties: false,
    },
    execute: async (args, ctx) => {
      const orgId = await resolveOrg(args, ctx);
      const subscriptionId = requireNumber(args, "subscriptionId");
      const db = getDb();
      await assertInOrg(db, subscriptions, subscriptionId, orgId, "Subscription");
      const periodStart = requireDate(args, "periodStart");
      const expectedAmount = requireNumber(args, "expectedAmount");
      const note = optString(args, "note") ?? null;
      return upsertSubscriptionPeriod(orgId, subscriptionId, periodStart, expectedAmount, note);
    },
  },

  delete_subscription_period: {
    description:
      "Remove the expected-amount 應收 override for one billing period of a subscription. The period falls back to the subscription's default amount.",
    inputSchema: {
      type: "object",
      properties: {
        subscriptionId: { type: "number" },
        periodStart: { type: "string", description: "The period's start date (YYYY-MM-DD)." },
        ...ORG_ARG,
      },
      required: ["subscriptionId", "periodStart"],
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        deleted: { type: "boolean" },
        subscriptionId: { type: "number" },
        periodStart: { type: "string", description: "YYYY-MM-DD." },
      },
      required: ["deleted", "subscriptionId", "periodStart"],
      additionalProperties: false,
    },
    execute: async (args, ctx) => {
      const orgId = await resolveOrg(args, ctx);
      const subscriptionId = requireNumber(args, "subscriptionId");
      const db = getDb();
      await assertInOrg(db, subscriptions, subscriptionId, orgId, "Subscription");
      const periodStart = requireDate(args, "periodStart");
      const deleted = await deleteSubscriptionPeriod(orgId, subscriptionId, periodStart);
      if (!deleted) {
        throw new Error(
          `No 應收 override found for subscription ${subscriptionId} period ${periodStart}.`,
        );
      }
      return { deleted: true, subscriptionId, periodStart };
    },
  },

  list_contracts: {
    description:
      "Client contracts with amount, term (start/end), status (draft/active/completed/cancelled), effective 營業稅別 (taxTreatment/amountBasis) with the amount split into net (未稅, use for revenue) / tax / gross (含稅, what the customer pays), and collection progress: received (已收, sum of linked income txns in the contract currency), remaining (未收 = gross - received), and cost (linked expense/advance — for reference only, NOT deducted from the amount). Status is stored, not derived: a contract stays active even after 未收 hits 0. Whenever a row is still draft/active with remaining <= 0, point it out to the user and ask whether to close it with update_contract status='completed' (已完成).",
    inputSchema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["draft", "active", "completed", "cancelled"],
          description: "Optional status filter; defaults to all.",
        },
        ...ORG_ARG,
      },
      additionalProperties: false,
    },
    outputSchema: listSchema(CONTRACT_LIST_ROW),
    execute: async (args, ctx) => {
      const orgId = await resolveOrg(args, ctx);
      const status = optString(args, "status");
      const db = getDb();
      const where = status
        ? and(
            eq(contracts.organizationId, orgId),
            eq(contracts.status, status),
            isNull(contracts.deletedAt),
          )
        : and(eq(contracts.organizationId, orgId), isNull(contracts.deletedAt));
      // 已收來自有效收款分配（src/db/allocations.ts，與合約頁同一個口徑）；cost＝綁定此合約、同幣別的 expense/advance。
      const costSum = sql<string>`coalesce(sum(${transactions.amount}) filter (where ${transactions.type} in ('expense','advance')), 0)`;
      const rows = await db
        .select({
          id: contracts.id,
          title: contracts.title,
          amount: contracts.amount,
          currency: contracts.currency,
          startDate: contracts.startDate,
          endDate: contracts.endDate,
          status: contracts.status,
          fileUrl: contracts.fileUrl,
          customer: parties.name,
          ownTaxTreatment: contracts.taxTreatment,
          ownAmountBasis: contracts.amountBasis,
          cost: costSum,
        })
        .from(contracts)
        .leftJoin(parties, eq(contracts.customerPartyId, parties.id))
        .leftJoin(
          transactions,
          and(
            eq(transactions.contractId, contracts.id),
            eq(transactions.currency, contracts.currency),
            isNull(transactions.deletedAt),
          ),
        )
        .where(where)
        .groupBy(contracts.id, parties.name)
        .orderBy(desc(contracts.id));
      const [orgTax, collected] = await Promise.all([
        getOrgTaxSetting(orgId),
        contractCollected(orgId, rows.map((r) => r.id)),
      ]);
      return listResult(
        rows.map(({ ownTaxTreatment, ownAmountBasis, ...r }) => {
          const got = collected.get(r.id);
          const received = got?.paid ?? 0;
          const taxed = taxedAmountOrNull(
            r.amount,
            effectiveTaxSetting(orgTax, { taxTreatment: ownTaxTreatment, amountBasis: ownAmountBasis }),
            r.currency,
          );
          const { remaining } = collectionProgress(taxed.gross, received);
          return {
            ...r,
            ...taxed,
            received,
            feeAbsorbed: got?.fee ?? 0,
            cost: Number(r.cost),
            remaining,
          };
        }),
      );
    },
  },

  list_projects: {
    description:
      "Client projects with their customer, derived status and per-project P&L (TWD). A project is made of its contracts and subscriptions: its status is derived from them (see derivedStatus) and its income/expense include every transaction linked to it directly or through its contracts, subscriptions or billing items. When a row has a `hint` (all contracts done), tell the user and ask whether to archive — never archive on your own.",
    inputSchema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["active", "archived"],
          description: "Optional filter on the stored manual status; defaults to all.",
        },
        derivedStatus: {
          type: "string",
          enum: [...DERIVED_PROJECT_STATUS],
          description: "Optional filter on the derived status.",
        },
        ...ORG_ARG,
      },
      additionalProperties: false,
    },
    outputSchema: listSchema(PROJECT_LIST_ROW),
    execute: async (args, ctx) => {
      const orgId = await resolveOrg(args, ctx);
      const status = optString(args, "status");
      const derived = optString(args, "derivedStatus");
      const rows = (await listProjects(orgId))
        .filter((r) => (status ? r.status === status : true))
        .filter((r) => (derived ? r.derivedStatus === derived : true))
        .sort((a, b) => a.name.localeCompare(b.name));
      return listResult(
        rows.map((r) => ({
          id: r.id,
          name: r.name,
          status: r.status,
          derivedStatus: r.derivedStatus,
          // 只提示、不改狀態：封存與否由使用者決定
          hint: r.readyToClose
            ? `專案「${r.name}」底下的合約都已完成或取消，也沒有進行中的訂閱，可以結案（封存）。` +
              '請先詢問使用者；同意後才呼叫 update_project({ id, status: "archived" })。'
            : null,
          description: r.description,
          client: r.clientName,
          clientPartyId: r.clientPartyId,
          contractCount: r.contractCount,
          subscriptionCount: r.subscriptionCount,
          income: r.income,
          expense: r.expense,
          net: r.net,
        })),
      );
    },
  },

  list_customers: {
    description:
      "Customer parties (the people/companies you bill). Use the returned id as customerPartyId. (list_parties is the more general version.)",
    inputSchema: {
      type: "object",
      properties: { ...ORG_ARG },
      additionalProperties: false,
    },
    outputSchema: listSchema(CUSTOMER_LIST_ROW),
    execute: async (args, ctx) => {
      const orgId = await resolveOrg(args, ctx);
      const db = getDb();
      const rows = await db
        .select({
          id: parties.id,
          name: parties.name,
          taxId: parties.taxId,
          defaultCurrency: parties.defaultCurrency,
          contact: parties.contact,
        })
        .from(parties)
        .where(
          and(
            eq(parties.organizationId, orgId),
            eq(parties.label, "customer"),
            eq(parties.isActive, true),
            isNull(parties.deletedAt),
          ),
        )
        .orderBy(asc(parties.name));
      return listResult(rows);
    },
  },

  list_activity: {
    description:
      "Org activity / audit log: who (web or MCP) did create/update/delete on which entity, newest first — plus 'read' entries for employee-PII reads via MCP. Use to investigate mis-recorded or wrongly-deleted data. Filter by entityType (transaction, party, category, bank_account, employee, invoice, reconciliation, project, subscription, contract, document, payroll_run, payslip) and/or action (create|update|delete|read). Each row says whether it can be undone right now (undoable) and, if not, why (undoBlockedReason); undo with undo_activity.",
    inputSchema: {
      type: "object",
      properties: {
        entityType: { type: "string" },
        action: { type: "string", enum: ["create", "update", "delete", "read"] },
        limit: { type: "number", description: "Default 200." },
        ...ORG_ARG,
      },
      additionalProperties: false,
    },
    outputSchema: listSchema(ACTIVITY_ROW),
    execute: async (args, ctx) => {
      const orgId = await resolveOrg(args, ctx);
      const rows = await listActivity(orgId, {
        entityType: optString(args, "entityType"),
        action: optString(args, "action"),
        limit: optNumber(args, "limit"),
      });
      const caller = { userId: ctx.userId, role: await getOrgRole(orgId, ctx.userId) };
      const plans = await planUndoMany(
        orgId,
        rows.map((r) => r.id),
        caller,
        "en",
      );
      return listResult(
        rows.map((r) => {
          const plan = plans.get(r.id);
          return {
            ...r,
            undoable: plan?.ok === true,
            undoBlockedReason: plan && !plan.ok ? plan.reason : null,
          };
        }),
      );
    },
  },

  undo_activity: {
    description:
      "Undo one activity-log entry: a create is deleted again (soft delete where the table has one), an update has its changed fields set back, a delete is brought back. To undo something the user just did in this conversation, find the activity with list_activity (filter by entityType / newest first, actor = the user) and call undo_activity; the app shows a confirmation card. The undo is itself logged and can be undone again (redo). Refused — with the reason and what to do instead — for reads, entries without saved data (older than this feature), external effects (Simpany e-invoices issued/voided: void the invoice instead; salary filings / tax uploads; sent notifications; calendar sync) and multi-row operations (bulk_create_transactions, merge_parties, pay_employee_salary, set_payment_allocations), or when the record was changed again afterwards. Only the member who made the change, or an owner/admin, may undo it.",
    annotations: { destructiveHint: true, idempotentHint: false },
    inputSchema: {
      type: "object",
      properties: {
        activityId: { type: "number", description: "Activity entry id from list_activity." },
        ...ORG_ARG,
      },
      required: ["activityId"],
      additionalProperties: false,
    },
    outputSchema: UNDO_RESULT,
    execute: async (args, ctx) => {
      const orgId = await resolveOrg(args, ctx);
      const activityId = requireNumber(args, "activityId");
      const caller = { userId: ctx.userId, role: await getOrgRole(orgId, ctx.userId) };
      const res = await executeUndo({ orgId, activityId, caller, channel: undoChannel(ctx), locale: "en" });
      if (!res.ok) throw new Error(res.reason);
      return {
        activityId: res.activityId,
        undoneActivityId: res.undoneActivityId,
        kind: res.kind,
        entityType: res.entityType,
        entityId: res.rowId,
        restoredFields: res.restoredFields,
        summary: res.summary,
      };
    },
  },

};

export const tools: Record<string, ToolDef> = {
  ...billingTools,
  ...orgTools,
  ...billingItemTools,
  ...accountingTools,
  ...transactionTools,
  ...allocationTools,
  ...clientTools,
  ...hrTools,
  ...integrationTools,
  ...employeeAccountTools,
  ...wiseTools,
  ...simpanyTools,
  ...vendorBillingTools,
  ...recurringExpenseTools,
  ...settingsTools,
  ...vendorBillingAdminTools,
  ...linkTools,
  ...aiRuleTools,
};

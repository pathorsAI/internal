import { addDays, differenceInCalendarDays, format, parseISO } from "date-fns";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { billingItems, contracts, parties, projects, subscriptions, transactions } from "@/db/schema";
import {
  deleteSubscriptionPeriod,
  getSubscriptionSchedule,
  listActivity,
  listMyOrgs,
  upsertSubscriptionPeriod,
} from "@/db/queries";
import {
  assertInOrg,
  nextChargeDate,
  optNumber,
  optString,
  ORG_ARG,
  requireDate,
  requireNumber,
  resolveOrg,
  todayStr,
  type ToolContext,
  type ToolDef,
} from "./shared";
import { accountingTools } from "./tools-accounting";
import { transactionTools } from "./tools-transactions";
import { clientTools } from "./tools-client";
import { hrTools } from "./tools-hr";
import { billingItemTools } from "./tools-billing";

export type { ToolContext, ToolDef };

// Discovery + the recurring-billing tools. Domain CRUD lives in the tools-*.ts
// modules and is merged into `tools` at the bottom.
const billingTools: Record<string, ToolDef> = {
  list_organizations: {
    description:
      "List the organizations the signed-in user can access. Call this FIRST in a session, show the user the options, and ask which organization to work in — then pass the chosen value as `organizationId` to every other tool. Required when the account belongs to more than one organization.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    execute: async (_args, ctx) => {
      const orgs = await listMyOrgs(ctx.userId);
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
      "Upcoming charges within the next N days, from BOTH active recurring subscriptions (next charge computed from start_date + interval_months) and scheduled one-off billing items (contract instalments / project milestones). Use this to answer 'who do I need to bill, and when'. For the full picture including overdue and unpaid items, use list_billing_status.",
    inputSchema: {
      type: "object",
      properties: {
        days: { type: "number", description: "Look-ahead window in days (default 60)." },
        ...ORG_ARG,
      },
      additionalProperties: false,
    },
    execute: async (args, ctx) => {
      const days = optNumber(args, "days") ?? 60;
      const orgId = await resolveOrg(args, ctx);
      const db = getDb();
      const today = todayStr();
      const horizon = format(addDays(parseISO(today), days), "yyyy-MM-dd");

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
        })
        .from(subscriptions)
        .leftJoin(parties, eq(subscriptions.customerPartyId, parties.id))
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
        })
        .from(billingItems)
        .leftJoin(parties, eq(billingItems.customerPartyId, parties.id))
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
        note: "subscription_projected rows are computed from the subscription schedule; billing_item rows are explicitly scheduled charges that have not been billed yet. Overdue items are NOT included here — use list_billing_status for those.",
      };
    },
  },

  list_subscriptions: {
    description:
      "Recurring subscriptions / retainers with their interval and the next computed charge date. Filter by status (active/paused/ended).",
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
        })
        .from(subscriptions)
        .leftJoin(parties, eq(subscriptions.customerPartyId, parties.id))
        .where(where)
        .orderBy(asc(subscriptions.startDate));
      return rows.map((s) => ({
        ...s,
        nextChargeDate:
          s.status === "active"
            ? nextChargeDate(s.startDate, s.intervalMonths, today, s.endDate)
            : null,
      }));
    },
  },

  get_subscription_schedule: {
    description:
      "Per-period collection status for one subscription: lists each billing period (from start_date + interval_months, up to and including the next due one) with 應收/已收 and a status — paid (已收滿), partial (部分), overdue (未收且已到期), upcoming (未到期). Income transactions linked to the subscription via subscriptionId + subscriptionPeriod count toward that period's 已收. Use this to answer 'which 期/季 is collected vs outstanding'. totalOutstanding sums the未收 of every non-upcoming period.",
    inputSchema: {
      type: "object",
      properties: {
        subscriptionId: { type: "number" },
        ...ORG_ARG,
      },
      required: ["subscriptionId"],
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
      "Set (upsert) the expected amount 應收 for one billing period of a subscription. Use for irregular periods (e.g. a 2-month transition quarter). periodStart is the period's start date.",
    inputSchema: {
      type: "object",
      properties: {
        subscriptionId: { type: "number" },
        periodStart: { type: "string", description: "The period's start date (YYYY-MM-DD)." },
        expectedAmount: { type: "number", description: "應收 for this period." },
        note: { type: "string", description: "Optional reason for the override." },
        ...ORG_ARG,
      },
      required: ["subscriptionId", "periodStart", "expectedAmount"],
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
      "Client contracts with amount, term (start/end), status (draft/active/completed/cancelled), and collection progress: received (已收, sum of linked income txns in the contract currency), remaining (未收 = amount - received), and cost (linked expense/advance — for reference only, NOT deducted from the amount). Status is stored, not derived: a contract stays active even after 未收 hits 0. Whenever a row is still draft/active with remaining <= 0, point it out to the user and ask whether to close it with update_contract status='completed' (已完成).",
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
      // 收款進度只計同幣別、綁定此合約的交易；income=已收，expense/advance=成本。
      const receivedSum = sql<string>`coalesce(sum(${transactions.amount}) filter (where ${transactions.type} = 'income'), 0)`;
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
          received: receivedSum,
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
      return rows.map((r) => {
        const received = Number(r.received);
        const remaining = r.amount == null ? null : Number(r.amount) - received;
        return { ...r, received, cost: Number(r.cost), remaining };
      });
    },
  },

  list_projects: {
    description: "Client projects with their owning customer and status (active/archived).",
    inputSchema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["active", "archived"],
          description: "Optional status filter; defaults to all.",
        },
        ...ORG_ARG,
      },
      additionalProperties: false,
    },
    execute: async (args, ctx) => {
      const orgId = await resolveOrg(args, ctx);
      const status = optString(args, "status");
      const db = getDb();
      const where = status
        ? and(
            eq(projects.organizationId, orgId),
            eq(projects.status, status),
            isNull(projects.deletedAt),
          )
        : and(eq(projects.organizationId, orgId), isNull(projects.deletedAt));
      return db
        .select({
          id: projects.id,
          name: projects.name,
          status: projects.status,
          description: projects.description,
          client: parties.name,
        })
        .from(projects)
        .leftJoin(parties, eq(projects.clientPartyId, parties.id))
        .where(where)
        .orderBy(asc(projects.name));
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
    execute: async (args, ctx) => {
      const orgId = await resolveOrg(args, ctx);
      const db = getDb();
      return db
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
    },
  },

  list_activity: {
    description:
      "Org activity / audit log: who (web or MCP) did create/update/delete on which entity, newest first — plus 'read' entries for employee-PII reads via MCP. Use to investigate mis-recorded or wrongly-deleted data. Filter by entityType (transaction, party, category, bank_account, employee, invoice, reconciliation, project, subscription, contract, document, payroll_run, payslip) and/or action (create|update|delete|read).",
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
    execute: async (args, ctx) => {
      const orgId = await resolveOrg(args, ctx);
      return listActivity(orgId, {
        entityType: optString(args, "entityType"),
        action: optString(args, "action"),
        limit: optNumber(args, "limit"),
      });
    },
  },

};

export const tools: Record<string, ToolDef> = {
  ...billingTools,
  ...billingItemTools,
  ...accountingTools,
  ...transactionTools,
  ...clientTools,
  ...hrTools,
};

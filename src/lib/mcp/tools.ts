import { addDays, differenceInCalendarDays, format, parseISO } from "date-fns";
import { and, asc, desc, eq, isNotNull, lte } from "drizzle-orm";
import { getDb } from "@/db";
import { contracts, parties, projects, receivables, subscriptions } from "@/db/schema";
import { listMyOrgs } from "@/db/queries";
import {
  assertInOrg,
  nextChargeDate,
  optDate,
  optNumber,
  optString,
  ORG_ARG,
  requireAmount,
  requireNumber,
  normalizeCurrency,
  resolveOrg,
  todayStr,
  type ToolContext,
  type ToolDef,
} from "./shared";
import { accountingTools } from "./tools-accounting";
import { transactionTools } from "./tools-transactions";
import { clientTools } from "./tools-client";
import { hrTools } from "./tools-hr";

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
      "The money you should be collecting. Lists overdue open receivables plus everything due within the next N days, AND the projected next charge of every active recurring subscription (computed from start_date + interval_months). Use this to answer 'who do I need to bill, and when'.",
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

      const recRows = await db
        .select({
          id: receivables.id,
          amount: receivables.amount,
          currency: receivables.currency,
          dueDate: receivables.dueDate,
          description: receivables.description,
          customer: parties.name,
          subscriptionId: receivables.subscriptionId,
          contractId: receivables.contractId,
        })
        .from(receivables)
        .leftJoin(parties, eq(receivables.customerPartyId, parties.id))
        .where(
          and(
            eq(receivables.organizationId, orgId),
            eq(receivables.status, "open"),
            isNotNull(receivables.dueDate),
            lte(receivables.dueDate, horizon),
          ),
        );

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
          and(eq(subscriptions.organizationId, orgId), eq(subscriptions.status, "active")),
        );

      type Item = {
        kind: "receivable" | "subscription_projected";
        id: number;
        customer: string | null;
        label: string | null;
        amount: string;
        currency: string;
        date: string;
        daysUntilDue: number;
      };
      const items: Item[] = [];

      for (const r of recRows) {
        const date = r.dueDate as string;
        items.push({
          kind: "receivable",
          id: r.id,
          customer: r.customer,
          label: r.description,
          amount: r.amount,
          currency: r.currency,
          date,
          daysUntilDue: differenceInCalendarDays(parseISO(date), parseISO(today)),
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
      const overdue = items.filter((i) => i.daysUntilDue < 0);
      const upcoming = items.filter((i) => i.daysUntilDue >= 0);

      return {
        today,
        windowDays: days,
        overdueCount: overdue.length,
        upcomingCount: upcoming.length,
        overdue,
        upcoming,
        note: "subscription_projected rows are computed (not yet invoiced); receivable rows already exist in the ledger.",
      };
    },
  },

  list_overdue_receivables: {
    description:
      "Open receivables whose due date is already in the past, oldest first. Money you were supposed to have collected.",
    inputSchema: {
      type: "object",
      properties: { ...ORG_ARG },
      additionalProperties: false,
    },
    execute: async (args, ctx) => {
      const orgId = await resolveOrg(args, ctx);
      const db = getDb();
      const today = todayStr();
      const rows = await db
        .select({
          id: receivables.id,
          amount: receivables.amount,
          currency: receivables.currency,
          dueDate: receivables.dueDate,
          description: receivables.description,
          customer: parties.name,
        })
        .from(receivables)
        .leftJoin(parties, eq(receivables.customerPartyId, parties.id))
        .where(
          and(
            eq(receivables.organizationId, orgId),
            eq(receivables.status, "open"),
            isNotNull(receivables.dueDate),
            lte(receivables.dueDate, today),
          ),
        )
        .orderBy(asc(receivables.dueDate));
      return rows.map((r) => ({
        ...r,
        daysOverdue: r.dueDate
          ? differenceInCalendarDays(parseISO(today), parseISO(r.dueDate))
          : null,
      }));
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
        ? and(eq(subscriptions.organizationId, orgId), eq(subscriptions.status, status))
        : eq(subscriptions.organizationId, orgId);
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

  list_receivables: {
    description:
      "Accounts receivable, newest first. Filter by status (open/paid/void) and/or a customer party id.",
    inputSchema: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["open", "paid", "void"],
          description: "Optional status filter; defaults to all.",
        },
        customerPartyId: { type: "number", description: "Optional customer (party) id filter." },
        ...ORG_ARG,
      },
      additionalProperties: false,
    },
    execute: async (args, ctx) => {
      const orgId = await resolveOrg(args, ctx);
      const status = optString(args, "status");
      const customerPartyId = optNumber(args, "customerPartyId");
      const db = getDb();
      if (customerPartyId !== undefined) {
        await assertInOrg(db, parties, customerPartyId, orgId, "Customer");
      }
      const filters = [eq(receivables.organizationId, orgId)];
      if (status) filters.push(eq(receivables.status, status));
      if (customerPartyId !== undefined) {
        filters.push(eq(receivables.customerPartyId, customerPartyId));
      }
      return db
        .select({
          id: receivables.id,
          amount: receivables.amount,
          currency: receivables.currency,
          dueDate: receivables.dueDate,
          status: receivables.status,
          description: receivables.description,
          paidAt: receivables.paidAt,
          customer: parties.name,
        })
        .from(receivables)
        .leftJoin(parties, eq(receivables.customerPartyId, parties.id))
        .where(and(...filters))
        .orderBy(desc(receivables.id));
    },
  },

  list_contracts: {
    description:
      "Client contracts with amount, term (start/end), and status (draft/active/completed/cancelled).",
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
        ? and(eq(contracts.organizationId, orgId), eq(contracts.status, status))
        : eq(contracts.organizationId, orgId);
      return db
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
        })
        .from(contracts)
        .leftJoin(parties, eq(contracts.customerPartyId, parties.id))
        .where(where)
        .orderBy(desc(contracts.id));
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
        ? and(eq(projects.organizationId, orgId), eq(projects.status, status))
        : eq(projects.organizationId, orgId);
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
          ),
        )
        .orderBy(asc(parties.name));
    },
  },

  mark_receivable_paid: {
    description:
      "Lightweight: flag an open receivable as paid (status=paid, paid_at) WITHOUT a ledger entry. Prefer collect_receivable, which also records the income transaction.",
    inputSchema: {
      type: "object",
      properties: {
        receivableId: { type: "number", description: "The receivable id." },
        paidAt: { type: "string", description: "Payment date (YYYY-MM-DD). Defaults to today." },
        ...ORG_ARG,
      },
      required: ["receivableId"],
      additionalProperties: false,
    },
    execute: async (args, ctx) => {
      const id = requireNumber(args, "receivableId");
      const paidAt = optDate(args, "paidAt") ?? todayStr();
      const orgId = await resolveOrg(args, ctx);
      const db = getDb();
      const existing = await db
        .select()
        .from(receivables)
        .where(and(eq(receivables.id, id), eq(receivables.organizationId, orgId)))
        .limit(1);
      if (!existing[0]) {
        throw new Error(`Receivable ${id} not found in your organization.`);
      }
      if (existing[0].status === "void") {
        throw new Error(`Receivable ${id} is void and cannot be marked paid.`);
      }
      if (existing[0].status === "paid") {
        return { ...existing[0], note: "Already marked paid; no change made." };
      }
      const updated = await db
        .update(receivables)
        .set({ status: "paid", paidAt })
        .where(and(eq(receivables.id, id), eq(receivables.organizationId, orgId)))
        .returning();
      return updated[0];
    },
  },

  create_receivable: {
    description:
      "Create a new open receivable (something you intend to bill a customer for). Link it to a project/subscription/contract when relevant. Use list_parties / list_customers to find customerPartyId.",
    inputSchema: {
      type: "object",
      properties: {
        customerPartyId: { type: "number", description: "Customer (party) id. See list_customers." },
        amount: { type: "number", description: "Amount to bill (> 0)." },
        currency: { type: "string", description: "3-letter currency code; defaults to TWD." },
        dueDate: { type: "string", description: "When payment is due (YYYY-MM-DD). Recommended." },
        description: { type: "string", description: "What it's for." },
        projectId: { type: "number", description: "Optional project link." },
        subscriptionId: { type: "number", description: "Optional subscription link." },
        contractId: { type: "number", description: "Optional contract link." },
        ...ORG_ARG,
      },
      required: ["customerPartyId", "amount"],
      additionalProperties: false,
    },
    execute: async (args, ctx) => {
      const customerPartyId = requireNumber(args, "customerPartyId");
      const amount = requireAmount(args, "amount");
      const currency = normalizeCurrency(args);
      const dueDate = optDate(args, "dueDate") ?? null;
      const description = optString(args, "description") ?? null;
      const projectId = optNumber(args, "projectId") ?? null;
      const subscriptionId = optNumber(args, "subscriptionId") ?? null;
      const contractId = optNumber(args, "contractId") ?? null;
      const orgId = await resolveOrg(args, ctx);
      const db = getDb();

      const customer = await db
        .select({ id: parties.id })
        .from(parties)
        .where(and(eq(parties.id, customerPartyId), eq(parties.organizationId, orgId)))
        .limit(1);
      if (!customer[0]) {
        throw new Error(`Customer party ${customerPartyId} not found in your organization.`);
      }
      if (projectId !== null) await assertInOrg(db, projects, projectId, orgId, "Project");
      if (subscriptionId !== null)
        await assertInOrg(db, subscriptions, subscriptionId, orgId, "Subscription");
      if (contractId !== null) await assertInOrg(db, contracts, contractId, orgId, "Contract");

      const inserted = await db
        .insert(receivables)
        .values({
          organizationId: orgId,
          customerPartyId,
          amount,
          currency,
          dueDate,
          description,
          projectId,
          subscriptionId,
          contractId,
          status: "open",
        })
        .returning();
      return inserted[0];
    },
  },
};

export const tools: Record<string, ToolDef> = {
  ...billingTools,
  ...accountingTools,
  ...transactionTools,
  ...clientTools,
  ...hrTools,
};

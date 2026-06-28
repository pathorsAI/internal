import { addDays, differenceInCalendarDays, format, parseISO } from "date-fns";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { contracts, parties, projects, subscriptions, transactions } from "@/db/schema";
import { member, organization } from "@/db/auth-schema";
import { listMyOrgs } from "@/db/queries";
import {
  nextChargeDate,
  optNumber,
  optString,
  ORG_ARG,
  requireString,
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

  create_organization: {
    description:
      "Create a brand-new organization (a fresh, empty set of books) and add you (the signed-in user) as its owner. Use this to spin up a new company or a demo workspace. Returns the new org's id and slug — pass that slug (or id) as organizationId on every subsequent tool call to operate inside it. Confirm the name with the user first; this is not reversible from here.",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Display name, e.g. 示範科技股份有限公司.",
        },
        slug: {
          type: "string",
          description:
            "Optional URL-safe handle (lowercase letters, digits, hyphens). Must be unique; auto-generated if omitted.",
        },
      },
      required: ["name"],
      additionalProperties: false,
    },
    execute: async (args, ctx) => {
      const name = requireString(args, "name");
      if (name.length > 120) throw new Error('"name" must be 120 characters or fewer.');
      // Reject control characters (newlines, bidi, etc.) — the name is rendered
      // verbatim in the UI and echoed back in tool output.
      if (/[\u0000-\u001f\u007f]/.test(name)) {
        throw new Error('"name" must not contain control characters.');
      }
      let slug = optString(args, "slug")?.toLowerCase();
      const slugProvided = slug !== undefined;
      if (slug !== undefined && !/^[a-z0-9-]+$/.test(slug)) {
        throw new Error(
          '"slug" may only contain lowercase letters, digits, and hyphens.',
        );
      }
      // Auto-generated slug carries a random suffix so concurrent/retried calls
      // don't collide on the millisecond timestamp.
      if (slug === undefined) slug = `org-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;

      const db = getDb();
      // better-auth uses opaque string ids; generate ones that won't collide
      // with its own. createdAt is left to the column default (defaultNow()).
      const orgId = `org_${crypto.randomUUID().replace(/-/g, "")}`;
      const memberId = `mem_${crypto.randomUUID().replace(/-/g, "")}`;

      let org: typeof organization.$inferSelect;
      try {
        [org] = await db
          .insert(organization)
          .values({ id: orgId, name, slug })
          .returning();
      } catch (e) {
        const err = e as { code?: string; cause?: { code?: string } };
        if (err?.code === "23505" || err?.cause?.code === "23505") {
          throw new Error(
            slugProvided
              ? `An organization with slug "${slug}" already exists — choose a different slug.`
              : "Could not allocate a unique slug — please retry.",
          );
        }
        throw e instanceof Error ? e : new Error(String(e));
      }

      // Make the caller the owner so they can immediately operate on the org
      // (resolveOrgId derives access from member rows). neon-http has no
      // interactive transactions, so these two inserts aren't atomic: if the
      // member insert fails, roll the org back by hand — otherwise it's an
      // ownerless, unreachable orphan that also permanently burns the slug.
      try {
        await db
          .insert(member)
          .values({ id: memberId, organizationId: org.id, userId: ctx.userId, role: "owner" });
      } catch (e) {
        try {
          await db.delete(organization).where(eq(organization.id, org.id));
        } catch {
          // best-effort cleanup; surface the original failure regardless
        }
        throw e instanceof Error ? e : new Error(String(e));
      }

      return {
        organizationId: org.slug ?? org.id,
        id: org.id,
        slug: org.slug,
        name: org.name,
        role: "owner",
        hint: "Pass organizationId on subsequent tool calls to work inside this org.",
      };
    },
  },

  list_upcoming_billing: {
    description:
      "Projected upcoming charges from active recurring subscriptions (next charge computed from start_date + interval_months), within the next N days. Use this to answer 'who do I need to bill, and when'. One-off contract collection is tracked via contracts (已收/未收), not here.",
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
          and(eq(subscriptions.organizationId, orgId), eq(subscriptions.status, "active")),
        );

      type Item = {
        kind: "subscription_projected";
        id: number;
        customer: string | null;
        label: string;
        amount: string;
        currency: string;
        date: string;
        daysUntilDue: number;
      };
      const items: Item[] = [];

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
        note: "subscription_projected rows are computed (not yet invoiced).",
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

  list_contracts: {
    description:
      "Client contracts with amount, term (start/end), status (draft/active/completed/cancelled), and collection progress: received (已收, sum of linked income txns in the contract currency), remaining (未收 = amount - received), and cost (linked expense/advance — for reference only, NOT deducted from the amount).",
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

};

export const tools: Record<string, ToolDef> = {
  ...billingTools,
  ...accountingTools,
  ...transactionTools,
  ...clientTools,
  ...hrTools,
};

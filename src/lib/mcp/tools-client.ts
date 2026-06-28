import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { contracts, parties, projects, subscriptions } from "@/db/schema";
import {
  assertInOrg,
  normalizeCurrency,
  optDecimal,
  optNumber,
  optString,
  ORG_ARG,
  requireAmount,
  requireDate,
  requireNumber,
  requireString,
  resolveOrg,
  type ToolDef,
} from "./shared";

const PROJECT_STATUS = ["active", "archived"] as const;
const SUB_STATUS = ["active", "paused", "ended"] as const;
const CONTRACT_STATUS = ["draft", "active", "completed", "cancelled"] as const;

function checkEnum(v: string | undefined, allowed: readonly string[], field: string) {
  if (v !== undefined && !allowed.includes(v)) {
    throw new Error(`"${field}" must be one of: ${allowed.join(", ")}.`);
  }
}

export const clientTools: Record<string, ToolDef> = {
  // ---- projects ----
  create_project: {
    description: "Create a client project. Per-project P&L is computed from tagged transactions.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        clientPartyId: { type: "number", description: "Owning customer; see list_parties." },
        status: { type: "string", enum: [...PROJECT_STATUS], description: "Default active." },
        description: { type: "string" },
        ...ORG_ARG,
      },
      required: ["name"],
      additionalProperties: false,
    },
    execute: async (args, ctx) => {
      const orgId = await resolveOrg(args, ctx);
      const db = getDb();
      const clientPartyId = optNumber(args, "clientPartyId");
      if (clientPartyId !== undefined) await assertInOrg(db, parties, clientPartyId, orgId, "Party");
      checkEnum(optString(args, "status"), PROJECT_STATUS, "status");
      const [row] = await db
        .insert(projects)
        .values({
          organizationId: orgId,
          name: requireString(args, "name"),
          clientPartyId: clientPartyId ?? null,
          status: optString(args, "status") ?? "active",
          description: optString(args, "description") ?? null,
        })
        .returning();
      return row;
    },
  },

  update_project: {
    description: "Update a project (only provided fields). Set status=archived to retire it.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number" },
        name: { type: "string" },
        clientPartyId: { type: "number" },
        status: { type: "string", enum: [...PROJECT_STATUS] },
        description: { type: "string" },
        ...ORG_ARG,
      },
      required: ["id"],
      additionalProperties: false,
    },
    execute: async (args, ctx) => {
      const id = requireNumber(args, "id");
      const orgId = await resolveOrg(args, ctx);
      const db = getDb();
      const clientPartyId = optNumber(args, "clientPartyId");
      if (clientPartyId !== undefined) await assertInOrg(db, parties, clientPartyId, orgId, "Party");
      checkEnum(optString(args, "status"), PROJECT_STATUS, "status");
      const patch: Record<string, unknown> = {};
      if (optString(args, "name") !== undefined) patch.name = requireString(args, "name");
      if (clientPartyId !== undefined) patch.clientPartyId = clientPartyId;
      if (optString(args, "status") !== undefined) patch.status = optString(args, "status");
      if (optString(args, "description") !== undefined)
        patch.description = optString(args, "description");
      if (Object.keys(patch).length === 0) throw new Error("Nothing to update.");
      const [row] = await db
        .update(projects)
        .set(patch)
        .where(and(eq(projects.organizationId, orgId), eq(projects.id, id)))
        .returning();
      if (!row) throw new Error(`Project ${id} not found in your organization.`);
      return row;
    },
  },

  delete_project: {
    description: "Delete a project. Fails if used by transactions/contracts/subscriptions — archive instead.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "number" }, ...ORG_ARG },
      required: ["id"],
      additionalProperties: false,
    },
    execute: async (args, ctx) => {
      const id = requireNumber(args, "id");
      const orgId = await resolveOrg(args, ctx);
      const db = getDb();
      await assertInOrg(db, projects, id, orgId, "Project");
      await db
        .update(projects)
        .set({ deletedAt: new Date().toISOString() })
        .where(and(eq(projects.organizationId, orgId), eq(projects.id, id)));
      return { deleted: true, id };
    },
  },

  // ---- subscriptions (recurring billing) ----
  create_subscription: {
    description:
      "Create a recurring subscription/retainer. intervalMonths controls how often it bills (1=monthly, 3=quarterly, 12=yearly).",
    inputSchema: {
      type: "object",
      properties: {
        customerPartyId: { type: "number", description: "See list_parties (label=customer)." },
        projectId: { type: "number" },
        name: { type: "string" },
        amount: { type: "number" },
        currency: { type: "string", description: "3-letter; default TWD." },
        intervalMonths: { type: "number", description: "Default 1." },
        startDate: { type: "string", description: "YYYY-MM-DD." },
        endDate: { type: "string", description: "YYYY-MM-DD; optional." },
        status: { type: "string", enum: [...SUB_STATUS], description: "Default active." },
        note: { type: "string" },
        ...ORG_ARG,
      },
      required: ["customerPartyId", "name", "amount", "startDate"],
      additionalProperties: false,
    },
    execute: async (args, ctx) => {
      const orgId = await resolveOrg(args, ctx);
      const db = getDb();
      const customerPartyId = requireNumber(args, "customerPartyId");
      await assertInOrg(db, parties, customerPartyId, orgId, "Customer");
      const projectId = optNumber(args, "projectId");
      if (projectId !== undefined) await assertInOrg(db, projects, projectId, orgId, "Project");
      checkEnum(optString(args, "status"), SUB_STATUS, "status");
      const [row] = await db
        .insert(subscriptions)
        .values({
          organizationId: orgId,
          customerPartyId,
          projectId: projectId ?? null,
          name: requireString(args, "name"),
          amount: requireAmount(args, "amount"),
          currency: normalizeCurrency(args, "currency"),
          intervalMonths: optNumber(args, "intervalMonths") ?? 1,
          startDate: requireDate(args, "startDate"),
          endDate: optString(args, "endDate") ?? null,
          status: optString(args, "status") ?? "active",
          note: optString(args, "note") ?? null,
        })
        .returning();
      return row;
    },
  },

  update_subscription: {
    description: "Update a subscription (only provided fields). Set status=paused/ended to stop billing.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number" },
        customerPartyId: { type: "number" },
        projectId: { type: "number" },
        name: { type: "string" },
        amount: { type: "number" },
        currency: { type: "string" },
        intervalMonths: { type: "number" },
        startDate: { type: "string", description: "YYYY-MM-DD." },
        endDate: { type: "string", description: "YYYY-MM-DD." },
        status: { type: "string", enum: [...SUB_STATUS] },
        note: { type: "string" },
        ...ORG_ARG,
      },
      required: ["id"],
      additionalProperties: false,
    },
    execute: async (args, ctx) => {
      const id = requireNumber(args, "id");
      const orgId = await resolveOrg(args, ctx);
      const db = getDb();
      const customerPartyId = optNumber(args, "customerPartyId");
      if (customerPartyId !== undefined) await assertInOrg(db, parties, customerPartyId, orgId, "Customer");
      const projectId = optNumber(args, "projectId");
      if (projectId !== undefined) await assertInOrg(db, projects, projectId, orgId, "Project");
      checkEnum(optString(args, "status"), SUB_STATUS, "status");
      const patch: Record<string, unknown> = {};
      if (customerPartyId !== undefined) patch.customerPartyId = customerPartyId;
      if (projectId !== undefined) patch.projectId = projectId;
      if (optString(args, "name") !== undefined) patch.name = requireString(args, "name");
      if (optNumber(args, "amount") !== undefined) patch.amount = requireAmount(args, "amount");
      if (optString(args, "currency") !== undefined) patch.currency = normalizeCurrency(args, "currency");
      if (optNumber(args, "intervalMonths") !== undefined)
        patch.intervalMonths = requireNumber(args, "intervalMonths");
      if (optString(args, "startDate") !== undefined) patch.startDate = requireDate(args, "startDate");
      if (optString(args, "endDate") !== undefined) patch.endDate = optString(args, "endDate");
      if (optString(args, "status") !== undefined) patch.status = optString(args, "status");
      if (optString(args, "note") !== undefined) patch.note = optString(args, "note");
      if (Object.keys(patch).length === 0) throw new Error("Nothing to update.");
      const [row] = await db
        .update(subscriptions)
        .set(patch)
        .where(and(eq(subscriptions.organizationId, orgId), eq(subscriptions.id, id)))
        .returning();
      if (!row) throw new Error(`Subscription ${id} not found in your organization.`);
      return row;
    },
  },

  delete_subscription: {
    description: "Delete a subscription.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "number" }, ...ORG_ARG },
      required: ["id"],
      additionalProperties: false,
    },
    execute: async (args, ctx) => {
      const id = requireNumber(args, "id");
      const orgId = await resolveOrg(args, ctx);
      const db = getDb();
      await assertInOrg(db, subscriptions, id, orgId, "Subscription");
      await db
        .update(subscriptions)
        .set({ deletedAt: new Date().toISOString() })
        .where(and(eq(subscriptions.organizationId, orgId), eq(subscriptions.id, id)));
      return { deleted: true, id };
    },
  },

  // ---- contracts ----
  create_contract: {
    description: "Create a client contract.",
    inputSchema: {
      type: "object",
      properties: {
        customerPartyId: { type: "number" },
        projectId: { type: "number" },
        title: { type: "string" },
        amount: { type: "number", description: "Total value; optional." },
        currency: { type: "string", description: "3-letter; default TWD." },
        startDate: { type: "string", description: "YYYY-MM-DD." },
        endDate: { type: "string", description: "YYYY-MM-DD." },
        status: { type: "string", enum: [...CONTRACT_STATUS], description: "Default active." },
        note: { type: "string" },
        fileUrl: { type: "string", description: "Link to the signed contract file, e.g. Google Drive." },
        ...ORG_ARG,
      },
      required: ["customerPartyId", "title"],
      additionalProperties: false,
    },
    execute: async (args, ctx) => {
      const orgId = await resolveOrg(args, ctx);
      const db = getDb();
      const customerPartyId = requireNumber(args, "customerPartyId");
      await assertInOrg(db, parties, customerPartyId, orgId, "Customer");
      const projectId = optNumber(args, "projectId");
      if (projectId !== undefined) await assertInOrg(db, projects, projectId, orgId, "Project");
      checkEnum(optString(args, "status"), CONTRACT_STATUS, "status");
      const [row] = await db
        .insert(contracts)
        .values({
          organizationId: orgId,
          customerPartyId,
          projectId: projectId ?? null,
          title: requireString(args, "title"),
          amount: optDecimal(args, "amount") ?? null,
          currency: normalizeCurrency(args, "currency"),
          startDate: optString(args, "startDate") ?? null,
          endDate: optString(args, "endDate") ?? null,
          status: optString(args, "status") ?? "active",
          note: optString(args, "note") ?? null,
          fileUrl: optString(args, "fileUrl") ?? null,
        })
        .returning();
      return row;
    },
  },

  update_contract: {
    description: "Update a contract (only provided fields).",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number" },
        customerPartyId: { type: "number" },
        projectId: { type: "number" },
        title: { type: "string" },
        amount: { type: "number" },
        currency: { type: "string" },
        startDate: { type: "string", description: "YYYY-MM-DD." },
        endDate: { type: "string", description: "YYYY-MM-DD." },
        status: { type: "string", enum: [...CONTRACT_STATUS] },
        note: { type: "string" },
        fileUrl: { type: "string" },
        ...ORG_ARG,
      },
      required: ["id"],
      additionalProperties: false,
    },
    execute: async (args, ctx) => {
      const id = requireNumber(args, "id");
      const orgId = await resolveOrg(args, ctx);
      const db = getDb();
      const customerPartyId = optNumber(args, "customerPartyId");
      if (customerPartyId !== undefined) await assertInOrg(db, parties, customerPartyId, orgId, "Customer");
      const projectId = optNumber(args, "projectId");
      if (projectId !== undefined) await assertInOrg(db, projects, projectId, orgId, "Project");
      checkEnum(optString(args, "status"), CONTRACT_STATUS, "status");
      const patch: Record<string, unknown> = {};
      if (customerPartyId !== undefined) patch.customerPartyId = customerPartyId;
      if (projectId !== undefined) patch.projectId = projectId;
      if (optString(args, "title") !== undefined) patch.title = requireString(args, "title");
      if (optNumber(args, "amount") !== undefined) patch.amount = optDecimal(args, "amount");
      if (optString(args, "currency") !== undefined) patch.currency = normalizeCurrency(args, "currency");
      if (optString(args, "startDate") !== undefined) patch.startDate = optString(args, "startDate");
      if (optString(args, "endDate") !== undefined) patch.endDate = optString(args, "endDate");
      if (optString(args, "status") !== undefined) patch.status = optString(args, "status");
      if (optString(args, "note") !== undefined) patch.note = optString(args, "note");
      if (optString(args, "fileUrl") !== undefined) patch.fileUrl = optString(args, "fileUrl");
      if (Object.keys(patch).length === 0) throw new Error("Nothing to update.");
      const [row] = await db
        .update(contracts)
        .set(patch)
        .where(and(eq(contracts.organizationId, orgId), eq(contracts.id, id)))
        .returning();
      if (!row) throw new Error(`Contract ${id} not found in your organization.`);
      return row;
    },
  },

  delete_contract: {
    description: "Delete a contract. Fails if transactions are still linked to it (unbind them first).",
    inputSchema: {
      type: "object",
      properties: { id: { type: "number" }, ...ORG_ARG },
      required: ["id"],
      additionalProperties: false,
    },
    execute: async (args, ctx) => {
      const id = requireNumber(args, "id");
      const orgId = await resolveOrg(args, ctx);
      const db = getDb();
      await assertInOrg(db, contracts, id, orgId, "Contract");
      await db
        .update(contracts)
        .set({ deletedAt: new Date().toISOString() })
        .where(and(eq(contracts.organizationId, orgId), eq(contracts.id, id)));
      return { deleted: true, id };
    },
  },
};

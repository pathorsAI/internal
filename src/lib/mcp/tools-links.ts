import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { contracts, links, parties, projects, receivables, subscriptions } from "@/db/schema";
import { listLinks } from "@/db/queries";
import {
  assertInOrg,
  optNumber,
  optString,
  ORG_ARG,
  requireNumber,
  requireString,
  resolveOrg,
  type ToolDef,
} from "./shared";

export const linkTools: Record<string, ToolDef> = {
  list_links: {
    description:
      "List saved links (e.g. Google Drive contract URLs). Optionally filter by the entity they're attached to.",
    inputSchema: {
      type: "object",
      properties: {
        partyId: { type: "number" },
        projectId: { type: "number" },
        contractId: { type: "number" },
        subscriptionId: { type: "number" },
        receivableId: { type: "number" },
        ...ORG_ARG,
      },
      additionalProperties: false,
    },
    execute: async (args, ctx) => {
      const orgId = await resolveOrg(args, ctx);
      return listLinks(orgId, {
        partyId: optNumber(args, "partyId"),
        projectId: optNumber(args, "projectId"),
        contractId: optNumber(args, "contractId"),
        subscriptionId: optNumber(args, "subscriptionId"),
        receivableId: optNumber(args, "receivableId"),
      });
    },
  },

  create_link: {
    description:
      "Save a link — paste a URL (e.g. a Google Drive contract) with a title, optionally attached to a party/project/contract/subscription/receivable. Resolve ids via list_parties / list_projects / list_contracts / etc.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        url: { type: "string", description: "Any URL, e.g. https://drive.google.com/..." },
        note: { type: "string" },
        partyId: { type: "number" },
        projectId: { type: "number" },
        contractId: { type: "number" },
        subscriptionId: { type: "number" },
        receivableId: { type: "number" },
        ...ORG_ARG,
      },
      required: ["title", "url"],
      additionalProperties: false,
    },
    execute: async (args, ctx) => {
      const orgId = await resolveOrg(args, ctx);
      const db = getDb();
      const partyId = optNumber(args, "partyId");
      if (partyId !== undefined) await assertInOrg(db, parties, partyId, orgId, "Party");
      const projectId = optNumber(args, "projectId");
      if (projectId !== undefined) await assertInOrg(db, projects, projectId, orgId, "Project");
      const contractId = optNumber(args, "contractId");
      if (contractId !== undefined) await assertInOrg(db, contracts, contractId, orgId, "Contract");
      const subscriptionId = optNumber(args, "subscriptionId");
      if (subscriptionId !== undefined)
        await assertInOrg(db, subscriptions, subscriptionId, orgId, "Subscription");
      const receivableId = optNumber(args, "receivableId");
      if (receivableId !== undefined)
        await assertInOrg(db, receivables, receivableId, orgId, "Receivable");
      const [row] = await db
        .insert(links)
        .values({
          organizationId: orgId,
          title: requireString(args, "title"),
          url: requireString(args, "url"),
          note: optString(args, "note") ?? null,
          partyId: partyId ?? null,
          projectId: projectId ?? null,
          contractId: contractId ?? null,
          subscriptionId: subscriptionId ?? null,
          receivableId: receivableId ?? null,
        })
        .returning();
      return row;
    },
  },

  update_link: {
    description: "Update a saved link (only provided fields). Pass an entity id to (re)attach it.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number" },
        title: { type: "string" },
        url: { type: "string" },
        note: { type: "string" },
        partyId: { type: "number" },
        projectId: { type: "number" },
        contractId: { type: "number" },
        subscriptionId: { type: "number" },
        receivableId: { type: "number" },
        ...ORG_ARG,
      },
      required: ["id"],
      additionalProperties: false,
    },
    execute: async (args, ctx) => {
      const id = requireNumber(args, "id");
      const orgId = await resolveOrg(args, ctx);
      const db = getDb();
      await assertInOrg(db, links, id, orgId, "Link");
      const patch: Record<string, unknown> = {};
      if (optString(args, "title") !== undefined) patch.title = requireString(args, "title");
      if (optString(args, "url") !== undefined) patch.url = requireString(args, "url");
      if (optString(args, "note") !== undefined) patch.note = optString(args, "note");
      const partyId = optNumber(args, "partyId");
      if (partyId !== undefined) {
        await assertInOrg(db, parties, partyId, orgId, "Party");
        patch.partyId = partyId;
      }
      const projectId = optNumber(args, "projectId");
      if (projectId !== undefined) {
        await assertInOrg(db, projects, projectId, orgId, "Project");
        patch.projectId = projectId;
      }
      const contractId = optNumber(args, "contractId");
      if (contractId !== undefined) {
        await assertInOrg(db, contracts, contractId, orgId, "Contract");
        patch.contractId = contractId;
      }
      const subscriptionId = optNumber(args, "subscriptionId");
      if (subscriptionId !== undefined) {
        await assertInOrg(db, subscriptions, subscriptionId, orgId, "Subscription");
        patch.subscriptionId = subscriptionId;
      }
      const receivableId = optNumber(args, "receivableId");
      if (receivableId !== undefined) {
        await assertInOrg(db, receivables, receivableId, orgId, "Receivable");
        patch.receivableId = receivableId;
      }
      if (Object.keys(patch).length === 0) throw new Error("Nothing to update.");
      const [row] = await db
        .update(links)
        .set(patch)
        .where(and(eq(links.organizationId, orgId), eq(links.id, id)))
        .returning();
      return row;
    },
  },

  delete_link: {
    description: "Delete a saved link.",
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
      await assertInOrg(db, links, id, orgId, "Link");
      await db.delete(links).where(and(eq(links.organizationId, orgId), eq(links.id, id)));
      return { deleted: true, id };
    },
  },
};

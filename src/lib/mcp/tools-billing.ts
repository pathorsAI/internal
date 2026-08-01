import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { billingItems, contracts, parties, projects } from "@/db/schema";
import { organization } from "@/db/auth-schema";
import {
  getBillingItem,
  listBillingBoard,
  type BillingItemStatus,
} from "@/db/queries";
import {
  assertInOrg,
  normalizeCurrency,
  optBoolean,
  optDecimal,
  optNumber,
  optString,
  ORG_ARG,
  requireDecimal,
  requireNumber,
  requireString,
  resolveOrg,
  type ToolDef,
} from "./shared";

const ITEM_STATUS = ["scheduled", "billed", "paid", "cancelled"] as const;
const BOARD_STATUS: BillingItemStatus[] = [
  "upcoming",
  "due",
  "billed",
  "partial",
  "paid",
  "overdue",
];

function checkEnum(v: string | undefined, allowed: readonly string[], field: string) {
  if (v !== undefined && !allowed.includes(v)) {
    throw new Error(`"${field}" must be one of: ${allowed.join(", ")}.`);
  }
}

/** billing_item 的客戶沒指定就沿用合約的（與 web 端的 resolveBillingCustomer 一致）。 */
async function resolveCustomer(
  orgId: string,
  customerPartyId: number | undefined,
  contractId: number | undefined,
): Promise<number> {
  if (customerPartyId !== undefined) return customerPartyId;
  if (contractId !== undefined) {
    const [c] = await getDb()
      .select({ customerPartyId: contracts.customerPartyId })
      .from(contracts)
      .where(and(eq(contracts.organizationId, orgId), eq(contracts.id, contractId)))
      .limit(1);
    if (c) return c.customerPartyId;
  }
  throw new Error("customerPartyId is required (or pass a contractId to inherit its customer).");
}

export const billingItemTools: Record<string, ToolDef> = {
  list_billing_status: {
    description:
      "[read] The billing board: every outstanding charge across one-off contract instalments, project milestones AND recurring subscription periods, merged into one list. This is the tool for 「誰該請款 / 誰已繳款 / 誰還沒繳 / 發票該開給誰」. Status values: due (應請款日已到、還沒請款), billed (已請款待收), partial (部分收款), overdue (超過付款期限仍未收齊), paid (已收齊), upcoming (還沒到應請款日). needsInvoice=true means 該開發票卻還沒開.",
    inputSchema: {
      type: "object",
      properties: {
        status: {
          type: "array",
          items: { type: "string", enum: [...BOARD_STATUS] },
          description: "Filter to these statuses. Omit for all.",
        },
        needsInvoiceOnly: {
          type: "boolean",
          description: "Only rows where an invoice is still owed (發票該開給誰).",
        },
        customerPartyId: { type: "number", description: "Filter to one customer." },
        includeAllHistory: {
          type: "boolean",
          description:
            "Include long-settled rows too. Default false — settled rows older than 90 days are hidden, but nothing unpaid is ever hidden.",
        },
        ...ORG_ARG,
      },
      additionalProperties: false,
    },
    execute: async (args, ctx) => {
      const orgId = await resolveOrg(args, ctx);
      const rows = await listBillingBoard(orgId, {
        includeAllHistory: optBoolean(args, "includeAllHistory") ?? false,
      });
      const wanted = Array.isArray(args.status) ? (args.status as string[]) : null;
      const customerPartyId = optNumber(args, "customerPartyId");
      const invoiceOnly = optBoolean(args, "needsInvoiceOnly") ?? false;
      return rows.filter(
        (r) =>
          (!wanted || wanted.includes(r.status)) &&
          (customerPartyId === undefined || r.customerPartyId === customerPartyId) &&
          (!invoiceOnly || r.needsInvoice),
      );
    },
  },

  create_billing_item: {
    description:
      "[write] Schedule one charge for a client — a contract instalment (簽約金/期中款/尾款), a project milestone, or a one-off. Recurring monthly/annual fees do NOT belong here: use create_subscription, whose periods show up on the billing board automatically.",
    inputSchema: {
      type: "object",
      properties: {
        customerPartyId: {
          type: "number",
          description: "Customer; inherited from the contract when omitted.",
        },
        contractId: { type: "number" },
        projectId: { type: "number" },
        title: { type: "string", description: "e.g. 簽約金 / 期中款 / 尾款." },
        amount: { type: "number" },
        currency: { type: "string", description: "3-letter; default TWD." },
        dueDate: { type: "string", description: "應請款日, YYYY-MM-DD." },
        billedOn: { type: "string", description: "實際請款日, YYYY-MM-DD." },
        paidOn: { type: "string", description: "收款日 (人工註記), YYYY-MM-DD." },
        invoicedOn: { type: "string", description: "開發票日, YYYY-MM-DD." },
        needsInvoice: { type: "boolean", description: "Default true." },
        status: { type: "string", enum: [...ITEM_STATUS], description: "Default scheduled." },
        note: { type: "string" },
        ...ORG_ARG,
      },
      required: ["title", "amount"],
      additionalProperties: false,
    },
    execute: async (args, ctx) => {
      const orgId = await resolveOrg(args, ctx);
      const db = getDb();
      const contractId = optNumber(args, "contractId");
      if (contractId !== undefined) await assertInOrg(db, contracts, contractId, orgId, "Contract");
      const projectId = optNumber(args, "projectId");
      if (projectId !== undefined) await assertInOrg(db, projects, projectId, orgId, "Project");
      const customerPartyId = await resolveCustomer(
        orgId,
        optNumber(args, "customerPartyId"),
        contractId,
      );
      await assertInOrg(db, parties, customerPartyId, orgId, "Customer");
      checkEnum(optString(args, "status"), ITEM_STATUS, "status");

      const [row] = await db
        .insert(billingItems)
        .values({
          organizationId: orgId,
          customerPartyId,
          contractId: contractId ?? null,
          projectId: projectId ?? null,
          title: requireString(args, "title"),
          amount: requireDecimal(args, "amount"),
          currency: normalizeCurrency(args, "currency"),
          dueDate: optString(args, "dueDate") ?? null,
          billedOn: optString(args, "billedOn") ?? null,
          paidOn: optString(args, "paidOn") ?? null,
          invoicedOn: optString(args, "invoicedOn") ?? null,
          needsInvoice: optBoolean(args, "needsInvoice") ?? true,
          status: optString(args, "status") ?? "scheduled",
          note: optString(args, "note") ?? null,
        })
        .returning();
      return row;
    },
  },

  update_billing_item: {
    description:
      "[write] Update a scheduled charge (only provided fields). Use this to record 「已請款」(billedOn), 「已收款」(paidOn) or 「已開發票」(invoicedOn). Actual money received is computed from ledger transactions bound to this item, not from paidOn.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number" },
        customerPartyId: { type: "number" },
        contractId: { type: "number" },
        projectId: { type: "number" },
        title: { type: "string" },
        amount: { type: "number" },
        currency: { type: "string" },
        dueDate: { type: "string", description: "YYYY-MM-DD." },
        billedOn: { type: "string", description: "YYYY-MM-DD." },
        paidOn: { type: "string", description: "YYYY-MM-DD." },
        invoicedOn: { type: "string", description: "YYYY-MM-DD." },
        needsInvoice: { type: "boolean" },
        status: { type: "string", enum: [...ITEM_STATUS] },
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
      if (customerPartyId !== undefined)
        await assertInOrg(db, parties, customerPartyId, orgId, "Customer");
      const contractId = optNumber(args, "contractId");
      if (contractId !== undefined) await assertInOrg(db, contracts, contractId, orgId, "Contract");
      const projectId = optNumber(args, "projectId");
      if (projectId !== undefined) await assertInOrg(db, projects, projectId, orgId, "Project");
      checkEnum(optString(args, "status"), ITEM_STATUS, "status");

      const patch: Record<string, unknown> = {};
      if (customerPartyId !== undefined) patch.customerPartyId = customerPartyId;
      if (contractId !== undefined) patch.contractId = contractId;
      if (projectId !== undefined) patch.projectId = projectId;
      if (optString(args, "title") !== undefined) patch.title = requireString(args, "title");
      if (optNumber(args, "amount") !== undefined) patch.amount = optDecimal(args, "amount");
      if (optString(args, "currency") !== undefined)
        patch.currency = normalizeCurrency(args, "currency");
      for (const f of ["dueDate", "billedOn", "paidOn", "invoicedOn", "note"] as const) {
        if (optString(args, f) !== undefined) patch[f] = optString(args, f);
      }
      if (optBoolean(args, "needsInvoice") !== undefined)
        patch.needsInvoice = optBoolean(args, "needsInvoice");
      if (optString(args, "status") !== undefined) patch.status = optString(args, "status");
      if (Object.keys(patch).length === 0) throw new Error("Nothing to update.");

      const [row] = await db
        .update(billingItems)
        .set(patch)
        .where(
          and(
            eq(billingItems.organizationId, orgId),
            eq(billingItems.id, id),
            isNull(billingItems.deletedAt),
          ),
        )
        .returning();
      if (!row) throw new Error(`Billing item ${id} not found in your organization.`);
      return row;
    },
  },

  sync_billing_calendar: {
    description:
      "[write] Push the current billing board to the organization's Google Calendar (creates/updates/removes reminders). Idempotent. Fails with a clear message if nobody has connected Google Calendar yet — connect it from 組織設定 in the web app. Normally unnecessary: the sync runs automatically whenever billing data changes.",
    inputSchema: {
      type: "object",
      properties: { ...ORG_ARG },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, idempotentHint: true, destructiveHint: false },
    execute: async (args, ctx) => {
      const orgId = await resolveOrg(args, ctx);
      // 這裡不能用 auth.api.listOrganizations（MCP 沒有 session cookie），直接查表。
      const [org] = await getDb()
        .select({ name: organization.name })
        .from(organization)
        .where(eq(organization.id, orgId))
        .limit(1);
      const { syncBillingCalendar } = await import("@/lib/google-calendar");
      return syncBillingCalendar(orgId, org?.name ?? "組織");
    },
  },

  delete_billing_item: {
    description: "[delete] Soft-delete a scheduled charge. Its calendar reminder is removed on the next sync.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "number" }, ...ORG_ARG },
      required: ["id"],
      additionalProperties: false,
    },
    execute: async (args, ctx) => {
      const id = requireNumber(args, "id");
      const orgId = await resolveOrg(args, ctx);
      const existing = await getBillingItem(orgId, id);
      if (!existing) throw new Error(`Billing item ${id} not found in your organization.`);
      await getDb()
        .update(billingItems)
        .set({ deletedAt: new Date().toISOString() })
        .where(and(eq(billingItems.organizationId, orgId), eq(billingItems.id, id)));
      return { id, deleted: true };
    },
  },
};

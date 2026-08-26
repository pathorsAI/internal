import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { bankAccounts, billingItems, categories, contracts, invoices, parties } from "@/db/schema";
import {
  getBankAccount,
  getInvoice,
  getParty,
  listBankAccounts,
  listCategories,
  listInvoices,
  listParties,
} from "@/db/queries";
import {
  assertInOrg,
  fkError,
  type JsonSchemaObject,
  normalizeCurrency,
  optBoolean,
  optDecimal,
  optNumber,
  optString,
  ORG_ARG,
  requireNumber,
  requireString,
  resolveOrg,
  type ToolDef,
} from "./shared";

const PARTY_LABELS = ["vendor", "customer", "gov", "other"] as const;
const CATEGORY_KINDS = [
  "income",
  "cogs",
  "expense",
  "non_operating",
  "transfer",
  "equity",
] as const;
const INVOICE_DIRECTIONS = ["issued", "received"] as const;
const INVOICE_STATUSES = ["valid", "void", "allowance"] as const;

// ---- outputSchema 素材 ----
// 這些 tool 直接回 drizzle 的資料列，所以形狀就是 db/schema.ts 的欄位：numeric 回
// 來是字串（不是 number）、date/timestamp 也是字串、可為 null 的欄位誠實寫成
// ["x", "null"]。required 列的是「key 一定會出現」的欄位 —— select()/returning()
// 會帶回整列，所以每個欄位都在，值可能是 null。

const DELETED_RESULT: JsonSchemaObject = {
  type: "object",
  properties: {
    deleted: { type: "boolean" },
    id: { type: "number", description: "The id that was soft-deleted." },
  },
  required: ["deleted", "id"],
  additionalProperties: false,
};

const PARTY_ROW_PROPS = {
  id: { type: "number" },
  deletedAt: { type: ["string", "null"], description: "Soft-delete timestamp; null while active." },
  organizationId: { type: ["string", "null"] },
  name: { type: "string" },
  label: { type: "string", enum: [...PARTY_LABELS] },
  taxId: { type: ["string", "null"] },
  defaultCurrency: { type: ["string", "null"], description: "3-letter code." },
  defaultAccountId: { type: ["number", "null"] },
  typicalAmount: { type: ["string", "null"], description: "Decimal as a string." },
  contact: { type: ["string", "null"] },
  note: { type: ["string", "null"] },
  isActive: { type: "boolean" },
  createdAt: { type: "string" },
} as const;

const PARTY_ROW: JsonSchemaObject = {
  type: "object",
  properties: { ...PARTY_ROW_PROPS },
  required: Object.keys(PARTY_ROW_PROPS),
  additionalProperties: false,
};

const CATEGORY_ROW_PROPS = {
  id: { type: "number" },
  deletedAt: { type: ["string", "null"] },
  organizationId: { type: ["string", "null"] },
  name: { type: "string" },
  kind: { type: "string", enum: [...CATEGORY_KINDS] },
  isActive: { type: "boolean" },
} as const;

const CATEGORY_ROW: JsonSchemaObject = {
  type: "object",
  properties: { ...CATEGORY_ROW_PROPS },
  required: Object.keys(CATEGORY_ROW_PROPS),
  additionalProperties: false,
};

const BANK_ACCOUNT_ROW_PROPS = {
  id: { type: "number" },
  deletedAt: { type: ["string", "null"] },
  organizationId: { type: ["string", "null"] },
  name: { type: "string" },
  kind: { type: "string", description: "e.g. bank, cash." },
  currency: { type: "string", description: "3-letter code." },
  openingBalance: { type: "string", description: "Decimal as a string." },
  isActive: { type: "boolean" },
  createdAt: { type: "string" },
} as const;

const BANK_ACCOUNT_ROW: JsonSchemaObject = {
  type: "object",
  properties: { ...BANK_ACCOUNT_ROW_PROPS },
  required: Object.keys(BANK_ACCOUNT_ROW_PROPS),
  additionalProperties: false,
};

const INVOICE_ROW_PROPS = {
  id: { type: "number" },
  deletedAt: { type: ["string", "null"] },
  organizationId: { type: ["string", "null"] },
  direction: { type: "string", enum: [...INVOICE_DIRECTIONS] },
  invoiceNumber: { type: ["string", "null"] },
  invoiceDate: { type: ["string", "null"], description: "YYYY-MM-DD." },
  counterpartyName: { type: ["string", "null"] },
  counterpartyTaxId: { type: ["string", "null"] },
  amountNet: { type: ["string", "null"], description: "Decimal as a string." },
  tax: { type: ["string", "null"], description: "Decimal as a string." },
  amountGross: { type: ["string", "null"], description: "Decimal as a string." },
  currency: { type: "string", description: "3-letter code." },
  status: { type: "string", enum: [...INVOICE_STATUSES] },
  note: { type: ["string", "null"] },
  createdAt: { type: "string" },
  partyId: { type: ["number", "null"] },
  contractId: { type: ["number", "null"] },
  billingItemId: { type: ["number", "null"] },
  externalStatus: {
    type: "string",
    enum: ["pending", "issued", "void", "n_a"],
    description: "Issuing state in Simpany, the external invoicing system.",
  },
  externalRef: { type: ["string", "null"] },
} as const;

const INVOICE_ROW: JsonSchemaObject = {
  type: "object",
  properties: { ...INVOICE_ROW_PROPS },
  required: Object.keys(INVOICE_ROW_PROPS),
  additionalProperties: false,
};

/**
 * get_* 找不到資料時回的是 `{ error }`，跟資料列是兩種形狀，所以合併後的 schema
 * 不能宣告 required —— 沒有任何欄位在兩種情況下都會出現。
 */
function orNotFound(row: JsonSchemaObject): JsonSchemaObject {
  return {
    type: "object",
    properties: {
      ...row.properties,
      error: { type: "string", description: "Returned instead of the record when nothing matched." },
    },
    additionalProperties: false,
  };
}

function optLabel(args: Record<string, unknown>): string | undefined {
  const v = optString(args, "label");
  if (v && !PARTY_LABELS.includes(v as (typeof PARTY_LABELS)[number])) {
    throw new Error(`"label" must be one of: ${PARTY_LABELS.join(", ")}.`);
  }
  return v;
}

export const accountingTools: Record<string, ToolDef> = {
  // ---- parties (vendors / customers / gov) ----
  list_parties: {
    description:
      "List transaction counterparties (vendors, customers, gov). Use to resolve a party id for transactions, contracts, subscriptions. Filter by label.",
    inputSchema: {
      type: "object",
      properties: {
        label: { type: "string", enum: [...PARTY_LABELS], description: "Optional filter." },
        ...ORG_ARG,
      },
      additionalProperties: false,
    },
    execute: async (args, ctx) => {
      const orgId = await resolveOrg(args, ctx);
      const label = optLabel(args);
      const rows = await listParties(orgId);
      return label ? rows.filter((p) => p.label === label) : rows;
    },
  },

  get_party: {
    description: "Get one counterparty by id.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "number" }, ...ORG_ARG },
      required: ["id"],
      additionalProperties: false,
    },
    outputSchema: orNotFound(PARTY_ROW),
    execute: async (args, ctx) => {
      const orgId = await resolveOrg(args, ctx);
      return (await getParty(orgId, requireNumber(args, "id"))) ?? { error: "Not found." };
    },
  },

  create_party: {
    description:
      "Create a counterparty (vendor/customer/gov/other). Names are unique per org.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        label: { type: "string", enum: [...PARTY_LABELS], description: "Default vendor." },
        taxId: { type: "string", description: "統一編號 / tax id." },
        defaultCurrency: { type: "string", description: "3-letter code." },
        defaultAccountId: { type: "number", description: "FK; see list_bank_accounts." },
        typicalAmount: { type: "number" },
        contact: { type: "string" },
        note: { type: "string" },
        ...ORG_ARG,
      },
      required: ["name"],
      additionalProperties: false,
    },
    outputSchema: PARTY_ROW,
    execute: async (args, ctx) => {
      const orgId = await resolveOrg(args, ctx);
      const db = getDb();
      const defaultAccountId = optNumber(args, "defaultAccountId");
      if (defaultAccountId !== undefined) {
        await assertInOrg(db, bankAccounts, defaultAccountId, orgId, "Bank account");
      }
      try {
        const [row] = await db
          .insert(parties)
          .values({
            organizationId: orgId,
            name: requireString(args, "name"),
            label: optLabel(args) ?? "vendor",
            taxId: optString(args, "taxId") ?? null,
            defaultCurrency: optString(args, "defaultCurrency")
              ? normalizeCurrency(args, "defaultCurrency")
              : null,
            defaultAccountId: defaultAccountId ?? null,
            typicalAmount: optDecimal(args, "typicalAmount") ?? null,
            contact: optString(args, "contact") ?? null,
            note: optString(args, "note") ?? null,
          })
          .returning();
        return row;
      } catch (e) {
        throw fkError(e, "A party with this name already exists in your org.");
      }
    },
  },

  update_party: {
    description:
      "Update a counterparty. Only provided fields change. Set isActive=false to deactivate (soft-delete).",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number" },
        name: { type: "string" },
        label: { type: "string", enum: [...PARTY_LABELS] },
        taxId: { type: "string" },
        defaultCurrency: { type: "string" },
        defaultAccountId: { type: "number" },
        typicalAmount: { type: "number" },
        contact: { type: "string" },
        note: { type: "string" },
        isActive: { type: "boolean" },
        ...ORG_ARG,
      },
      required: ["id"],
      additionalProperties: false,
    },
    outputSchema: PARTY_ROW,
    execute: async (args, ctx) => {
      const id = requireNumber(args, "id");
      const orgId = await resolveOrg(args, ctx);
      const db = getDb();
      const defaultAccountId = optNumber(args, "defaultAccountId");
      if (defaultAccountId !== undefined) {
        await assertInOrg(db, bankAccounts, defaultAccountId, orgId, "Bank account");
      }
      const patch: Record<string, unknown> = {};
      if (optString(args, "name") !== undefined) patch.name = requireString(args, "name");
      if (optLabel(args) !== undefined) patch.label = optLabel(args);
      if (optString(args, "taxId") !== undefined) patch.taxId = optString(args, "taxId");
      if (optString(args, "defaultCurrency") !== undefined)
        patch.defaultCurrency = normalizeCurrency(args, "defaultCurrency");
      if (defaultAccountId !== undefined) patch.defaultAccountId = defaultAccountId;
      if (optNumber(args, "typicalAmount") !== undefined)
        patch.typicalAmount = optDecimal(args, "typicalAmount");
      if (optString(args, "contact") !== undefined) patch.contact = optString(args, "contact");
      if (optString(args, "note") !== undefined) patch.note = optString(args, "note");
      if (optBoolean(args, "isActive") !== undefined) patch.isActive = optBoolean(args, "isActive");
      if (Object.keys(patch).length === 0) throw new Error("Nothing to update.");
      try {
        const [row] = await db
          .update(parties)
          .set(patch)
          .where(and(eq(parties.organizationId, orgId), eq(parties.id, id)))
          .returning();
        if (!row) throw new Error(`Party ${id} not found in your organization.`);
        return row;
      } catch (e) {
        throw fkError(e, "A party with this name already exists in your org.");
      }
    },
  },

  delete_party: {
    description:
      "Delete a counterparty. Fails if it has transactions — deactivate it instead (update_party isActive=false).",
    inputSchema: {
      type: "object",
      properties: { id: { type: "number" }, ...ORG_ARG },
      required: ["id"],
      additionalProperties: false,
    },
    outputSchema: DELETED_RESULT,
    execute: async (args, ctx) => {
      const id = requireNumber(args, "id");
      const orgId = await resolveOrg(args, ctx);
      const db = getDb();
      await assertInOrg(db, parties, id, orgId, "Party");
      await db
        .update(parties)
        .set({ deletedAt: new Date().toISOString() })
        .where(and(eq(parties.organizationId, orgId), eq(parties.id, id)));
      return { deleted: true, id };
    },
  },

  // ---- categories ----
  list_categories: {
    description:
      "List active accounting categories (income/cogs/expense/etc.). Use to resolve categoryId for transactions.",
    inputSchema: { type: "object", properties: { ...ORG_ARG }, additionalProperties: false },
    execute: async (args, ctx) => listCategories(await resolveOrg(args, ctx)),
  },

  create_category: {
    description: "Create an accounting category.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        kind: { type: "string", enum: [...CATEGORY_KINDS], description: "Default expense." },
        ...ORG_ARG,
      },
      required: ["name"],
      additionalProperties: false,
    },
    outputSchema: CATEGORY_ROW,
    execute: async (args, ctx) => {
      const orgId = await resolveOrg(args, ctx);
      const kind = optString(args, "kind");
      if (kind && !CATEGORY_KINDS.includes(kind as (typeof CATEGORY_KINDS)[number])) {
        throw new Error(`"kind" must be one of: ${CATEGORY_KINDS.join(", ")}.`);
      }
      const [row] = await getDb()
        .insert(categories)
        .values({ organizationId: orgId, name: requireString(args, "name"), kind: kind ?? "expense" })
        .returning();
      return row;
    },
  },

  update_category: {
    description: "Rename a category.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "number" }, name: { type: "string" }, ...ORG_ARG },
      required: ["id", "name"],
      additionalProperties: false,
    },
    outputSchema: CATEGORY_ROW,
    execute: async (args, ctx) => {
      const orgId = await resolveOrg(args, ctx);
      const [row] = await getDb()
        .update(categories)
        .set({ name: requireString(args, "name") })
        .where(and(eq(categories.organizationId, orgId), eq(categories.id, requireNumber(args, "id"))))
        .returning();
      if (!row) throw new Error("Category not found in your organization.");
      return row;
    },
  },

  delete_category: {
    description: "Delete a category. Fails if transactions use it — rename instead.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "number" }, ...ORG_ARG },
      required: ["id"],
      additionalProperties: false,
    },
    outputSchema: DELETED_RESULT,
    execute: async (args, ctx) => {
      const id = requireNumber(args, "id");
      const orgId = await resolveOrg(args, ctx);
      const db = getDb();
      await assertInOrg(db, categories, id, orgId, "Category");
      await db
        .update(categories)
        .set({ deletedAt: new Date().toISOString() })
        .where(and(eq(categories.organizationId, orgId), eq(categories.id, id)));
      return { deleted: true, id };
    },
  },

  // ---- bank accounts ----
  list_bank_accounts: {
    description:
      "List cash/bank accounts. Use to resolve fromAccountId/toAccountId/accountId for transactions.",
    inputSchema: { type: "object", properties: { ...ORG_ARG }, additionalProperties: false },
    execute: async (args, ctx) => listBankAccounts(await resolveOrg(args, ctx)),
  },

  get_bank_account: {
    description: "Get one bank account by id.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "number" }, ...ORG_ARG },
      required: ["id"],
      additionalProperties: false,
    },
    outputSchema: orNotFound(BANK_ACCOUNT_ROW),
    execute: async (args, ctx) =>
      (await getBankAccount(await resolveOrg(args, ctx), requireNumber(args, "id"))) ?? {
        error: "Not found.",
      },
  },

  create_bank_account: {
    description: "Create a cash/bank account.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        kind: { type: "string", description: "e.g. bank, cash. Default bank." },
        currency: { type: "string", description: "3-letter code. Default TWD." },
        openingBalance: { type: "number", description: "Default 0." },
        ...ORG_ARG,
      },
      required: ["name"],
      additionalProperties: false,
    },
    outputSchema: BANK_ACCOUNT_ROW,
    execute: async (args, ctx) => {
      const orgId = await resolveOrg(args, ctx);
      const [row] = await getDb()
        .insert(bankAccounts)
        .values({
          organizationId: orgId,
          name: requireString(args, "name"),
          kind: optString(args, "kind") ?? "bank",
          currency: normalizeCurrency(args, "currency"),
          openingBalance: optDecimal(args, "openingBalance") ?? "0",
        })
        .returning();
      return row;
    },
  },

  update_bank_account: {
    description: "Update a bank account. Only provided fields change. isActive=false deactivates.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "number" },
        name: { type: "string" },
        kind: { type: "string" },
        currency: { type: "string" },
        openingBalance: { type: "number" },
        isActive: { type: "boolean" },
        ...ORG_ARG,
      },
      required: ["id"],
      additionalProperties: false,
    },
    outputSchema: BANK_ACCOUNT_ROW,
    execute: async (args, ctx) => {
      const id = requireNumber(args, "id");
      const orgId = await resolveOrg(args, ctx);
      const patch: Record<string, unknown> = {};
      if (optString(args, "name") !== undefined) patch.name = requireString(args, "name");
      if (optString(args, "kind") !== undefined) patch.kind = optString(args, "kind");
      if (optString(args, "currency") !== undefined) patch.currency = normalizeCurrency(args, "currency");
      if (optNumber(args, "openingBalance") !== undefined)
        patch.openingBalance = optDecimal(args, "openingBalance");
      if (optBoolean(args, "isActive") !== undefined) patch.isActive = optBoolean(args, "isActive");
      if (Object.keys(patch).length === 0) throw new Error("Nothing to update.");
      const [row] = await getDb()
        .update(bankAccounts)
        .set(patch)
        .where(and(eq(bankAccounts.organizationId, orgId), eq(bankAccounts.id, id)))
        .returning();
      if (!row) throw new Error(`Bank account ${id} not found in your organization.`);
      return row;
    },
  },

  delete_bank_account: {
    description:
      "Delete a bank account. Fails if it has transactions/reconciliations — deactivate instead.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "number" }, ...ORG_ARG },
      required: ["id"],
      additionalProperties: false,
    },
    outputSchema: DELETED_RESULT,
    execute: async (args, ctx) => {
      const id = requireNumber(args, "id");
      const orgId = await resolveOrg(args, ctx);
      const db = getDb();
      await assertInOrg(db, bankAccounts, id, orgId, "Bank account");
      await db
        .update(bankAccounts)
        .set({ deletedAt: new Date().toISOString() })
        .where(and(eq(bankAccounts.organizationId, orgId), eq(bankAccounts.id, id)));
      return { deleted: true, id };
    },
  },

  // ---- invoices (issued / received records, separate from the ledger) ----
  list_invoices: {
    description: "List invoice records (issued or received), newest first.",
    inputSchema: {
      type: "object",
      properties: { limit: { type: "number", description: "Default 100." }, ...ORG_ARG },
      additionalProperties: false,
    },
    execute: async (args, ctx) =>
      listInvoices(await resolveOrg(args, ctx), optNumber(args, "limit") ?? 100),
  },

  get_invoice: {
    description: "Get one invoice record by id.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "number" }, ...ORG_ARG },
      required: ["id"],
      additionalProperties: false,
    },
    outputSchema: orNotFound(INVOICE_ROW),
    execute: async (args, ctx) =>
      (await getInvoice(await resolveOrg(args, ctx), requireNumber(args, "id"))) ?? {
        error: "Not found.",
      },
  },

  create_invoice: {
    description:
      "Create an invoice record (AR/AP tracking). Bind it to a client with partyId, and to a scheduled charge with billingItemId — doing so fills that charge's 開發票日 automatically, which clears it from the 「待開發票」 list (see list_billing_status).",
    inputSchema: {
      type: "object",
      properties: {
        direction: { type: "string", enum: [...INVOICE_DIRECTIONS], description: "Default received." },
        invoiceNumber: { type: "string" },
        invoiceDate: { type: "string", description: "YYYY-MM-DD." },
        counterpartyName: { type: "string" },
        counterpartyTaxId: { type: "string" },
        amountNet: { type: "number" },
        tax: { type: "number" },
        amountGross: { type: "number" },
        currency: { type: "string", description: "3-letter; default TWD." },
        status: { type: "string", enum: [...INVOICE_STATUSES], description: "Default valid." },
        note: { type: "string" },
        partyId: { type: "number", description: "Counterparty; see list_parties." },
        contractId: { type: "number" },
        billingItemId: {
          type: "number",
          description: "Scheduled charge this invoice covers; see list_billing_status.",
        },
        ...ORG_ARG,
      },
      additionalProperties: false,
    },
    outputSchema: INVOICE_ROW,
    execute: async (args, ctx) => {
      const orgId = await resolveOrg(args, ctx);
      const direction = optString(args, "direction") ?? "received";
      if (!INVOICE_DIRECTIONS.includes(direction as (typeof INVOICE_DIRECTIONS)[number])) {
        throw new Error(`"direction" must be one of: ${INVOICE_DIRECTIONS.join(", ")}.`);
      }
      const status = optString(args, "status") ?? "valid";
      if (!INVOICE_STATUSES.includes(status as (typeof INVOICE_STATUSES)[number])) {
        throw new Error(`"status" must be one of: ${INVOICE_STATUSES.join(", ")}.`);
      }
      const db = getDb();
      const partyId = optNumber(args, "partyId");
      if (partyId !== undefined) await assertInOrg(db, parties, partyId, orgId, "Party");
      const contractId = optNumber(args, "contractId");
      if (contractId !== undefined) await assertInOrg(db, contracts, contractId, orgId, "Contract");
      const billingItemId = optNumber(args, "billingItemId");
      if (billingItemId !== undefined)
        await assertInOrg(db, billingItems, billingItemId, orgId, "Billing item");
      const [row] = await db
        .insert(invoices)
        .values({
          organizationId: orgId,
          direction,
          status,
          invoiceNumber: optString(args, "invoiceNumber") ?? null,
          invoiceDate: optString(args, "invoiceDate") ?? null,
          counterpartyName: optString(args, "counterpartyName") ?? null,
          counterpartyTaxId: optString(args, "counterpartyTaxId") ?? null,
          amountNet: optDecimal(args, "amountNet") ?? null,
          tax: optDecimal(args, "tax") ?? null,
          amountGross: optDecimal(args, "amountGross") ?? null,
          currency: normalizeCurrency(args, "currency"),
          note: optString(args, "note") ?? null,
          partyId: partyId ?? null,
          contractId: contractId ?? null,
          billingItemId: billingItemId ?? null,
        })
        .returning();
      // 綁到請款項目時順手回填開發票日，「待開發票」才會自己消掉（與 web 端一致）。
      if (billingItemId !== undefined && optString(args, "invoiceDate")) {
        await db
          .update(billingItems)
          .set({ invoicedOn: optString(args, "invoiceDate") })
          .where(
            and(
              eq(billingItems.organizationId, orgId),
              eq(billingItems.id, billingItemId),
              isNull(billingItems.invoicedOn),
            ),
          );
      }
      return row;
    },
  },

  delete_invoice: {
    description: "Delete an invoice record. Fails if linked to a transaction.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "number" }, ...ORG_ARG },
      required: ["id"],
      additionalProperties: false,
    },
    outputSchema: DELETED_RESULT,
    execute: async (args, ctx) => {
      const id = requireNumber(args, "id");
      const orgId = await resolveOrg(args, ctx);
      const db = getDb();
      await assertInOrg(db, invoices, id, orgId, "Invoice");
      await db
        .update(invoices)
        .set({ deletedAt: new Date().toISOString() })
        .where(and(eq(invoices.organizationId, orgId), eq(invoices.id, id)));
      return { deleted: true, id };
    },
  },
};

import { addDays, format, parseISO } from "date-fns";
import { canManageOrg, getOrgRole } from "@/lib/session";
import {
  issueSimpanyDraft,
  listZeroTaxReasons,
  previewSimpanyInvoice,
  resolveSimpanyReceiptId,
  voidSimpanyInvoice,
  type PreviewInput,
  type PreviewItemInput,
} from "@/lib/simpany-issue";
import {
  defaultSyncRange,
  syncSimpanyInvoices,
  taipeiDate,
  type TaxTreatment,
} from "@/lib/simpany-sync";
import { getSimpanyClient } from "@/lib/integrations/simpany";
import { auditIntegrationCall, requireIntegrationForTool } from "./tools-integrations";
import {
  listResult,
  listSchema,
  optBoolean,
  optDate,
  optNumber,
  optString,
  ORG_ARG,
  requireNumber,
  requireString,
  resolveOrg,
  rowSchema,
  type JsonSchemaObject,
  type ToolContext,
  type ToolDef,
} from "./shared";

// ---- Simpany 電子發票（src/lib/integrations/simpany.ts）----
//
// 每支工具 execute 第一步都是 requireIntegrationForTool：整合沒連接 / 沒開 / 需要重新
// 連接時，丟出清楚的中文錯誤告訴使用者請 owner / admin 到 設定 › 整合 處理。
// 對 Simpany 或本系統帳本有寫入的（同步、開立、作廢）限 owner / admin，並用
// auditIntegrationCall 記操作紀錄（不含帳密、token 或完整個資）。
//
// 開立一定是兩段式：simpany_preview_invoice 產生草稿 → 使用者在對話中明確同意 →
// simpany_issue_invoice 只收 draftId。

const TAX_TREATMENTS = ["taxable", "zero_rated", "exempt"] as const;

async function requireManager(orgId: string, ctx: ToolContext, what: string): Promise<void> {
  const role = await getOrgRole(orgId, ctx.userId);
  if (!canManageOrg(role)) {
    throw new Error(`只有組織的擁有者或管理員可以${what}，請找 owner 或 admin 操作。`);
  }
}

function rangeArgs(args: Record<string, unknown>, defaultDays: number) {
  const end = optDate(args, "endDate") ?? taipeiDate();
  const start =
    optDate(args, "startDate") ?? format(addDays(parseISO(end), -defaultDays), "yyyy-MM-dd");
  if (start > end) throw new Error('"startDate" must be on or before "endDate".');
  return { startDate: start, endDate: end };
}

function optObject(args: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  const v = args[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "object" || Array.isArray(v)) throw new Error(`"${key}" must be an object.`);
  return v as Record<string, unknown>;
}

function optStringArray(v: unknown, key: string): string[] | undefined {
  if (v === undefined || v === null) return undefined;
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) {
    throw new Error(`"${key}" must be an array of strings.`);
  }
  return (v as string[]).map((s) => s.trim()).filter(Boolean);
}

function parseItems(v: unknown): PreviewItemInput[] | undefined {
  if (v === undefined || v === null) return undefined;
  if (!Array.isArray(v)) throw new Error('"items" must be an array.');
  return v.map((raw, i) => {
    if (!raw || typeof raw !== "object") throw new Error(`items[${i}] must be an object.`);
    const it = raw as Record<string, unknown>;
    return {
      name: requireString(it, "name"),
      quantity: optNumber(it, "quantity") ?? 1,
      price: requireNumber(it, "price"),
    };
  });
}

const BUYER_SCHEMA = {
  type: "object",
  properties: {
    vat: { type: "string", description: "8-digit Taiwan 統一編號. Omit (or empty) for a buyer without one." },
    name: { type: "string" },
    address: { type: "string" },
    emails: { type: "array", items: { type: "string" }, description: "Where Simpany emails the e-invoice notice." },
  },
  additionalProperties: false,
} as const;

const LIST_ROW: JsonSchemaObject = rowSchema({
  id: { type: "string", description: "Simpany receipt id (R…); use with simpany_get_invoice / simpany_void_invoice." },
  invoiceNumber: { type: ["string", "null"] },
  type: { type: "string", description: "B2B or B2C." },
  status: { type: "string", description: "ISSUED or INVALID (voided)." },
  buyerVat: { type: ["string", "null"], description: "null for B2C." },
  buyerName: { type: ["string", "null"] },
  total: { type: "number", description: "TWD incl. tax." },
  issuedAt: { type: ["string", "null"] },
  voidedAt: { type: ["string", "null"] },
  voidReason: { type: ["string", "null"] },
  allowanceCount: { type: "number" },
});

const LOOSE_OBJECT: JsonSchemaObject = { type: "object", additionalProperties: true };

export const simpanyTools: Record<string, ToolDef> = {
  simpany_list_invoices: {
    description:
      "[read] List e-invoices issued in Simpany (the company's e-invoice provider) for a date range, straight from Simpany. Unofficial API: if Simpany changes it this may fail with Simpany's raw error. Requires the Simpany integration to be connected and switched on (設定 › 整合).",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    inputSchema: {
      type: "object",
      properties: {
        startDate: { type: "string", description: "YYYY-MM-DD; default 90 days before endDate." },
        endDate: { type: "string", description: "YYYY-MM-DD; default today (Taipei)." },
        status: { type: "string", enum: ["all", "void"], description: "all (default) or only voided ones." },
        query: { type: "string", description: "Keyword Simpany matches (invoice number, buyer name or tax id)." },
        ...ORG_ARG,
      },
      additionalProperties: false,
    },
    outputSchema: {
      ...listSchema(LIST_ROW),
      properties: {
        ...listSchema(LIST_ROW).properties,
        truncated: { type: "boolean", description: "More pages existed than were fetched; narrow the range." },
      },
      required: ["items", "count", "truncated"],
    },
    execute: async (args, ctx) => {
      const orgId = await resolveOrg(args, ctx);
      await requireIntegrationForTool(orgId, "simpany");
      const status = optString(args, "status") ?? "all";
      if (status !== "all" && status !== "void") throw new Error('"status" must be all or void.');
      const client = await getSimpanyClient(orgId);
      const { items, truncated } = await client.listAllReceipts(
        {
          status: status === "void" ? "INVALID" : "ALL",
          ...rangeArgs(args, 90),
          query: optString(args, "query"),
        },
        5,
      );
      return {
        ...listResult(
          items.map((r) => ({
            id: r.id,
            invoiceNumber: r.invoiceNumber,
            type: r.type,
            status: r.status,
            buyerVat: /^\d{8}$/.test(r.buyerVat ?? "") ? r.buyerVat : null,
            buyerName: r.buyerName,
            total: r.totalAmount,
            issuedAt: r.issuedAt,
            voidedAt: r.invalidatedAt,
            voidReason: r.invalidReason,
            allowanceCount: r.allowances.length,
          })),
        ),
        truncated,
      };
    },
  },

  simpany_get_invoice: {
    description:
      "[read] Full detail of one Simpany e-invoice by invoice number (e.g. FW10873802) or Simpany id (R…): items, tax type, zero-rate reason, buyer emails, upload status to the Ministry of Finance, void info.",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    inputSchema: {
      type: "object",
      properties: {
        invoice: { type: "string", description: "Invoice number (two letters + 8 digits) or Simpany id (R…)." },
        ...ORG_ARG,
      },
      required: ["invoice"],
      additionalProperties: false,
    },
    outputSchema: LOOSE_OBJECT,
    execute: async (args, ctx) => {
      const orgId = await resolveOrg(args, ctx);
      await requireIntegrationForTool(orgId, "simpany");
      const client = await getSimpanyClient(orgId);
      const id = await resolveSimpanyReceiptId(orgId, client, requireString(args, "invoice"));
      const d = await client.getReceipt(id);
      return {
        id: d.id,
        invoiceNumber: d.invoiceNumber,
        randomNumber: d.randomNumber,
        type: d.type,
        status: d.status,
        uploadStatus: d.uploadStatus,
        printStatus: d.printStatus,
        buyer: {
          vat: /^\d{8}$/.test(d.buyerVat ?? "") ? d.buyerVat : null,
          name: d.buyerName,
          address: d.buyerAddress,
          emails: d.buyerEmails,
        },
        taxType: d.taxType,
        customsClearanceType: d.customsClearanceType,
        zeroTaxRateReason: d.zeroTaxRateReason,
        taxRate: d.taxRate,
        isTaxIncluded: d.isTaxIncluded,
        untaxedAmount: d.untaxedAmount,
        taxAmount: d.taxAmount,
        totalAmount: d.totalAmount,
        remark: d.remark,
        carrierType: d.carrierType,
        items: d.items,
        issuedAt: d.issuedAt,
        voidedAt: d.invalidatedAt,
        voidReason: d.invalidReason,
        canInvalidate: d.canInvalidate,
        allowanceCount: d.allowances.length,
      };
    },
  },

  simpany_sync_invoices: {
    description:
      "[write] Pull Simpany e-invoices for a date range into this organization's invoice records (idempotent; writes only to these books, never to Simpany). Matches the buyer to a party by tax id then exact name, and auto-links each invoice to an unlinked income transaction and/or a billing item / subscription period of the same party when the gross amount is equal and the date is within ±45 days and there is exactly one candidate — ambiguous ones are returned in needsReview, not linked. Voided invoices have the 開發票日 they had filled cleared so the charge shows up as needing an invoice again. Owner/admin only.",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    inputSchema: {
      type: "object",
      properties: {
        startDate: { type: "string", description: "YYYY-MM-DD; default 90 days ago." },
        endDate: { type: "string", description: "YYYY-MM-DD; default today (Taipei)." },
        ...ORG_ARG,
      },
      additionalProperties: false,
    },
    outputSchema: LOOSE_OBJECT,
    execute: async (args, ctx) => {
      const orgId = await resolveOrg(args, ctx);
      await requireIntegrationForTool(orgId, "simpany");
      await requireManager(orgId, ctx, "同步 Simpany 發票");
      const range =
        args.startDate || args.endDate ? rangeArgs(args, 90) : defaultSyncRange();
      const res = await syncSimpanyInvoices(orgId, range);
      await auditIntegrationCall(
        ctx,
        orgId,
        "simpany",
        "update",
        `sync ${range.startDate}~${range.endDate}: +${res.created} ~${res.updated} void ${res.voided} linked ${res.autoLinked.length}`,
      );
      return res;
    },
  },

  simpany_preview_invoice: {
    description:
      "Prepare (but do NOT issue) a Simpany e-invoice. Prefills from internal data when given transactionId (an income entry), billingItemId (a planned charge) or subscriptionId + subscriptionPeriod, and/or takes explicit fields. Validates (B2B needs an 8-digit tax id; a foreign buyer without a Taiwan tax id is B2C + zero_rated with reason 72 外銷勞務 + NOT_VIA_CUSTOMS; zero-rated foreign-currency income REQUIRES exchangeRate taken from the bank's remittance slip 水單 — TWD amount = round(foreignAmount × exchangeRate)), computes untaxed/tax/total exactly as Simpany does, checks for possible duplicates, and stores a draft valid for 2 hours. Returns draftId plus the full preview and warnings. Show the preview (buyer, items, tax type, amounts, warnings) to the user and get explicit approval before calling simpany_issue_invoice with the draftId. Only writes the draft row; nothing is sent to Simpany or the buyer.",
    inputSchema: {
      type: "object",
      properties: {
        transactionId: { type: "number", description: "Income transaction to invoice; see list_transactions." },
        billingItemId: { type: "number", description: "Planned charge to invoice; see list_billing_status." },
        subscriptionId: { type: "number", description: "Subscription to invoice (with subscriptionPeriod)." },
        subscriptionPeriod: { type: "string", description: "Period start date YYYY-MM-DD; see get_subscription_schedule." },
        type: { type: "string", enum: ["B2B", "B2C"], description: "Default: B2B when the buyer has a Taiwan tax id, else B2C." },
        buyer: BUYER_SCHEMA,
        taxTreatment: {
          type: "string",
          enum: [...TAX_TREATMENTS],
          description: "taxable 應稅 (5%), zero_rated 零稅率, exempt 免稅. Default: zero_rated for foreign-currency income from a buyer without a Taiwan tax id, else taxable. Export services are zero_rated, never exempt.",
        },
        zeroRateReason: { type: "string", description: "Simpany reason code when zero_rated; default 72 外銷勞務. See simpany_list_zero_rate_reasons." },
        customsClearance: { type: "string", enum: ["NOT_VIA_CUSTOMS", "VIA_CUSTOMS"], description: "Zero-rated only; default NOT_VIA_CUSTOMS." },
        items: {
          type: "array",
          description: "Line items. Default: one item named after the source, priced at its amount. Names may not contain ':' (converted to '：').",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              quantity: { type: "number", description: "Default 1." },
              price: { type: "number", description: "Unit price in TWD (tax-inclusive when isTaxIncluded)." },
            },
            required: ["name", "price"],
            additionalProperties: false,
          },
        },
        isTaxIncluded: { type: "boolean", description: "Whether item prices include 5% tax. Default true." },
        remark: { type: "string", description: "Printed remark, e.g. a quote number." },
        foreignCurrency: { type: "string", description: "e.g. USD; defaults to the source's currency when not TWD." },
        foreignAmount: { type: "number", description: "Amount in foreignCurrency; defaults to the source amount." },
        exchangeRate: { type: "number", description: "TWD per 1 unit of foreignCurrency, from the bank's remittance slip (水單). Required for foreign-currency income." },
        ...ORG_ARG,
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    outputSchema: LOOSE_OBJECT,
    execute: async (args, ctx) => {
      const orgId = await resolveOrg(args, ctx);
      await requireIntegrationForTool(orgId, "simpany");
      const buyer = optObject(args, "buyer");
      const taxTreatment = optString(args, "taxTreatment");
      if (taxTreatment && !TAX_TREATMENTS.includes(taxTreatment as TaxTreatment)) {
        throw new Error(`"taxTreatment" must be one of: ${TAX_TREATMENTS.join(", ")}.`);
      }
      const type = optString(args, "type");
      if (type && type !== "B2B" && type !== "B2C") throw new Error('"type" must be B2B or B2C.');
      const customs = optString(args, "customsClearance");
      if (customs && customs !== "NOT_VIA_CUSTOMS" && customs !== "VIA_CUSTOMS") {
        throw new Error('"customsClearance" must be NOT_VIA_CUSTOMS or VIA_CUSTOMS.');
      }
      const input: PreviewInput = {
        transactionId: optNumber(args, "transactionId"),
        billingItemId: optNumber(args, "billingItemId"),
        subscriptionId: optNumber(args, "subscriptionId"),
        subscriptionPeriod: optDate(args, "subscriptionPeriod"),
        type: type as PreviewInput["type"],
        buyer: buyer
          ? {
              vat: buyer.vat === undefined ? undefined : optString(buyer, "vat") ?? null,
              name: optString(buyer, "name"),
              address: optString(buyer, "address"),
              emails: optStringArray(buyer.emails, "buyer.emails"),
            }
          : undefined,
        taxTreatment: taxTreatment as TaxTreatment | undefined,
        zeroRateReason: optString(args, "zeroRateReason"),
        customsClearance: customs as PreviewInput["customsClearance"],
        items: parseItems(args.items),
        isTaxIncluded: optBoolean(args, "isTaxIncluded"),
        remark: optString(args, "remark"),
        foreignCurrency: optString(args, "foreignCurrency"),
        foreignAmount: optNumber(args, "foreignAmount"),
        exchangeRate: optNumber(args, "exchangeRate"),
      };
      const preview = await previewSimpanyInvoice(orgId, ctx.userId, input);
      return {
        ...preview,
        nextStep:
          "Show this preview to the user (buyer, items, tax type, untaxed/tax/total, warnings). Only after they explicitly approve it in this conversation, call simpany_issue_invoice({ draftId }). The draft expires at expiresAt.",
      };
    },
  },

  simpany_issue_invoice: {
    description:
      "Issue a previewed draft as a real e-invoice in Simpany. THIS CREATES A LEGAL TAX DOCUMENT: Simpany uploads it to Taiwan's Ministry of Finance and emails the buyer; it can only be undone by voiding. Only call after the user has explicitly approved the preview from simpany_preview_invoice in this conversation. Takes ONLY the draftId (the exact previewed content is sent; a draft can be issued once and expires after 2 hours). On success the invoice is saved to this organization's invoices and linked to the previewed transaction / billing item / subscription period. Owner/admin only.",
    inputSchema: {
      type: "object",
      properties: {
        draftId: { type: "number", description: "From simpany_preview_invoice." },
        notifyEmails: {
          type: "array",
          items: { type: "string" },
          description: "Optional: replace the buyer notification emails shown in the preview.",
        },
        ...ORG_ARG,
      },
      required: ["draftId"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    outputSchema: LOOSE_OBJECT,
    execute: async (args, ctx) => {
      const orgId = await resolveOrg(args, ctx);
      await requireIntegrationForTool(orgId, "simpany");
      await requireManager(orgId, ctx, "在 Simpany 開立發票");
      const draftId = requireNumber(args, "draftId");
      try {
        const res = await issueSimpanyDraft(orgId, draftId, {
          notifyEmails: optStringArray(args.notifyEmails, "notifyEmails"),
        });
        await auditIntegrationCall(
          ctx,
          orgId,
          "simpany",
          "create",
          `issue draft #${draftId} → ${res.invoiceNumber ?? res.externalId} NT$${res.total}`,
        );
        return res;
      } catch (e) {
        await auditIntegrationCall(
          ctx,
          orgId,
          "simpany",
          "create",
          `issue draft #${draftId} failed: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`,
        );
        throw e;
      }
    },
  },

  simpany_void_invoice: {
    description:
      "Void (作廢) an e-invoice in Simpany. CANNOT BE UNDONE: the void is reported to the Ministry of Finance and Simpany notifies the buyer. Only call after the user explicitly confirmed voiding this specific invoice. Afterwards the invoice is re-synced here and the 開發票日 it filled is cleared so the charge shows as needing an invoice again. Only possible within the current filing period and before any allowance; otherwise Simpany refuses. Owner/admin only.",
    inputSchema: {
      type: "object",
      properties: {
        invoice: { type: "string", description: "Invoice number (e.g. FW10873800) or Simpany id (R…)." },
        reason: { type: "string", description: "Required 作廢原因, max 20 characters (e.g. 課稅別開立錯誤)." },
        ...ORG_ARG,
      },
      required: ["invoice", "reason"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    outputSchema: LOOSE_OBJECT,
    execute: async (args, ctx) => {
      const orgId = await resolveOrg(args, ctx);
      await requireIntegrationForTool(orgId, "simpany");
      await requireManager(orgId, ctx, "作廢 Simpany 發票");
      const ref = requireString(args, "invoice");
      const res = await voidSimpanyInvoice(orgId, ref, requireString(args, "reason"));
      await auditIntegrationCall(
        ctx,
        orgId,
        "simpany",
        "delete",
        `void ${res.invoiceNumber ?? res.externalId}: ${res.reason}`,
      );
      return res;
    },
  },

  simpany_list_zero_rate_reasons: {
    description:
      "[read] Simpany's list of zero-tax-rate reason codes (e.g. 71 外銷貨物, 72 外銷勞務) for zero_rated invoices.",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    inputSchema: {
      type: "object",
      properties: { ...ORG_ARG },
      additionalProperties: false,
    },
    outputSchema: listSchema(rowSchema({ code: { type: "string" }, name: { type: "string" } })),
    execute: async (args, ctx) => {
      const orgId = await resolveOrg(args, ctx);
      await requireIntegrationForTool(orgId, "simpany");
      return listResult(await listZeroTaxReasons(orgId));
    },
  },
};

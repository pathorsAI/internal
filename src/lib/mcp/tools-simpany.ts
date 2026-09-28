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
import {
  listSalaryDeclarationsLive,
  salaryReconciliation,
  syncSalaryDeclarations,
} from "@/lib/simpany-salary";
import {
  applySalaryFiling,
  prepareSalaryFiling,
  sendPayslips,
  settleSalaryFiling,
  type SalaryFilingEmployeeInput,
  type SalaryFilingPreview,
  type SalaryItemInput,
} from "@/lib/simpany-payroll";
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

function yearArg(args: Record<string, unknown>, fallback?: number): number {
  const year = optNumber(args, "year") ?? fallback ?? Number(taipeiDate().slice(0, 4));
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new Error('"year" must be a 4-digit year.');
  return year;
}

function monthArg(args: Record<string, unknown>, key: string): number | undefined {
  const m = optNumber(args, key);
  if (m === undefined) return undefined;
  if (!Number.isInteger(m) || m < 0 || m > 12) throw new Error(`"${key}" must be 1-12.`);
  return m;
}

function optNumberMap(v: unknown, key: string): Record<string, number> | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "object" || Array.isArray(v)) throw new Error(`"${key}" must be an object of name → number.`);
  const out: Record<string, number> = {};
  for (const [k, raw] of Object.entries(v as Record<string, unknown>)) {
    const n = typeof raw === "number" ? raw : Number(raw);
    if (!Number.isFinite(n) || n < 0) throw new Error(`"${key}.${k}" must be a non-negative number.`);
    out[k.trim()] = n;
  }
  return out;
}


function parseSalaryItems(v: unknown, key: string): SalaryItemInput[] | undefined {
  if (v === undefined || v === null) return undefined;
  if (!Array.isArray(v)) throw new Error(`"${key}" must be an array.`);
  return v.map((raw, i) => {
    if (!raw || typeof raw !== "object") throw new Error(`${key}[${i}] must be an object.`);
    const it = raw as Record<string, unknown>;
    return { itemId: requireNumber(it, "itemId"), amount: requireNumber(it, "amount"), note: optString(it, "note") };
  });
}

function parseSalaryEmployees(v: unknown): SalaryFilingEmployeeInput[] | undefined {
  if (v === undefined || v === null) return undefined;
  if (!Array.isArray(v)) throw new Error('"employees" must be an array.');
  return v.map((raw, i) => {
    if (!raw || typeof raw !== "object") throw new Error(`employees[${i}] must be an object.`);
    const e = raw as Record<string, unknown>;
    return {
      employeeId: optNumber(e, "employeeId"),
      name: optString(e, "name"),
      baseSalary: optNumber(e, "baseSalary"),
      bonus: optNumber(e, "bonus"),
      reimbursement: optNumber(e, "reimbursement"),
      otherAllowances: parseSalaryItems(e.otherAllowances, `employees[${i}].otherAllowances`),
      otherDeductions: parseSalaryItems(e.otherDeductions, `employees[${i}].otherDeductions`),
      note: optString(e, "note"),
    };
  });
}

function requireMonth(args: Record<string, unknown>): number {
  const m = monthArg(args, "month");
  if (m === undefined || m === 0) throw new Error('"month" is required (1-12).');
  return m;
}

function prepareAuditLine(year: number, month: number, preview: SalaryFilingPreview): string {
  const copied = preview.copy?.performed
    ? `, copied ${preview.copy.employees.length} from form #${preview.copy.sourceFormId}`
    : "";
  return `salary prepare ${year}-${String(month).padStart(2, "0")}: draft ${preview.draftId ?? "none"}, ${preview.employees.length} employees, net ${preview.totals.net}${copied}`;
}

function prepareNextStep(preview: SalaryFilingPreview): string {
  if (!preview.draftId) {
    return "No draft was created. Resolve the problems / copy plan / missing employees shown here (e.g. re-run with allowCopy: true after the user agrees to copy, or add employees in Simpany's UI), then prepare again.";
  }
  const missing = preview.notInSimpany.length
    ? `NOT in this draft (they don't exist in Simpany — the user must add them in Simpany's own UI first): ${preview.notInSimpany.join(", ")}. `
    : "";
  return (
    missing +
    "Show this preview to the user (per employee: base, bonus, gross, personal burden, company burden, withholding, net; payday; owner; warnings). Only after they explicitly approve it in this conversation, call simpany_apply_salary_filing({ draftId }). The draft expires at expiresAt."
  );
}

const SALARY_ITEM_SCHEMA = {
  type: "object",
  properties: {
    itemId: { type: "number", description: "Simpany item id from the form settings." },
    amount: { type: "number", description: "Whole TWD, >= 0." },
    note: { type: "string" },
  },
  required: ["itemId", "amount"],
  additionalProperties: false,
} as const;

const SALARY_EMPLOYEE_SCHEMA = {
  type: "object",
  properties: {
    employeeId: { type: "number", description: "Internal employee id (list_employees); or give name." },
    name: { type: "string", description: "Exact name as on Simpany." },
    baseSalary: { type: "number", description: "本薪 in whole TWD. Default: the employee record's base salary, else the last filed 本薪." },
    bonus: { type: "number", description: "非經常性獎金 (Simpany item 11) this month; one-off, never carried over." },
    reimbursement: { type: "number", description: "員工代墊款 (item 49) this month; one-off." },
    otherAllowances: {
      type: "array",
      items: SALARY_ITEM_SCHEMA,
      description: "Replaces all other allowances: 1 免稅伙食津貼, 5 應稅其他加項, 6 特休未休代金, 8 免稅加班費, 10 年終獎金, 36 經常性獎金, 51 免稅資遣費. Default: keep the template's recurring ones (1, 36).",
    },
    otherDeductions: {
      type: "array",
      items: SALARY_ITEM_SCHEMA,
      description: "Editable deductions: 44 應稅其他減項, 50 公司代墊款. Default: none.",
    },
    note: { type: "string", description: "Note printed on the bonus / reimbursement items added this month." },
  },
  additionalProperties: false,
} as const;

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

  // ---- 薪資申報（唯讀：只對 Simpany 發 GET，見 assertSalaryReadOnly）----
  // 回應在解析時就丟掉身分證字號 / 地址 / 國籍；工具結果只有姓名、Simpany 員工 id、金額、日期、旗標。

  simpany_list_salary_declarations: {
    description:
      "[read] Salary declarations (薪資申報) filed in Simpany for a year (or one month), read live from Simpany — GET only, nothing is written anywhere. Per month: status (missing = no form that month, empty = form exists but nobody's salary was declared, draft = declared but not settled, settled = filed/closed), payday, and per employee: name, Simpany employee id, company-owner flag, filed flag, base salary, non-recurring bonus, declared gross (實際申報薪資), net paid (實際發薪), personal/company labour & health insurance, employment insurance, and the item list (name/type/amount). Contains no national id, address or nationality. Requires the Simpany integration (設定 › 整合).",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    inputSchema: {
      type: "object",
      properties: {
        year: { type: "number", description: "Western year, e.g. 2026. Default: this year (Taipei)." },
        month: { type: "number", description: "1-12: only this salary month (the month the salary is for, not the payday month)." },
        ...ORG_ARG,
      },
      additionalProperties: false,
    },
    outputSchema: LOOSE_OBJECT,
    execute: async (args, ctx) => {
      const orgId = await resolveOrg(args, ctx);
      await requireIntegrationForTool(orgId, "simpany");
      const year = yearArg(args);
      const month = monthArg(args, "month");
      if (month === 0) throw new Error('"month" must be 1-12.');
      const res = await listSalaryDeclarationsLive(orgId, year, month);
      const monthSuffix = month ? `-${String(month).padStart(2, "0")}` : "";
      await auditIntegrationCall(
        ctx,
        orgId,
        "simpany",
        "read",
        `salary declarations ${year}${monthSuffix}`,
      );
      return res;
    },
  },

  simpany_sync_salary_declarations: {
    description:
      "[write] Pull a year's Simpany salary declarations (薪資申報) into this organization's own tables (simpany_salary_forms / simpany_salary_declarations) so salary_arrears can reconcile them. Only GET requests go to Simpany; nothing is written to Simpany. Idempotent: re-running replaces the year's rows, and forms/employees removed in Simpany are removed here. Each Simpany employee is linked to an employee record by exact name (unmatched names are returned). Owner/admin only.",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    inputSchema: {
      type: "object",
      properties: {
        year: { type: "number", description: "Western year, e.g. 2026. Default: this year (Taipei)." },
        ...ORG_ARG,
      },
      additionalProperties: false,
    },
    outputSchema: LOOSE_OBJECT,
    execute: async (args, ctx) => {
      const orgId = await resolveOrg(args, ctx);
      await requireIntegrationForTool(orgId, "simpany");
      await requireManager(orgId, ctx, "同步 Simpany 薪資申報");
      const year = yearArg(args);
      const res = await syncSalaryDeclarations(orgId, year);
      const filed = res.months.filter((m) => m.filedCount > 0).length;
      await auditIntegrationCall(
        ctx,
        orgId,
        "simpany",
        "update",
        `salary sync ${year}: ${filed} filed months, ${res.declarationsUpserted} rows, -${res.declarationsRemoved}`,
      );
      return res;
    },
  },

  // ---- 薪資申報寫入（src/lib/simpany-payroll.ts；assertSalaryWrite 白名單）----
  // 準備（試算 + 草稿）→ 使用者同意 → 寫入（只收 draftId）→ 使用者三個確認 → 結算 → 寄薪資單。

  simpany_prepare_salary_filing: {
    description:
      "Prepare (but do NOT save) a month's salary declaration (薪資申報) in Simpany, the company's payroll filing to its bookkeeper. Loads the month's Simpany form and each employee's declaration as a template, changes only the pay/insurance dates and the amounts (本薪, optional 非經常性獎金 / 員工代墊款 / other items; insurance brackets, insurance flags, dependents and pension settings are kept), runs Simpany's own calculation (POST …/calculate, which does not save), and stores a draft valid for 2 hours. Returns draftId plus per employee: gross, personal insurance, company insurance, withholding, net pay (實際發薪), declared salary, insured brackets, owner flag, and warnings (month-sequence restriction, payday not the 5th of next month, brackets, one-off items not carried over). If employees are missing from the month's form it plans a copy from the latest settled month; the copy writes to Simpany and only runs with allowCopy: true (otherwise draftId is null and the plan is returned). Employees that don't exist in Simpany are reported — they must be added in Simpany's own UI (this tool never creates employees). Never put shareholder loan repayments (股東往來還款) into a salary declaration — they are not salary. Show the preview to the user and get explicit approval before simpany_apply_salary_filing. Owner/admin only.",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    inputSchema: {
      type: "object",
      properties: {
        year: { type: "number", description: "Western year of the salary month." },
        month: { type: "number", description: "Salary month 1-12 (the month the salary is for, not the payday month)." },
        payday: { type: "string", description: "YYYY-MM-DD. Default: the 5th of the next month (the convention)." },
        employees: {
          type: "array",
          items: SALARY_EMPLOYEE_SCHEMA,
          description: "Who to file and with what amounts. Default: everyone on this month's form plus the latest settled month, excluding employees whose end date is before this month.",
        },
        allowCopy: { type: "boolean", description: "Copy missing employees from the latest settled month's form into this month (a write to Simpany). Default false: only return the plan." },
        sourceFormId: { type: "number", description: "Simpany form id to copy from instead of the latest settled one." },
        companyOwner: { type: "string", description: "Name of the company owner (負責人; pays the full health premium, no employment insurance). Default: whoever is flagged in the latest settled month." },
        ...ORG_ARG,
      },
      required: ["year", "month"],
      additionalProperties: false,
    },
    outputSchema: LOOSE_OBJECT,
    execute: async (args, ctx) => {
      const orgId = await resolveOrg(args, ctx);
      await requireIntegrationForTool(orgId, "simpany");
      await requireManager(orgId, ctx, "準備 Simpany 薪資申報");
      const year = yearArg(args);
      const month = requireMonth(args);
      const preview = await prepareSalaryFiling(orgId, ctx.userId, {
        year,
        month,
        payday: optDate(args, "payday"),
        employees: parseSalaryEmployees(args.employees),
        allowCopy: optBoolean(args, "allowCopy") ?? false,
        sourceFormId: optNumber(args, "sourceFormId"),
        companyOwner: optString(args, "companyOwner"),
      });
      await auditIntegrationCall(
        ctx,
        orgId,
        "simpany",
        preview.copy?.performed ? "update" : "read",
        prepareAuditLine(year, month, preview),
      );
      return { ...preview, nextStep: prepareNextStep(preview) };
    },
  },

  simpany_apply_salary_filing: {
    description:
      "Write a prepared salary declaration draft into Simpany: fixes the company-owner flags, sets the payday, then saves each employee's declaration exactly as previewed (PUT), reads the month back to verify each net pay (實際發薪) matches the preview, and re-syncs the year locally. Only call after the user has explicitly approved the preview from simpany_prepare_salary_filing in this conversation. Takes ONLY the draftId. The month stays editable in Simpany (not submitted to the bookkeeper until simpany_settle_salary_filing). On failure it reports exactly which declarations were written; every step overwrites, so the same draft can be retried. Owner/admin only.",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    inputSchema: {
      type: "object",
      properties: {
        draftId: { type: "number", description: "From simpany_prepare_salary_filing." },
        ...ORG_ARG,
      },
      required: ["draftId"],
      additionalProperties: false,
    },
    outputSchema: LOOSE_OBJECT,
    execute: async (args, ctx) => {
      const orgId = await resolveOrg(args, ctx);
      await requireIntegrationForTool(orgId, "simpany");
      await requireManager(orgId, ctx, "寫入 Simpany 薪資申報");
      const draftId = requireNumber(args, "draftId");
      try {
        const res = await applySalaryFiling(orgId, draftId);
        await auditIntegrationCall(
          ctx,
          orgId,
          "simpany",
          "update",
          `salary apply draft #${draftId} ${res.year}-${String(res.month).padStart(2, "0")}: wrote ${res.written.length}, verified ${res.verified}`,
        );
        return {
          ...res,
          nextStep: res.verified
            ? "Written. When the user is ready to submit this month to the bookkeeper, ask them to confirm the payday, the company owner and the salary amounts, then call simpany_settle_salary_filing with all three confirmations."
            : "Written, but some net amounts read back from Simpany differ from the preview (see verification). Show the differences to the user before settling.",
        };
      } catch (e) {
        await auditIntegrationCall(
          ctx,
          orgId,
          "simpany",
          "update",
          `salary apply draft #${draftId} failed: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`,
        );
        throw e;
      }
    },
  },

  simpany_settle_salary_filing: {
    description:
      "Settle (結算) a month's salary declarations in Simpany, which SUBMITS THEM TO THE BOOKKEEPER for withholding / insurance filing. Cannot be undone from here. Requires three explicit confirmations from the user — exactly like Simpany's own dialog: the payday is correct (confirmPayday), the company owner flag is correct (confirmOwner), the salary amounts are correct (confirmSalary); all three must be true, and only set them after the user confirmed each in this conversation. Refuses when Simpany says the month cannot be settled yet (months must be settled in order — returns the missing earlier months) or when data is incomplete. Owner/admin only.",
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    inputSchema: {
      type: "object",
      properties: {
        year: { type: "number" },
        month: { type: "number", description: "Salary month 1-12." },
        confirmPayday: { type: "boolean", description: "The user confirmed the payday is correct." },
        confirmOwner: { type: "boolean", description: "The user confirmed the company owner (負責人) flag is correct." },
        confirmSalary: { type: "boolean", description: "The user confirmed every employee's salary is correct." },
        ...ORG_ARG,
      },
      required: ["year", "month", "confirmPayday", "confirmOwner", "confirmSalary"],
      additionalProperties: false,
    },
    outputSchema: LOOSE_OBJECT,
    execute: async (args, ctx) => {
      const orgId = await resolveOrg(args, ctx);
      await requireIntegrationForTool(orgId, "simpany");
      await requireManager(orgId, ctx, "送出 Simpany 薪資申報結算");
      const year = yearArg(args);
      const month = requireMonth(args);
      const label = `${year}-${String(month).padStart(2, "0")}`;
      try {
        const res = await settleSalaryFiling(orgId, {
          year,
          month,
          confirmPayday: optBoolean(args, "confirmPayday") === true,
          confirmOwner: optBoolean(args, "confirmOwner") === true,
          confirmSalary: optBoolean(args, "confirmSalary") === true,
        });
        await auditIntegrationCall(ctx, orgId, "simpany", "update", `salary settle ${label}: settled ${res.settled}`);
        return res;
      } catch (e) {
        await auditIntegrationCall(
          ctx,
          orgId,
          "simpany",
          "update",
          `salary settle ${label} failed: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`,
        );
        throw e;
      }
    },
  },

  simpany_send_payslips: {
    description:
      "Email payslips (薪資單) for a settled month through Simpany: each employee receives an encrypted PDF (password = their national id). Only for months already settled. Without employeeNames it sends to everyone on the month's form. Uses Simpany's default email text. Only call after the user explicitly asked to send them. Owner/admin only.",
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    inputSchema: {
      type: "object",
      properties: {
        year: { type: "number" },
        month: { type: "number", description: "Salary month 1-12." },
        employeeNames: { type: "array", items: { type: "string" }, description: "Only these employees (exact Simpany names). Default: everyone." },
        ...ORG_ARG,
      },
      required: ["year", "month"],
      additionalProperties: false,
    },
    outputSchema: LOOSE_OBJECT,
    execute: async (args, ctx) => {
      const orgId = await resolveOrg(args, ctx);
      await requireIntegrationForTool(orgId, "simpany");
      await requireManager(orgId, ctx, "寄送 Simpany 薪資單");
      const year = yearArg(args);
      const month = requireMonth(args);
      const res = await sendPayslips(orgId, {
        year,
        month,
        employeeNames: optStringArray(args.employeeNames, "employeeNames"),
      });
      await auditIntegrationCall(
        ctx,
        orgId,
        "simpany",
        "update",
        `payslips ${year}-${String(month).padStart(2, "0")} sent to ${res.recipients.length}`,
      );
      return res;
    },
  },

  salary_arrears: {
    description:
      "[read] Salary arrears (欠薪) per employee: what was declared in Simpany (net paid 實際發薪, per month) versus what this organization actually recorded as paid (payslips + expense transactions in the 薪資費用 category linked to the employee by settle-employee or by party name). Reads only this organization's tables — run simpany_sync_salary_declarations first to refresh. Payments tied to a payslip period go to that month first; everything else is applied oldest-month-first (FIFO). Returns per employee: totalDeclaredNet, totalPaid, arrears (due, declared months still unpaid), estimatedArrears (months not declared in Simpany, estimated from the latest declared month's net minus its one-off bonus, flagged estimated: true), notYetDue, credit (paid with nothing to apply to), monthly rows and payments with their allocation; plus the month grid (missing / empty / draft / settled / not_synced) and unallocatedPayments — 薪資費用 outflows not linked to any employee, for the owner to assign.",
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    inputSchema: {
      type: "object",
      properties: {
        year: { type: "number", description: "Default: this year (Taipei)." },
        throughMonth: { type: "number", description: "Last salary month to include (1-12). Default: current month for this year, 12 for past years." },
        paidFrom: { type: "string", description: "YYYY-MM-DD: earliest date of 薪資費用 transactions counted as payments (payslip-linked ones count by period instead). Default: Jan 1 of year." },
        paidTo: { type: "string", description: "YYYY-MM-DD: latest payment date counted, also the as-of date for 'due'. Default: today for this year, Jan 31 of the next year for past years." },
        estimateUnfiled: { type: "boolean", description: "Estimate months with no Simpany declaration (within employment) from expectedMonthlyNet. Default true." },
        expectedMonthlyNet: {
          type: "object",
          additionalProperties: { type: "number" },
          description: "Override the monthly net used for estimates, keyed by employee name, e.g. {\"呂安\": 38376}.",
        },
        ...ORG_ARG,
      },
      additionalProperties: false,
    },
    outputSchema: LOOSE_OBJECT,
    execute: async (args, ctx) => {
      const orgId = await resolveOrg(args, ctx);
      const year = yearArg(args);
      return salaryReconciliation(orgId, {
        year,
        throughMonth: monthArg(args, "throughMonth"),
        paidFrom: optDate(args, "paidFrom"),
        paidTo: optDate(args, "paidTo"),
        estimateUnfiled: optBoolean(args, "estimateUnfiled"),
        expectedMonthlyNet: optNumberMap(args.expectedMonthlyNet, "expectedMonthlyNet"),
      });
    },
  },
};

// 廠商計費（付款方式、平台計費帳號、雲端帳單對帳）的 MCP tools。
//
// - 讀：任何成員；寫：只有 owner / admin（跟網頁一致）。
// - 寫入前 service 層一律驗證所有參照都屬於同一個組織（src/lib/vendor-billing/guards.ts）。
// - 這些工具只讀寫本組織自己的資料表，不打 Azure / GCP；同步走既有的 run_integration_sync。
// - 只存卡別、末四碼、到期、持卡人 —— 不收也不回傳完整卡號；不回傳任何整合憑證。
import { canManageOrg, getOrgRole } from "@/lib/session";
import { cardExpiry, type AttentionItem } from "@/lib/vendor-billing/attention";
import {
  ACCOUNT_STATUSES,
  INVOICE_ACTIONS,
  LEDGER_MODES,
  normalizeBillingAccountInput,
  normalizePaymentMethodInput,
  PAYMENT_METHOD_KINDS,
  VENDOR_PROVIDERS,
  type InvoiceAction,
} from "@/lib/vendor-billing/inputs";
import { MATCH_STATUSES, type MatchStatus } from "@/lib/vendor-billing/match";
import {
  getAttention,
  getBillingAccount,
  listBillingAccounts,
  listPaymentMethods,
  listVendorInvoices,
  resolveVendorInvoice,
  upsertBillingAccount,
  upsertPaymentMethod,
  type BillingAccountRow,
  type InvoiceRow,
  type PaymentMethodRow,
  type ResourceRow,
  type TxnBrief,
} from "@/lib/vendor-billing/service";
import { taipeiToday } from "@/lib/vendor-billing/sync-plan";
import {
  listResult,
  listSchema,
  optBoolean,
  optNumber,
  optString,
  ORG_ARG,
  requireNumber,
  requireString,
  resolveOrg,
  rowSchema,
  type ToolDef,
} from "./shared";

async function assertCanManage(orgId: string, userId: string): Promise<void> {
  if (!canManageOrg(await getOrgRole(orgId, userId))) {
    throw new Error("只有組織的擁有者或管理員可以修改廠商計費資料，請找 owner 或 admin 操作。");
  }
}

// ---- 輸出形狀 ----

const NULLABLE_STRING = { type: ["string", "null"] };

const PAYMENT_METHOD_BRIEF = {
  anyOf: [
    rowSchema({
      id: { type: "number" },
      label: { type: "string", description: "e.g. MasterCard •2579" },
      kind: { type: "string", enum: [...PAYMENT_METHOD_KINDS] },
      last4: NULLABLE_STRING,
      expiry: { type: ["string", "null"], description: "MM/YYYY" },
      expiryState: { type: ["string", "null"], enum: ["ok", "warn", "expired", null], description: "warn = expires within 90 days." },
      source: { type: "string", enum: ["manual", "azure"] },
      isActive: { type: "boolean" },
    }),
    { type: "null" },
  ],
};

const TXN_BRIEF = {
  anyOf: [
    rowSchema({
      id: { type: "number", description: "Ledger transaction id (see get_transaction)." },
      txnDate: { type: "string" },
      amount: { type: "number" },
      currency: { type: "string" },
      description: NULLABLE_STRING,
      partyName: NULLABLE_STRING,
    }),
    { type: "null" },
  ],
};

const ACCOUNT_ROW = rowSchema({
  id: { type: "number" },
  provider: { type: "string", enum: [...VENDOR_PROVIDERS] },
  externalId: { type: ["string", "null"], description: "Azure billing profile name / GCP billing account id; null for manual entries without one." },
  displayName: { type: "string" },
  source: { type: "string", enum: ["manual", "synced"] },
  status: { type: "string", enum: [...ACCOUNT_STATUSES] },
  ledgerMode: {
    type: "string",
    enum: [...LEDGER_MODES],
    description: "match_only = only reconcile, never write the ledger (default). create_unmatched = create a needs-review expense for invoices still unmatched 45 days after their date.",
  },
  partyId: { type: ["number", "null"] },
  partyName: NULLABLE_STRING,
  matchPartyIds: { type: "array", items: { type: "number" }, description: "Extra ledger parties also matched against (e.g. both 'Azure' and 'Microsoft')." },
  paymentMethod: PAYMENT_METHOD_BRIEF,
  ownerUserId: NULLABLE_STRING,
  ownerName: NULLABLE_STRING,
  reseller: { type: "boolean", description: "GCP reseller sub-account (billed by the reseller's invoice, not a card)." },
  lastVerifiedAt: { type: ["string", "null"], description: "Manual accounts: when someone last confirmed the data." },
  lastSeenAt: { type: ["string", "null"], description: "Synced accounts: last time the provider returned it." },
  resourceCount: { type: "number" },
  missingResourceCount: { type: "number" },
  openInvoiceCount: { type: "number", description: "Invoices still unmatched or with an unconfirmed suggestion." },
  latestInvoice: {
    anyOf: [
      rowSchema({ invoiceDate: { type: "string" }, amount: { type: "number" }, currency: { type: "string" }, matchStatus: { type: "string" } }),
      { type: "null" },
    ],
  },
  note: NULLABLE_STRING,
  attention: { type: "array", items: { type: "string" }, description: "Why this account needs attention (empty = fine)." },
});

const INVOICE_ROW = rowSchema({
  id: { type: "number" },
  billingAccountId: { type: "number" },
  accountName: { type: "string" },
  provider: { type: "string" },
  externalRef: { type: "string", description: "Azure invoice number, or `<GCP billing account>:<YYYYMM>` for GCP monthly totals from the BigQuery export." },
  source: { type: "string", enum: ["azure_invoice", "gcp_bigquery"] },
  invoiceDate: { type: "string" },
  periodStart: NULLABLE_STRING,
  periodEnd: NULLABLE_STRING,
  amount: { type: "number" },
  currency: { type: "string" },
  status: { type: ["string", "null"], description: "Provider status, e.g. Paid / Due / OverDue." },
  amountDue: { type: ["number", "null"] },
  matchStatus: { type: "string", enum: [...MATCH_STATUSES] },
  matchReason: NULLABLE_STRING,
  matchedTransaction: TXN_BRIEF,
  suggestedTransaction: TXN_BRIEF,
});

const RESOURCE_ROW = rowSchema({
  id: { type: "number" },
  kind: { type: "string", enum: ["azure_subscription", "gcp_project", "other"] },
  externalId: { type: "string" },
  name: NULLABLE_STRING,
  labels: { type: "object", additionalProperties: { type: "string" } },
  status: { type: "string", enum: ["active", "missing"] },
  lastSeenAt: NULLABLE_STRING,
});

const PAYMENT_METHOD_ROW = rowSchema({
  id: { type: "number" },
  kind: { type: "string", enum: [...PAYMENT_METHOD_KINDS] },
  label: { type: "string" },
  brand: NULLABLE_STRING,
  last4: { type: ["string", "null"], description: "Only the last 4 digits are ever stored." },
  expiryMonth: { type: ["number", "null"] },
  expiryYear: { type: ["number", "null"] },
  expiryState: { type: ["string", "null"], enum: ["ok", "warn", "expired", null] },
  holderName: NULLABLE_STRING,
  settlesFromAccountId: { type: ["number", "null"], description: "Ledger bank account the charges are finally paid from." },
  settlesFromAccountName: NULLABLE_STRING,
  source: { type: "string", enum: ["manual", "azure"] },
  isActive: { type: "boolean" },
  note: NULLABLE_STRING,
  accounts: {
    type: "array",
    description: "Billing accounts this payment method pays for.",
    items: rowSchema({ id: { type: "number" }, displayName: { type: "string" }, provider: { type: "string" }, status: { type: "string" } }),
  },
});

// ---- 轉換 ----

function expiryOf(m: number | null, y: number | null, today: string) {
  return {
    expiry: m && y ? `${String(m).padStart(2, "0")}/${y}` : null,
    expiryState: cardExpiry(m, y, today)?.state ?? null,
  };
}

function attentionText(a: AttentionItem): string {
  switch (a.kind) {
    case "card_expired":
      return `付款卡 ${a.label} 已過期`;
    case "card_expiring":
      return `付款卡 ${a.label} ${a.daysLeft} 天後到期`;
    case "no_payment_method":
      return "沒有設定付款方式";
    case "duplicate_cards":
      return `多張卡資料相同（${a.card}），請合併`;
    case "stale_verification":
      return a.days === null ? "手動登記的資料從未確認過" : `手動登記的資料 ${a.days} 天沒確認`;
    case "invoice_unmatched":
      return `帳單 ${a.label} 發票日後 ${a.days} 天仍未對到交易`;
    case "invoice_overdue":
      return `平台帳單逾期未付 ${a.currency} ${a.amount}（${a.label}）`;
    case "account_missing":
      return "平台上找不到這個帳號了";
    case "resource_missing":
      return `資源 ${a.label} 在平台上找不到了`;
  }
}

function attentionAccountId(a: AttentionItem): number | null {
  return "billingAccountId" in a ? a.billingAccountId : null;
}

function accountOut(a: BillingAccountRow, attention: AttentionItem[], today: string) {
  const pm = a.paymentMethod;
  return {
    id: a.id,
    provider: a.provider,
    externalId: a.externalId,
    displayName: a.displayName,
    source: a.source,
    status: a.status,
    ledgerMode: a.ledgerMode,
    partyId: a.partyId,
    partyName: a.partyName,
    matchPartyIds: a.matchPartyIds,
    paymentMethod: pm
      ? {
          id: pm.id,
          label: pm.label,
          kind: pm.kind,
          last4: pm.last4,
          ...expiryOf(pm.expiryMonth, pm.expiryYear, today),
          source: pm.source,
          isActive: pm.isActive,
        }
      : null,
    ownerUserId: a.ownerUserId,
    ownerName: a.ownerName,
    reseller: a.meta?.reseller === true,
    lastVerifiedAt: a.lastVerifiedAt,
    lastSeenAt: a.lastSeenAt,
    resourceCount: a.resourceCount,
    missingResourceCount: a.missingResourceCount,
    openInvoiceCount: a.openInvoiceCount,
    latestInvoice: a.latestInvoice,
    note: a.note,
    attention: attention
      .filter((x) => attentionAccountId(x) === a.id || (pm && "paymentMethodId" in x && x.paymentMethodId === pm.id))
      .map(attentionText),
  };
}

const invoiceOut = (i: InvoiceRow) => ({ ...i, matchedTransaction: txnOut(i.matchedTransaction), suggestedTransaction: txnOut(i.suggestedTransaction) });
const txnOut = (t: TxnBrief | null) => (t ? { ...t } : null);
const resourceOut = (r: ResourceRow) => ({
  id: r.id,
  kind: r.kind,
  externalId: r.externalId,
  name: r.name,
  labels: r.labels,
  status: r.status,
  lastSeenAt: r.lastSeenAt,
});
function paymentMethodOut(p: PaymentMethodRow, today: string) {
  return {
    id: p.id,
    kind: p.kind,
    label: p.label,
    brand: p.brand,
    last4: p.last4,
    expiryMonth: p.expiryMonth,
    expiryYear: p.expiryYear,
    expiryState: cardExpiry(p.expiryMonth, p.expiryYear, today)?.state ?? null,
    holderName: p.holderName,
    settlesFromAccountId: p.settlesFromAccountId,
    settlesFromAccountName: p.settlesFromAccountName,
    source: p.source,
    isActive: p.isActive,
    note: p.note,
    accounts: p.accounts,
  };
}

/** 把 MCP args 裡「有給的」欄位挑出來（PATCH 語意：沒給 = 不動）。 */
function present(args: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) if (args[k] !== undefined) out[k] = args[k];
  return out;
}

// ---- tools ----

export const vendorBillingTools: Record<string, ToolDef> = {
  list_vendor_billing_accounts: {
    description:
      "List this organization's vendor billing accounts — which platform account (Azure billing profile, GCP billing account, Cloudflare, AWS, …) is paid by which payment method (card, reseller invoice, bank transfer, Wise card), with its ledger party, owner, resources count, latest invoice and anything that needs attention (expiring card, no payment method, stale manual data, unmatched/overdue invoices, things gone missing at the provider). Azure/GCP accounts are synced read-only by the integrations (run_integration_sync); others are entered by hand.",
    inputSchema: {
      type: "object",
      properties: {
        ...ORG_ARG,
        provider: { type: "string", enum: [...VENDOR_PROVIDERS] },
        status: { type: "string", enum: [...ACCOUNT_STATUSES] },
        needsAttention: { type: "boolean", description: "Only accounts with at least one attention item." },
      },
      additionalProperties: false,
    },
    outputSchema: listSchema(ACCOUNT_ROW),
    execute: async (args, ctx) => {
      const orgId = await resolveOrg(args, ctx);
      const today = taipeiToday();
      const [rows, attention] = await Promise.all([
        listBillingAccounts(orgId, { provider: optString(args, "provider"), status: optString(args, "status") }),
        getAttention(orgId, today),
      ]);
      const out = rows.map((r) => accountOut(r, attention, today));
      return listResult(optBoolean(args, "needsAttention") ? out.filter((a) => a.attention.length > 0) : out);
    },
  },

  get_vendor_billing_account: {
    description:
      "One vendor billing account with its payment method, resources (Azure subscriptions / GCP projects), recent invoices with their reconciliation status and linked/suggested ledger transactions, and monthly cost totals (analytics only, never booked).",
    inputSchema: {
      type: "object",
      properties: { ...ORG_ARG, id: { type: "number", description: "From list_vendor_billing_accounts." } },
      required: ["id"],
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      properties: {
        account: ACCOUNT_ROW,
        resources: { type: "array", items: RESOURCE_ROW },
        invoices: { type: "array", items: INVOICE_ROW },
        costs: {
          type: "array",
          items: rowSchema({ month: { type: "string" }, currency: { type: "string" }, amount: { type: "number" } }),
        },
      },
      required: ["account", "resources", "invoices", "costs"],
      additionalProperties: false,
    },
    execute: async (args, ctx) => {
      const orgId = await resolveOrg(args, ctx);
      const id = requireNumber(args, "id");
      const today = taipeiToday();
      const [detail, attention] = await Promise.all([getBillingAccount(orgId, id), getAttention(orgId, today)]);
      if (!detail) throw new Error(`Billing account ${id} not found in your organization.`);
      return {
        account: accountOut(detail.account, attention, today),
        resources: detail.resources.map(resourceOut),
        invoices: detail.invoices.map(invoiceOut),
        costs: detail.costs,
      };
    },
  },

  upsert_vendor_billing_account: {
    description:
      "Create (omit id) or update a vendor billing account (owner/admin only). Creating is for platforms without an integration (e.g. Cloudflare, AWS): provider + displayName required. For accounts synced from Azure/GCP only partyId, matchPartyIds, paymentMethodId, ownerUserId, ledgerMode and note can be changed. Look ids up first: partyId/matchPartyIds via list_parties, paymentMethodId via list_payment_methods, ownerUserId via list_org_members. Omitted fields are left unchanged; pass null to clear. Keep ledgerMode = match_only unless the user explicitly wants missing invoices booked automatically.",
    inputSchema: {
      type: "object",
      properties: {
        ...ORG_ARG,
        id: { type: "number", description: "Omit to create." },
        provider: { type: "string", enum: [...VENDOR_PROVIDERS] },
        externalId: { type: ["string", "null"], description: "The account id on the platform (optional for manual entries)." },
        displayName: { type: "string" },
        partyId: { type: ["number", "null"], description: "Ledger party (vendor) the charges are booked under." },
        matchPartyIds: { type: "array", items: { type: "number" }, description: "Extra parties to also match invoices against." },
        paymentMethodId: { type: ["number", "null"] },
        ownerUserId: { type: ["string", "null"], description: "Member responsible for this account." },
        ledgerMode: { type: "string", enum: [...LEDGER_MODES] },
        status: { type: "string", enum: ["active", "closed"], description: "Manual accounts only." },
        note: { type: ["string", "null"] },
      },
      additionalProperties: false,
    },
    outputSchema: { type: "object", properties: { id: { type: "number" }, created: { type: "boolean" }, account: ACCOUNT_ROW }, required: ["id", "created", "account"], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    execute: async (args, ctx) => {
      const orgId = await resolveOrg(args, ctx);
      await assertCanManage(orgId, ctx.userId);
      const patch = normalizeBillingAccountInput(
        present(args, ["id", "provider", "externalId", "displayName", "partyId", "matchPartyIds", "paymentMethodId", "ownerUserId", "ledgerMode", "status", "note"]),
      );
      const r = await upsertBillingAccount(orgId, patch);
      const today = taipeiToday();
      const [[row], attention] = await Promise.all([listBillingAccounts(orgId, { ids: [r.id] }), getAttention(orgId, today)]);
      return { id: r.id, created: r.created, account: accountOut(row, attention, today) };
    },
  },

  list_payment_methods: {
    description:
      "List this organization's payment methods (cards — only brand, last 4 digits, expiry and holder are stored —, reseller invoices, bank transfers, Wise cards) with the ledger account the charges settle from and the billing accounts each one pays. expiryState warn = expires within 90 days.",
    inputSchema: { type: "object", properties: { ...ORG_ARG }, additionalProperties: false },
    outputSchema: listSchema(PAYMENT_METHOD_ROW),
    execute: async (args, ctx) => {
      const orgId = await resolveOrg(args, ctx);
      const today = taipeiToday();
      return listResult((await listPaymentMethods(orgId)).map((p) => paymentMethodOut(p, today)));
    },
  },

  upsert_payment_method: {
    description:
      "Create (omit id) or update a payment method (owner/admin only). NEVER send a full card number — last4 accepts exactly 4 digits and anything longer is rejected. kind + label are required to create. settlesFromAccountId = the ledger bank account the card bill is paid from (look up with list_bank_accounts). Cards synced from Azure can only change label, settlesFromAccountId, isActive and note. Assign it to an account with upsert_vendor_billing_account.",
    inputSchema: {
      type: "object",
      properties: {
        ...ORG_ARG,
        id: { type: "number", description: "Omit to create." },
        kind: { type: "string", enum: [...PAYMENT_METHOD_KINDS] },
        label: { type: "string", description: "e.g. MasterCard •2579, TWGCP 經銷商帳單" },
        brand: { type: ["string", "null"] },
        last4: { type: ["string", "null"], description: "Exactly 4 digits." },
        expiryMonth: { type: ["number", "null"], minimum: 1, maximum: 12 },
        expiryYear: { type: ["number", "null"] },
        holderName: { type: ["string", "null"] },
        settlesFromAccountId: { type: ["number", "null"] },
        isActive: { type: "boolean" },
        note: { type: ["string", "null"] },
      },
      additionalProperties: false,
    },
    outputSchema: { type: "object", properties: { id: { type: "number" }, created: { type: "boolean" }, paymentMethod: PAYMENT_METHOD_ROW }, required: ["id", "created", "paymentMethod"], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    execute: async (args, ctx) => {
      const orgId = await resolveOrg(args, ctx);
      await assertCanManage(orgId, ctx.userId);
      const patch = normalizePaymentMethodInput(
        present(args, ["id", "kind", "label", "brand", "last4", "expiryMonth", "expiryYear", "holderName", "settlesFromAccountId", "isActive", "note"]),
      );
      const r = await upsertPaymentMethod(orgId, patch);
      const row = (await listPaymentMethods(orgId)).find((p) => p.id === r.id);
      if (!row) throw new Error(`Payment method ${r.id} not found after saving.`);
      return { id: r.id, created: r.created, paymentMethod: paymentMethodOut(row, taipeiToday()) };
    },
  },

  list_vendor_invoices: {
    description:
      "List cloud invoices imported by the Azure/GCP integrations (Azure invoices; GCP monthly totals from the BigQuery billing export) and how each reconciles against the ledger: unmatched, suggested (a likely ledger row awaiting confirmation — always the case when currencies differ), matched (automatic), manual, created (a needs-review expense was created because the account is set to create_unmatched), ignored. One ledger row may cover several invoices (card statement rows merge them).",
    inputSchema: {
      type: "object",
      properties: {
        ...ORG_ARG,
        matchStatus: { type: "string", enum: [...MATCH_STATUSES] },
        billingAccountId: { type: "number" },
        limit: { type: "number", description: "Default 100, max 500." },
      },
      additionalProperties: false,
    },
    outputSchema: listSchema(INVOICE_ROW),
    execute: async (args, ctx) => {
      const orgId = await resolveOrg(args, ctx);
      const status = optString(args, "matchStatus");
      if (status && !(MATCH_STATUSES as readonly string[]).includes(status)) throw new Error(`Unknown matchStatus ${status}.`);
      const rows = await listVendorInvoices(orgId, {
        matchStatus: status ? [status as MatchStatus] : undefined,
        billingAccountId: optNumber(args, "billingAccountId"),
        limit: optNumber(args, "limit") ?? 100,
      });
      return listResult(rows.map(invoiceOut));
    },
  },

  resolve_vendor_invoice: {
    description:
      "Resolve one cloud invoice's reconciliation (owner/admin only). action: confirm = accept the suggested ledger transaction; link = link to transactionId (look it up with list_transactions; several invoices may share one transaction); unlink = back to unmatched and remember that transaction as rejected so auto-matching never links it to this invoice again — other candidates can still match; linking it manually later is allowed (a transaction created earlier is NOT deleted); ignore = stop reconciling it; create = create a needs-review expense for it now (party = the account's party, from the payment method's settles-from account, book internal). Show the user what will happen and get confirmation before create.",
    inputSchema: {
      type: "object",
      properties: {
        ...ORG_ARG,
        id: { type: "number", description: "Invoice id from list_vendor_invoices." },
        action: { type: "string", enum: [...INVOICE_ACTIONS] },
        transactionId: { type: "number", description: "Required for action = link." },
      },
      required: ["id", "action"],
      additionalProperties: false,
    },
    outputSchema: { type: "object", properties: { id: { type: "number" }, invoice: INVOICE_ROW }, required: ["id", "invoice"], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    execute: async (args, ctx) => {
      const orgId = await resolveOrg(args, ctx);
      await assertCanManage(orgId, ctx.userId);
      const id = requireNumber(args, "id");
      const action = requireString(args, "action");
      if (!(INVOICE_ACTIONS as readonly string[]).includes(action)) throw new Error(`Unknown action ${action}.`);
      const invoice = await resolveVendorInvoice(orgId, id, action as InvoiceAction, optNumber(args, "transactionId") ?? null);
      return { id, invoice: invoiceOut(invoice) };
    },
  },
};

import { getIntegration } from "@/lib/integrations/store";
import { reconcileVendorInvoices } from "@/lib/vendor-billing/reconcile";
import {
  deleteBillingAccount,
  deletePaymentMethod,
  listLinkCandidates,
  verifyBillingAccount,
} from "@/lib/vendor-billing/service";
import { summarizeCloudSync, syncCloudBilling } from "@/lib/vendor-billing/sync";
import {
  listResult,
  listSchema,
  optBoolean,
  ORG_ARG,
  requireNumber,
  resolveOrg,
  rowSchema,
  type ToolDef,
} from "./shared";
import { assertToolManager, auditIntegrationCall, toolAuditLog } from "./tools-integrations";

// ---- 廠商計費頁的管理動作（網頁 src/app/dashboard/vendor-billing/actions.ts 的 MCP 版）----
//
// 讀取、upsert、對帳單張發票在 tools-vendor-billing.ts；這裡補頁面上其他按鈕：
// 確認資料無誤、刪除帳號 / 付款方式、立即對帳、立即同步、手動綁定的候選交易。
// 同一份 service（src/lib/vendor-billing/*），寫入限 owner / admin。

const WHAT = "修改廠商計費資料";

function requireConfirm(args: Record<string, unknown>, what: string) {
  if (optBoolean(args, "confirm") !== true) {
    throw new Error(`${what} cannot be undone. Ask the user to confirm, then call again with confirm: true.`);
  }
}

const CONFIRM_ARG = {
  confirm: { type: "boolean", description: "Must be true. Ask the user to confirm first." },
} as const;

const TXN_BRIEF = rowSchema({
  id: { type: "number", description: "Transaction id; pass to resolve_vendor_invoice as transactionId." },
  txnDate: { type: "string", description: "YYYY-MM-DD." },
  amount: { type: "number" },
  currency: { type: "string" },
  description: { type: ["string", "null"] },
  partyName: { type: ["string", "null"] },
});

export const vendorBillingAdminTools: Record<string, ToolDef> = {
  verify_vendor_billing_account: {
    description:
      "Mark a vendor billing account's record as checked (確認資料無誤; owner/admin) — clears its 'needs review' attention item. Changes nothing else.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "number", description: "Billing account id (list_vendor_billing_accounts)." }, ...ORG_ARG },
      required: ["id"],
      additionalProperties: false,
    },
    outputSchema: rowSchema({ id: { type: "number" }, verified: { type: "boolean" } }),
    annotations: { idempotentHint: true },
    execute: async (args, ctx) => {
      const orgId = await resolveOrg(args, ctx);
      await assertToolManager(orgId, ctx, WHAT);
      const id = requireNumber(args, "id");
      await verifyBillingAccount(orgId, id);
      await toolAuditLog(ctx, orgId)("update", "vendor_billing_account", id, "確認資料無誤");
      return { id, verified: true };
    },
  },

  delete_vendor_billing_account: {
    description:
      "Delete (soft-delete) a MANUALLY registered vendor billing account (owner/admin). Ledger transactions are not touched. Accounts synced from Azure / GCP cannot be deleted — they would come back on the next sync; remove them from the billing scope with set_cloud_billing_scope instead. Requires confirm: true.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "number" }, ...CONFIRM_ARG, ...ORG_ARG },
      required: ["id", "confirm"],
      additionalProperties: false,
    },
    outputSchema: rowSchema({ id: { type: "number" }, deleted: { type: "boolean" } }),
    execute: async (args, ctx) => {
      requireConfirm(args, "Deleting a vendor billing account");
      const orgId = await resolveOrg(args, ctx);
      await assertToolManager(orgId, ctx, WHAT);
      const id = requireNumber(args, "id");
      await deleteBillingAccount(orgId, id);
      return { id, deleted: true };
    },
  },

  delete_payment_method: {
    description:
      "Delete (soft-delete) a MANUALLY recorded payment method (owner/admin). Billing accounts and recurring expenses that pointed at it become 'not set'. Cards synced from Azure cannot be deleted — deactivate them with upsert_payment_method isActive=false. Requires confirm: true.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "number", description: "From list_payment_methods." }, ...CONFIRM_ARG, ...ORG_ARG },
      required: ["id", "confirm"],
      additionalProperties: false,
    },
    outputSchema: rowSchema({ id: { type: "number" }, deleted: { type: "boolean" } }),
    execute: async (args, ctx) => {
      requireConfirm(args, "Deleting a payment method");
      const orgId = await resolveOrg(args, ctx);
      await assertToolManager(orgId, ctx, WHAT);
      const id = requireNumber(args, "id");
      await deletePaymentMethod(orgId, id);
      return { id, deleted: true };
    },
  },

  reconcile_vendor_invoices: {
    description:
      "Re-run cloud-invoice reconciliation against the ledger now (owner/admin; no external calls) — the 立即對帳 button. Auto-links invoices to matching ledger transactions and records suggestions; only accounts set to create_unmatched get a new ledger row, and only for invoices unmatched 45+ days. Idempotent.",
    inputSchema: { type: "object", properties: { ...ORG_ARG }, additionalProperties: false },
    outputSchema: rowSchema({
      matched: { type: "number" },
      suggested: { type: "number" },
      unmatched: { type: "number" },
      created: { type: "number", description: "New ledger transactions created (create_unmatched accounts only)." },
    }),
    annotations: { idempotentHint: true },
    execute: async (args, ctx) => {
      const orgId = await resolveOrg(args, ctx);
      await assertToolManager(orgId, ctx, WHAT);
      const r = await reconcileVendorInvoices(orgId);
      await toolAuditLog(ctx, orgId)(
        "update",
        "vendor_invoice",
        null,
        `立即對帳：自動綁定 ${r.matched}、建議 ${r.suggested}${r.created ? `、新建交易 ${r.created}` : ""}`,
      );
      return r;
    },
  },

  sync_vendor_billing: {
    description:
      "Sync Azure / GCP billing now (owner/admin) — the 立即同步 button: for each cloud integration that is switched on and healthy, read accounts, resources, cards (Azure), invoices and monthly costs within the ticked billing scope (read-only calls), then reconcile. Writes only this organization's vendor-billing records (and ledger rows only for create_unmatched accounts, as reconcile does). Fails when neither integration is on.",
    inputSchema: { type: "object", properties: { ...ORG_ARG }, additionalProperties: false },
    outputSchema: {
      type: "object",
      properties: {
        results: {
          type: "array",
          items: rowSchema({
            provider: { type: "string", enum: ["azure", "gcp"] },
            ok: { type: "boolean" },
            summary: { type: "string", description: "What was synced (zh-TW), or the error." },
          }),
        },
      },
      required: ["results"],
      additionalProperties: false,
    },
    annotations: { openWorldHint: true, idempotentHint: true },
    execute: async (args, ctx) => {
      const orgId = await resolveOrg(args, ctx);
      await assertToolManager(orgId, ctx, WHAT);
      const results: { provider: "azure" | "gcp"; ok: boolean; summary: string }[] = [];
      for (const provider of ["azure", "gcp"] as const) {
        const s = await getIntegration(orgId, provider);
        if (!s?.enabled || s.status !== "connected") continue;
        try {
          const summary = summarizeCloudSync(await syncCloudBilling(orgId, provider));
          results.push({ provider, ok: true, summary });
          await auditIntegrationCall(ctx, orgId, provider, "update", `手動同步計費：${summary}`);
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          results.push({ provider, ok: false, summary: message });
          await auditIntegrationCall(ctx, orgId, provider, "update", `手動同步計費（失敗）：${message}`);
        }
      }
      if (results.length === 0) {
        throw new Error("沒有已開啟的 Azure / GCP 計費整合，請先連接並用 set_integration_enabled 開啟");
      }
      return { results };
    },
  },

  list_vendor_invoice_link_candidates: {
    description:
      "Ledger expense transactions that could be linked to a cloud invoice by hand: the account's counterparties, dated from 15 days before the invoice date (up to 50). Pass a chosen id to resolve_vendor_invoice with action \"link\".",
    inputSchema: {
      type: "object",
      properties: { invoiceId: { type: "number", description: "From list_vendor_invoices." }, ...ORG_ARG },
      required: ["invoiceId"],
      additionalProperties: false,
    },
    outputSchema: listSchema(TXN_BRIEF),
    execute: async (args, ctx) => {
      const orgId = await resolveOrg(args, ctx);
      return listResult(await listLinkCandidates(orgId, requireNumber(args, "invoiceId")));
    },
  },
};

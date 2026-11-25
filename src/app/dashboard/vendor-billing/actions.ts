"use server";

import { revalidatePath } from "next/cache";
import { logWeb } from "@/db/activity";
import { canManageOrg, requireOrg, requireOrgWithRole } from "@/lib/session";
import { getIntegration, IntegrationUnavailableError } from "@/lib/integrations/store";
import { OrgRefError } from "@/lib/vendor-billing/guards";
import {
  INVOICE_ACTIONS,
  normalizeBillingAccountInput,
  normalizePaymentMethodInput,
  VendorBillingInputError,
  type InvoiceAction,
} from "@/lib/vendor-billing/inputs";
import { buildCostBreakdown, shiftMonth, type CostBreakdown } from "@/lib/vendor-billing/cost-breakdown";
import { reconcileVendorInvoices } from "@/lib/vendor-billing/reconcile";
import { taipeiToday } from "@/lib/vendor-billing/sync-plan";
import {
  deleteBillingAccount,
  deletePaymentMethod,
  getBillingAccount,
  listCostAccounts,
  listCostLines,
  listLinkCandidates,
  type CostAccountOption,
  resolveVendorInvoice,
  upsertBillingAccount,
  upsertPaymentMethod,
  verifyBillingAccount,
  type TxnBrief,
} from "@/lib/vendor-billing/service";
import { summarizeCloudSync, syncCloudBilling } from "@/lib/vendor-billing/sync";

/**
 * 廠商計費頁的 server actions。
 * - 讀：任何成員（requireOrg）。
 * - 寫：只有 owner / admin —— 隱藏按鈕擋不住直接呼叫 action，所以每一支都在這裡再檢查一次。
 * - 所有 id 參照的同組織驗證在 service 層（assertOrgRefs）。回傳值不含任何整合憑證。
 */

export type VendorBillingActionState = { ok: boolean; error?: string; id?: number; message?: string };

const PAGE = "/dashboard/vendor-billing";
const NOT_ALLOWED = "只有組織的擁有者或管理員可以修改廠商計費資料";

async function requireManager(): Promise<{ orgId: string } | { error: string }> {
  const { orgId, role } = await requireOrgWithRole();
  if (!canManageOrg(role)) return { error: NOT_ALLOWED };
  return { orgId };
}

function errorMessage(e: unknown): string {
  if (e instanceof VendorBillingInputError || e instanceof OrgRefError || e instanceof IntegrationUnavailableError) {
    return e.message;
  }
  return e instanceof Error ? e.message : "操作失敗";
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

export async function saveBillingAccountAction(input: Record<string, unknown>): Promise<VendorBillingActionState> {
  // 在 try 外面：未登入時 requireOrg() 會 redirect，那個例外不能被吞掉。
  const me = await requireManager();
  if ("error" in me) return { ok: false, error: me.error };
  try {
    const patch = normalizeBillingAccountInput(asRecord(input));
    const r = await upsertBillingAccount(me.orgId, patch);
    await logWeb(me.orgId, r.created ? "create" : "update", "vendor_billing_account", r.id, patch.displayName);
    revalidatePath(PAGE);
    return { ok: true, id: r.id };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

export async function verifyBillingAccountAction(id: number): Promise<VendorBillingActionState> {
  const me = await requireManager();
  if ("error" in me) return { ok: false, error: me.error };
  try {
    await verifyBillingAccount(me.orgId, Number(id));
    await logWeb(me.orgId, "update", "vendor_billing_account", Number(id), "確認資料無誤");
    revalidatePath(PAGE);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

export async function deleteBillingAccountAction(id: number): Promise<VendorBillingActionState> {
  const me = await requireManager();
  if ("error" in me) return { ok: false, error: me.error };
  try {
    await deleteBillingAccount(me.orgId, Number(id));
    await logWeb(me.orgId, "delete", "vendor_billing_account", Number(id));
    revalidatePath(PAGE);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

export async function savePaymentMethodAction(input: Record<string, unknown>): Promise<VendorBillingActionState> {
  const me = await requireManager();
  if ("error" in me) return { ok: false, error: me.error };
  try {
    const patch = normalizePaymentMethodInput(asRecord(input));
    const r = await upsertPaymentMethod(me.orgId, patch);
    await logWeb(me.orgId, r.created ? "create" : "update", "payment_method", r.id, patch.label);
    revalidatePath(PAGE);
    return { ok: true, id: r.id };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

export async function deletePaymentMethodAction(id: number): Promise<VendorBillingActionState> {
  const me = await requireManager();
  if ("error" in me) return { ok: false, error: me.error };
  try {
    await deletePaymentMethod(me.orgId, Number(id));
    await logWeb(me.orgId, "delete", "payment_method", Number(id));
    revalidatePath(PAGE);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

export async function resolveInvoiceAction(
  invoiceId: number,
  action: string,
  transactionId?: number | null,
): Promise<VendorBillingActionState> {
  const me = await requireManager();
  if ("error" in me) return { ok: false, error: me.error };
  try {
    if (!(INVOICE_ACTIONS as readonly string[]).includes(action)) return { ok: false, error: "不認得的動作" };
    const inv = await resolveVendorInvoice(me.orgId, Number(invoiceId), action as InvoiceAction, transactionId ?? null);
    await logWeb(me.orgId, "update", "vendor_invoice", Number(invoiceId), `${inv?.externalRef ?? invoiceId}：${action}`);
    revalidatePath(PAGE);
    revalidatePath("/dashboard/transactions");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

/** 手動綁定的候選交易（任何成員可讀）。 */
export async function linkCandidatesAction(
  invoiceId: number,
): Promise<{ ok: true; items: TxnBrief[] } | { ok: false; error: string }> {
  const { orgId } = await requireOrg();
  try {
    return { ok: true, items: await listLinkCandidates(orgId, Number(invoiceId)) };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

/** 單一計費帳號的詳細資料（Sheet 開啟時載入；任何成員可讀）。 */
export async function billingAccountDetailAction(id: number) {
  const { orgId } = await requireOrg();
  const detail = await getBillingAccount(orgId, Number(id));
  return detail ?? null;
}

/** 立即同步 Azure / GCP（只跑已開啟且狀態正常的），之後對帳。 */
export async function syncNowAction(): Promise<VendorBillingActionState> {
  const me = await requireManager();
  if ("error" in me) return { ok: false, error: me.error };
  const lines: string[] = [];
  let ran = 0;
  for (const provider of ["azure", "gcp"] as const) {
    const s = await getIntegration(me.orgId, provider);
    if (!s?.enabled || s.status !== "connected") continue;
    ran++;
    try {
      const r = await syncCloudBilling(me.orgId, provider);
      const summary = summarizeCloudSync(r);
      lines.push(`${provider === "azure" ? "Azure" : "GCP"}：${summary}`);
      await logWeb(me.orgId, "update", "integration", null, `${provider}: 手動同步計費：${summary}`);
    } catch (e) {
      lines.push(`${provider === "azure" ? "Azure" : "GCP"}：失敗（${errorMessage(e)}）`);
    }
  }
  revalidatePath(PAGE);
  if (ran === 0) return { ok: false, error: "沒有已開啟的 Azure / GCP 計費整合，請到 設定 › 整合 連接並開啟" };
  return { ok: true, message: lines.join("\n") };
}

/** 只重跑對帳（不打外部 API）。 */
export async function reconcileNowAction(): Promise<VendorBillingActionState> {
  const me = await requireManager();
  if ("error" in me) return { ok: false, error: me.error };
  try {
    const r = await reconcileVendorInvoices(me.orgId);
    revalidatePath(PAGE);
    return {
      ok: true,
      message: [`自動綁定 ${r.matched}`, `建議 ${r.suggested}`, ...(r.created ? [`新建交易 ${r.created}`] : [])].join("、"),
    };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

export type CostBreakdownResult =
  | { ok: true; accounts: CostAccountOption[]; accountId: number | null; currentMonth: string; breakdown: CostBreakdown | null }
  | { ok: false; error: string };

const TREND_MONTHS = 6;

/**
 * 花費明細：有費用資料的帳號清單 + 選定帳號、月份的彙總（近 6 個月趨勢、跟上個月比）。
 * 讀取，任何成員都可以看。沒指定就取第一個帳號、它最新的月份。
 */
export async function costBreakdownAction(input: { accountId?: number | null; month?: string | null }): Promise<CostBreakdownResult> {
  const { orgId } = await requireOrg();
  try {
    const accounts = await listCostAccounts(orgId);
    const account = accounts.find((a) => a.id === Number(input.accountId)) ?? accounts[0];
    const current = `${taipeiToday().slice(0, 7)}-01`;
    if (!account) return { ok: true, accounts, accountId: null, currentMonth: current, breakdown: null };
    // 預設看最近一個已經結束的月份（這個月還沒過完，跟上個月比會失真）；只有本月資料就看本月
    const month =
      input.month && account.months.includes(input.month)
        ? input.month
        : (account.months.find((m) => m < current) ?? account.months[0]);
    const rows = await listCostLines(orgId, account.id, shiftMonth(month, -(TREND_MONTHS - 1)), month);
    return { ok: true, accounts, accountId: account.id, currentMonth: current, breakdown: buildCostBreakdown(rows, month, { trendMonths: TREND_MONTHS }) };
  } catch (e) {
    return { ok: false, error: errorMessage(e) };
  }
}

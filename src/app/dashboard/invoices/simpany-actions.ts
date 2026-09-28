"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { logWeb } from "@/db/activity";
import { canManageOrg, requireOrgWithRole } from "@/lib/session";
import { IntegrationUnavailableError } from "@/lib/integrations/store";
import { SimpanyError, type SimpanyZeroTaxReason } from "@/lib/integrations/simpany";
import {
  cancelSimpanyDraft,
  issueSimpanyDraft,
  KNOWN_ZERO_TAX_REASONS,
  listZeroTaxReasons,
  previewSimpanyInvoice,
  SimpanyPreviewError,
  type InvoicePreview,
  type IssueResult,
  type PreviewInput,
} from "@/lib/simpany-issue";
import { defaultSyncRange, syncSimpanyInvoices, type SyncResult } from "@/lib/simpany-sync";

/**
 * 發票頁 / 請款看板上的 Simpany 動作。全部限 owner / admin（按鈕只對他們顯示，但 action
 * 本身也要再擋一次）。開立與 MCP 共用 src/lib/simpany-issue.ts：一樣是先預覽成草稿、
 * 使用者按下確認才以 draftId 開立。
 *
 * 回傳值不含任何憑證或 token；錯誤訊息是給人看的（Simpany 的錯誤原文會截短帶上）。
 */

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function knownMessage(e: unknown): string | null {
  if (
    e instanceof IntegrationUnavailableError ||
    e instanceof SimpanyError ||
    e instanceof SimpanyPreviewError
  ) {
    return e.message;
  }
  return null;
}

async function manager(): Promise<{ orgId: string; userId: string } | { error: string }> {
  const t = await getTranslations("integrations");
  const { orgId, userId, role } = await requireOrgWithRole();
  if (!canManageOrg(role)) return { error: t("errors.notAllowed") };
  return { orgId, userId };
}

function fail(e: unknown): { ok: false; error: string } {
  return { ok: false, error: knownMessage(e) ?? (e instanceof Error ? e.message : String(e)) };
}

function revalidate() {
  revalidatePath("/dashboard/invoices");
  revalidatePath("/dashboard/invoices/reconcile");
  revalidatePath("/dashboard/billing");
  revalidatePath("/dashboard/transactions");
}

export async function syncSimpanyAction(input: {
  startDate?: string;
  endDate?: string;
}): Promise<Result<SyncResult>> {
  const me = await manager();
  if ("error" in me) return { ok: false, error: me.error };
  try {
    const fallback = defaultSyncRange();
    const startDate = input.startDate && DATE_RE.test(input.startDate) ? input.startDate : fallback.startDate;
    const endDate = input.endDate && DATE_RE.test(input.endDate) ? input.endDate : fallback.endDate;
    if (startDate > endDate) return { ok: false, error: "起日不能晚於迄日" };
    const res = await syncSimpanyInvoices(me.orgId, { startDate, endDate });
    await logWeb(
      me.orgId,
      "update",
      "integration",
      null,
      `simpany: sync ${startDate}~${endDate}: +${res.created} ~${res.updated} void ${res.voided} linked ${res.autoLinked.length}`,
    );
    revalidate();
    return { ok: true, data: res };
  } catch (e) {
    return fail(e);
  }
}

export type SimpanyPreviewFormInput = Pick<
  PreviewInput,
  | "billingItemId"
  | "subscriptionId"
  | "subscriptionPeriod"
  | "transactionId"
  | "type"
  | "buyer"
  | "taxTreatment"
  | "zeroRateReason"
  | "items"
  | "isTaxIncluded"
  | "remark"
  | "foreignCurrency"
  | "foreignAmount"
  | "exchangeRate"
>;

export async function previewSimpanyAction(
  input: SimpanyPreviewFormInput,
): Promise<Result<InvoicePreview>> {
  const me = await manager();
  if ("error" in me) return { ok: false, error: me.error };
  try {
    // 只收白名單欄位，不讓 client 塞別的東西進草稿。
    const clean: PreviewInput = {
      billingItemId: input.billingItemId,
      subscriptionId: input.subscriptionId,
      subscriptionPeriod: input.subscriptionPeriod,
      transactionId: input.transactionId,
      type: input.type,
      buyer: input.buyer,
      taxTreatment: input.taxTreatment,
      zeroRateReason: input.zeroRateReason,
      items: input.items,
      isTaxIncluded: input.isTaxIncluded,
      remark: input.remark,
      foreignCurrency: input.foreignCurrency,
      foreignAmount: input.foreignAmount,
      exchangeRate: input.exchangeRate,
    };
    return { ok: true, data: await previewSimpanyInvoice(me.orgId, me.userId, clean) };
  } catch (e) {
    return fail(e);
  }
}

export async function issueSimpanyAction(draftId: number): Promise<Result<IssueResult>> {
  const me = await manager();
  if ("error" in me) return { ok: false, error: me.error };
  if (!Number.isInteger(draftId)) return { ok: false, error: "草稿編號不正確" };
  try {
    const res = await issueSimpanyDraft(me.orgId, draftId);
    await logWeb(
      me.orgId,
      "create",
      "invoice",
      res.invoiceId,
      `simpany: issue draft #${draftId} → ${res.invoiceNumber ?? res.externalId} NT$${res.total}`,
    );
    revalidate();
    return { ok: true, data: res };
  } catch (e) {
    await logWeb(
      me.orgId,
      "create",
      "integration",
      null,
      `simpany: issue draft #${draftId} failed: ${(knownMessage(e) ?? String(e)).slice(0, 200)}`,
    );
    revalidate();
    return fail(e);
  }
}

export async function cancelSimpanyDraftAction(draftId: number): Promise<Result<boolean>> {
  const me = await manager();
  if ("error" in me) return { ok: false, error: me.error };
  try {
    return { ok: true, data: await cancelSimpanyDraft(me.orgId, draftId) };
  } catch (e) {
    return fail(e);
  }
}

export async function loadZeroTaxReasonsAction(): Promise<SimpanyZeroTaxReason[]> {
  const me = await manager();
  if ("error" in me) return KNOWN_ZERO_TAX_REASONS;
  try {
    const list = await listZeroTaxReasons(me.orgId);
    return list.length ? list : KNOWN_ZERO_TAX_REASONS;
  } catch {
    return KNOWN_ZERO_TAX_REASONS;
  }
}

import { addDays, format, parseISO } from "date-fns";
import { and, desc, eq, gt, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import { getDb } from "@/db";
import {
  billingItems,
  contracts,
  invoiceDrafts,
  invoices,
  parties,
  subscriptions,
  transactions,
} from "@/db/schema";
import { getSubscriptionSchedule } from "@/db/queries";
import { isValidEmail } from "@/lib/pii";
import {
  getSimpanyClient,
  parseDetail,
  SimpanyError,
  type SimpanyClient,
  type SimpanyCreateBody,
  type SimpanyReceiptDetail,
  type SimpanyReceiptType,
  type SimpanyZeroTaxReason,
} from "@/lib/integrations/simpany";
import {
  applyInvoiceLinks,
  clearLinksForVoidedInvoice,
  realVat,
  simpanyTaxTypeOf,
  taipeiDate,
  upsertSimpanyReceipt,
  type InvoiceLinks,
  type TaxTreatment,
  type VoidCleanup,
} from "@/lib/simpany-sync";

/**
 * 在 Simpany 開立 / 作廢電子發票（migrations/0025）。MCP 工具（tools-simpany.ts）與
 * web 的 server actions（dashboard/invoices/simpany-actions.ts）共用這一支。
 *
 * 開立一定是兩段式：
 *   1. previewSimpanyInvoice —— 從本系統資料預填、驗證、算好金額，寫一筆 invoice_drafts
 *      （內含要送出的 request body 原樣），**不呼叫 Simpany 的開立 API**。
 *   2. issueSimpanyDraft(draftId) —— 使用者明確確認預覽後，才把那筆草稿原封不動送出。
 * 開立只接受 draftId，所以「使用者看過的」就是「送出去的」。
 *
 * ⚠️ 開立會產生正式電子發票、上傳財政部並寄信給買受人；作廢不可復原。
 */

const DRAFT_TTL_MS = 2 * 60 * 60 * 1000;
const DUPLICATE_LOOKBACK_DAYS = 60;
const LOW_TRACK_NUMBERS = 20;
/** 財政部 MIG 作廢原因欄位上限。 */
const VOID_REASON_MAX = 20;

export const TAX_TREATMENT_LABEL: Record<TaxTreatment, string> = {
  taxable: "應稅",
  zero_rated: "零稅率",
  exempt: "免稅",
};

/** Simpany 拿不到原因清單時的後備（只列確定的兩個；其他代碼仍可用，但會警示未驗證）。 */
export const KNOWN_ZERO_TAX_REASONS: SimpanyZeroTaxReason[] = [
  { code: "71", name: "外銷貨物" },
  { code: "72", name: "外銷勞務" },
];

export class SimpanyPreviewError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SimpanyPreviewError";
  }
}

// ---------------------------------------------------------------------------
// Amounts
// ---------------------------------------------------------------------------

export type InvoiceAmounts = { untaxed: number; tax: number; total: number };

/**
 * Simpany 會員網頁的算法：應稅含稅 tax = round(sum − sum/1.05)；應稅未稅 tax = round(sum × 0.05)；
 * 零稅率 / 免稅 tax = 0。
 */
export function computeAmounts(
  sum: number,
  treatment: TaxTreatment,
  isTaxIncluded: boolean,
): InvoiceAmounts {
  if (treatment !== "taxable") return { untaxed: sum, tax: 0, total: sum };
  if (isTaxIncluded) {
    const tax = Math.round(sum - sum / 1.05);
    return { untaxed: sum - tax, tax, total: sum };
  }
  const tax = Math.round(sum * 0.05);
  return { untaxed: sum, tax, total: sum + tax };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ---------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------

export type PreviewItemInput = { name: string; quantity: number; price: number };

export type PreviewInput = {
  transactionId?: number;
  billingItemId?: number;
  subscriptionId?: number;
  subscriptionPeriod?: string;
  type?: SimpanyReceiptType;
  buyer?: { vat?: string | null; name?: string | null; address?: string | null; emails?: string[] | null };
  taxTreatment?: TaxTreatment;
  zeroRateReason?: string;
  customsClearance?: "NOT_VIA_CUSTOMS" | "VIA_CUSTOMS";
  items?: PreviewItemInput[];
  isTaxIncluded?: boolean;
  remark?: string;
  foreignCurrency?: string;
  foreignAmount?: number;
  exchangeRate?: number;
};

export type DraftLinks = InvoiceLinks & {
  transactionIds: number[];
};

export type ForeignInfo = {
  currency: string;
  amount: number;
  exchangeRate: number;
  twdAmount: number;
};

export type InvoicePreview = {
  draftId: number;
  expiresAt: string;
  type: SimpanyReceiptType;
  buyer: { vat: string | null; name: string; address: string; emails: string[] };
  taxTreatment: TaxTreatment;
  taxTreatmentLabel: string;
  zeroRateReason: SimpanyZeroTaxReason | null;
  customsClearanceType: "NOT_VIA_CUSTOMS" | "VIA_CUSTOMS" | null;
  isTaxIncluded: boolean;
  items: { name: string; quantity: number; price: number; subTotal: number }[];
  amounts: InvoiceAmounts;
  foreign: ForeignInfo | null;
  remark: string;
  links: DraftLinks;
  warnings: string[];
  trackNumbersRemaining: number | null;
  summary: string;
};

type Source = {
  partyId: number | null;
  amount: number | null;
  currency: string;
  itemName: string | null;
};

function extractEmails(text: string | null | undefined): string[] {
  if (!text) return [];
  const found = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [];
  return [...new Set(found.map((e) => e.toLowerCase()))].filter(isValidEmail);
}

/** Simpany 的品名不能有半形冒號（他們的 UI 會換成全形）。 */
export function sanitizeItemName(name: string): string {
  return name.replaceAll(":", "：").replaceAll(/\s+/g, " ").trim();
}

/** 從交易預填：金額、幣別、品名、客戶，並把交易的綁定帶進 links。 */
async function applyTransactionSource(
  orgId: string,
  transactionId: number,
  src: Source,
  links: DraftLinks,
  warnings: string[],
): Promise<void> {
  const [txn] = await getDb()
    .select({
      id: transactions.id,
      type: transactions.type,
      amount: transactions.amount,
      currency: transactions.currency,
      description: transactions.description,
      partyId: transactions.partyId,
      invoiceId: transactions.invoiceId,
      billingItemId: transactions.billingItemId,
      subscriptionId: transactions.subscriptionId,
      subscriptionPeriod: transactions.subscriptionPeriod,
      contractId: transactions.contractId,
    })
    .from(transactions)
    .where(
      and(
        eq(transactions.organizationId, orgId),
        eq(transactions.id, transactionId),
        isNull(transactions.deletedAt),
      ),
    )
    .limit(1);
  if (!txn) throw new SimpanyPreviewError(`找不到交易 #${transactionId}`);
  if (txn.type !== "income") throw new SimpanyPreviewError(`交易 #${txn.id} 不是收入，不能拿來開發票`);
  if (txn.invoiceId != null) warnings.push(`交易 #${txn.id} 已經綁定發票 #${txn.invoiceId}，可能重複開立`);
  links.transactionIds.push(txn.id);
  links.billingItemId ??= txn.billingItemId;
  if (txn.subscriptionId != null && txn.subscriptionPeriod) {
    links.subscriptionId ??= txn.subscriptionId;
    links.subscriptionPeriod ??= txn.subscriptionPeriod;
  }
  links.contractId ??= txn.contractId;
  src.partyId = txn.partyId;
  src.amount = Number(txn.amount);
  src.currency = txn.currency;
  src.itemName = txn.description;
}

/** 從請款項目預填（金額優先於交易）。 */
async function applyBillingItemSource(
  orgId: string,
  billingItemId: number,
  src: Source,
  links: DraftLinks,
  warnings: string[],
): Promise<void> {
  const [it] = await getDb()
    .select({
      id: billingItems.id,
      customerPartyId: billingItems.customerPartyId,
      contractId: billingItems.contractId,
      contractTitle: contracts.title,
      title: billingItems.title,
      amount: billingItems.amount,
      currency: billingItems.currency,
      invoicedOn: billingItems.invoicedOn,
    })
    .from(billingItems)
    .leftJoin(contracts, eq(contracts.id, billingItems.contractId))
    .where(
      and(
        eq(billingItems.organizationId, orgId),
        eq(billingItems.id, billingItemId),
        isNull(billingItems.deletedAt),
      ),
    )
    .limit(1);
  if (!it) throw new SimpanyPreviewError(`找不到請款項目 #${billingItemId}`);
  if (it.invoicedOn) warnings.push(`請款項目「${it.title}」已標記開發票日 ${it.invoicedOn}，可能重複開立`);
  links.billingItemId = it.id;
  links.contractId ??= it.contractId;
  src.partyId ??= it.customerPartyId;
  // 請款項目的金額優先於交易（交易可能扣了手續費）。
  src.amount = Number(it.amount);
  src.currency = it.currency;
  src.itemName = it.contractTitle ? `${it.contractTitle} ${it.title}` : it.title;
}

/** 從訂閱的某一期預填（期別起日要對得上排程）。 */
async function applySubscriptionSource(
  orgId: string,
  subscriptionId: number,
  subscriptionPeriod: string | undefined,
  src: Source,
  links: DraftLinks,
  warnings: string[],
): Promise<void> {
  if (!subscriptionPeriod || !/^\d{4}-\d{2}-\d{2}$/.test(subscriptionPeriod)) {
    throw new SimpanyPreviewError("指定訂閱時要一併給 subscriptionPeriod（該期起日 YYYY-MM-DD）");
  }
  const [sub] = await getDb()
    .select({ customerPartyId: subscriptions.customerPartyId, contractId: subscriptions.contractId })
    .from(subscriptions)
    .where(
      and(
        eq(subscriptions.organizationId, orgId),
        eq(subscriptions.id, subscriptionId),
        isNull(subscriptions.deletedAt),
      ),
    )
    .limit(1);
  if (!sub) throw new SimpanyPreviewError(`找不到訂閱 #${subscriptionId}`);
  const schedule = await getSubscriptionSchedule(orgId, subscriptionId);
  const period = schedule?.periods.find((p) => p.periodStart === subscriptionPeriod);
  if (!schedule || !period) {
    throw new SimpanyPreviewError(
      `訂閱 #${subscriptionId} 沒有 ${subscriptionPeriod} 這一期（期別起日要對得上 get_subscription_schedule）`,
    );
  }
  if (period.invoicedOn) {
    warnings.push(`訂閱這一期已標記開發票日 ${period.invoicedOn}，可能重複開立`);
  }
  links.subscriptionId = subscriptionId;
  links.subscriptionPeriod = subscriptionPeriod;
  links.contractId ??= sub.contractId;
  src.partyId ??= sub.customerPartyId;
  src.amount = period.expected;
  src.currency = schedule.currency;
  src.itemName = `${schedule.name}（${period.periodLabel}）`;
}

async function loadSource(
  orgId: string,
  input: PreviewInput,
  links: DraftLinks,
  warnings: string[],
): Promise<Source> {
  const src: Source = { partyId: null, amount: null, currency: "TWD", itemName: null };
  // 順序有意義：後面的來源會覆蓋前面的金額 / 品名（請款項目、訂閱優先於交易）。
  if (input.transactionId != null) {
    await applyTransactionSource(orgId, input.transactionId, src, links, warnings);
  }
  const billingItemId = input.billingItemId ?? null;
  if (billingItemId != null) {
    await applyBillingItemSource(orgId, billingItemId, src, links, warnings);
  }
  if (input.subscriptionId != null) {
    await applySubscriptionSource(orgId, input.subscriptionId, input.subscriptionPeriod, src, links, warnings);
  }
  links.partyId = src.partyId;
  return src;
}

/** 本系統的發票顯示用：有號碼用號碼，沒有就用 #id。 */
function invoiceLabel(r: { id: number; number: string | null }): string {
  return r.number ?? `#${r.id}`;
}

/** 本系統內的重複檢查：同請款項目、同訂閱期別、近期同客戶同金額。 */
async function internalDuplicateWarnings(
  orgId: string,
  links: DraftLinks,
  total: number,
  since: string,
): Promise<string[]> {
  const db = getDb();
  const out: string[] = [];
  const notVoid = and(
    eq(invoices.organizationId, orgId),
    isNull(invoices.deletedAt),
    ne(invoices.status, "void"),
  );
  if (links.billingItemId != null) {
    const rows = await db
      .select({ id: invoices.id, number: invoices.invoiceNumber })
      .from(invoices)
      .where(and(notVoid, eq(invoices.billingItemId, links.billingItemId)));
    for (const r of rows) out.push(`這個請款項目已經有發票 ${invoiceLabel(r)}`);
  }
  if (links.subscriptionId != null && links.subscriptionPeriod) {
    const rows = await db
      .select({ id: invoices.id, number: invoices.invoiceNumber })
      .from(invoices)
      .where(
        and(
          notVoid,
          eq(invoices.subscriptionId, links.subscriptionId),
          eq(invoices.subscriptionPeriod, links.subscriptionPeriod),
        ),
      );
    for (const r of rows) out.push(`這個訂閱期別已經有發票 ${invoiceLabel(r)}`);
  }
  if (links.partyId != null) {
    const rows = await db
      .select({ id: invoices.id, number: invoices.invoiceNumber, date: invoices.invoiceDate })
      .from(invoices)
      .where(
        and(
          notVoid,
          eq(invoices.direction, "issued"),
          eq(invoices.partyId, links.partyId),
          sql`${invoices.amountGross} = ${total}`,
          sql`${invoices.invoiceDate} >= ${since}`,
        ),
      );
    for (const r of rows) {
      out.push(`本系統 ${DUPLICATE_LOOKBACK_DAYS} 天內已有同客戶、同金額的發票 ${invoiceLabel(r)}（${r.date ?? "無日期"}），請確認不是重複開立`);
    }
  }
  return out;
}

/**
 * Simpany 端的重複檢查：近期同買受人、同金額、未作廢的發票。直接推進 out，
 * 已經在 out 裡提過的號碼不重複提。查詢失敗只警示，不擋預覽。
 */
async function pushSimpanyDuplicateWarnings(
  out: string[],
  client: SimpanyClient,
  buyer: { vat: string | null; name: string },
  total: number,
  since: string,
  today: string,
): Promise<void> {
  try {
    const res = await client.listReceipts({
      status: "ALL",
      startDate: since,
      endDate: today,
      query: buyer.vat ?? buyer.name,
      limit: 50,
    });
    for (const r of res.data) {
      if (r.status.toUpperCase() === "INVALID") continue;
      if (Math.abs(r.totalAmount - total) >= 0.005) continue;
      const sameBuyer = buyer.vat ? realVat(r.buyerVat) === buyer.vat : r.buyerName?.trim() === buyer.name;
      if (!sameBuyer) continue;
      const msg = `Simpany ${DUPLICATE_LOOKBACK_DAYS} 天內已有同買受人、同金額的發票 ${r.invoiceNumber ?? r.id}（${r.issuedAt?.slice(0, 10) ?? "?"}），可能重複開立`;
      if (!out.some((w) => w.includes(r.invoiceNumber ?? r.id))) out.push(msg);
    }
  } catch (e) {
    out.push(`無法向 Simpany 檢查是否重複開立：${e instanceof Error ? e.message : String(e)}`);
  }
}

async function duplicateWarnings(
  orgId: string,
  client: SimpanyClient,
  links: DraftLinks,
  buyer: { vat: string | null; name: string },
  total: number,
): Promise<string[]> {
  const today = taipeiDate();
  const since = format(addDays(parseISO(today), -DUPLICATE_LOOKBACK_DAYS), "yyyy-MM-dd");
  const out = await internalDuplicateWarnings(orgId, links, total, since);
  await pushSimpanyDuplicateWarnings(out, client, buyer, total, since, today);
  return out;
}

/** 大於 0（NaN 視為否）。刻意不寫成 `x <= 0`：那樣 NaN 會被當成合法。 */
function isPositive(n: number | null | undefined): n is number {
  return n != null && n > 0;
}

type ResolvedBuyer = { vat: string | null; name: string; address: string; emails: string[] };

/** 買受人：輸入優先，沒給就用客戶資料；驗證統編與 email。 */
async function resolveBuyer(
  orgId: string,
  partyId: number | null,
  input: PreviewInput,
  warnings: string[],
): Promise<ResolvedBuyer> {
  let party: { name: string; taxId: string | null; contact: string | null } | null = null;
  if (partyId != null) {
    [party] = await getDb()
      .select({ name: parties.name, taxId: parties.taxId, contact: parties.contact })
      .from(parties)
      .where(and(eq(parties.organizationId, orgId), eq(parties.id, partyId)))
      .limit(1);
  }
  const vatInput = input.buyer?.vat;
  const vatRaw = vatInput === undefined ? party?.taxId ?? null : vatInput;
  const vatTrimmed = vatRaw?.trim() ? vatRaw.trim() : null;
  const vat = realVat(vatTrimmed);
  if (vatTrimmed && !vat) {
    throw new SimpanyPreviewError(`統一編號「${vatTrimmed}」不是 8 碼數字`);
  }
  const name = (input.buyer?.name ?? party?.name ?? "").trim();
  if (!name) throw new SimpanyPreviewError("缺少買受人名稱（buyer.name）");
  const address = (input.buyer?.address ?? "").trim();
  const emails = (input.buyer?.emails ?? extractEmails(party?.contact)).map((e) => e.trim()).filter(Boolean);
  for (const e of emails) {
    if (!isValidEmail(e)) throw new SimpanyPreviewError(`Email 格式不正確：${e}`);
  }
  if (emails.length === 0) {
    warnings.push("沒有買受人 email：Simpany 不會寄開立通知，請確認這樣可以");
  }
  return { vat, name, address, emails };
}

/** 外幣收款：幣別、外幣金額、水單匯率 → 台幣銷售額；台幣收款回 null。 */
function resolveForeign(input: PreviewInput, src: Source): ForeignInfo | null {
  const srcCurrency = src.currency.toUpperCase();
  const srcForeign = srcCurrency === "TWD" ? null : srcCurrency;
  const foreignCurrency = (input.foreignCurrency?.trim().toUpperCase() || srcForeign) ?? null;
  if (!foreignCurrency || foreignCurrency === "TWD") return null;
  if (!/^[A-Z]{3}$/.test(foreignCurrency)) {
    throw new SimpanyPreviewError(`幣別「${foreignCurrency}」不是 3 碼代號`);
  }
  const foreignAmount =
    input.foreignAmount ?? (srcForeign === foreignCurrency ? src.amount ?? undefined : undefined);
  if (!isPositive(foreignAmount)) {
    throw new SimpanyPreviewError("外幣收款要提供外幣金額（foreignAmount）");
  }
  const rate = input.exchangeRate;
  if (!isPositive(rate)) {
    throw new SimpanyPreviewError(
      `這是 ${foreignCurrency} 收款：要提供匯率（exchangeRate），而且必須取自銀行的匯入匯款水單，不可自行估算。台幣銷售額 = round(外幣金額 × 匯率)。`,
    );
  }
  return {
    currency: foreignCurrency,
    amount: foreignAmount,
    exchangeRate: rate,
    twdAmount: Math.round(foreignAmount * rate),
  };
}

/** 發票類型（B2B / B2C）與課稅別，並檢查兩者和統編、外幣是否相符。 */
function resolveTypeAndTreatment(
  input: PreviewInput,
  vat: string | null,
  foreign: ForeignInfo | null,
  warnings: string[],
): { type: SimpanyReceiptType; taxTreatment: TaxTreatment } {
  const type: SimpanyReceiptType = input.type ?? (vat ? "B2B" : "B2C");
  if (type === "B2B" && !vat) {
    throw new SimpanyPreviewError("B2B 發票需要 8 碼統一編號；海外買方沒有台灣統編時請開 B2C（零稅率）");
  }
  if (type === "B2C" && vat) {
    throw new SimpanyPreviewError(`B2C 發票不帶統編；買方有統編 ${vat} 就應開 B2B`);
  }
  const taxTreatment: TaxTreatment =
    input.taxTreatment ?? (foreign && !vat ? "zero_rated" : "taxable");
  if (foreign && taxTreatment === "taxable") {
    warnings.push("這是外幣收款：外銷勞務通常應開零稅率（原因 72、非經海關），確認真的要開應稅？");
  }
  if (taxTreatment === "exempt") {
    warnings.push("免稅只適用法定免稅項目；外銷勞務應開「零稅率 72」而不是免稅（FW10873800 就是這樣開錯而作廢的）");
  }
  if (taxTreatment !== "zero_rated" && input.zeroRateReason) {
    throw new SimpanyPreviewError("只有零稅率發票才能指定零稅率原因");
  }
  return { type, taxTreatment };
}

/** 零稅率原因：優先對 Simpany 的清單驗證；拿不到清單時只檢查格式並警示。 */
async function resolveZeroRateReason(
  simpany: SimpanyClient,
  code: string,
  warnings: string[],
): Promise<SimpanyZeroTaxReason> {
  let reasons: SimpanyZeroTaxReason[] = [];
  try {
    reasons = await simpany.getZeroTaxReasons();
  } catch {
    reasons = [];
  }
  if (reasons.length === 0) {
    if (!/^7\d$/.test(code)) throw new SimpanyPreviewError(`零稅率原因「${code}」格式不正確（應為 71–79）`);
    warnings.push("無法從 Simpany 取得零稅率原因清單，原因代碼未經驗證");
    return KNOWN_ZERO_TAX_REASONS.find((r) => r.code === code) ?? { code, name: "" };
  }
  const hit = reasons.find((r) => r.code === code);
  if (!hit) {
    const known = reasons.map((r) => `${r.code} ${r.name}`).join("、");
    throw new SimpanyPreviewError(`零稅率原因「${code}」不在 Simpany 的清單內：${known}`);
  }
  return hit;
}

/** 零稅率的原因與通關方式；非零稅率兩者都是 null。 */
async function resolveZeroRate(
  simpany: SimpanyClient,
  input: PreviewInput,
  src: Source,
  foreign: ForeignInfo | null,
  taxTreatment: TaxTreatment,
  warnings: string[],
): Promise<{
  zeroRateReason: SimpanyZeroTaxReason | null;
  customsClearanceType: InvoicePreview["customsClearanceType"];
}> {
  if (taxTreatment !== "zero_rated") return { zeroRateReason: null, customsClearanceType: null };
  if (foreign == null && !input.items && src.currency.toUpperCase() !== "TWD") {
    throw new SimpanyPreviewError("零稅率外幣收款需要匯率（exchangeRate，取自水單）");
  }
  const code = (input.zeroRateReason ?? "72").trim();
  const zeroRateReason = await resolveZeroRateReason(simpany, code, warnings);
  const customsClearanceType = input.customsClearance ?? "NOT_VIA_CUSTOMS";
  if (code === "72" && customsClearanceType !== "NOT_VIA_CUSTOMS") {
    warnings.push("外銷勞務（72）通常是「非經海關出口」（NOT_VIA_CUSTOMS）");
  }
  return { zeroRateReason, customsClearanceType };
}

/** 品項來源：有給 items 就用；否則用預填的台幣金額組一個品項；都沒有回空陣列。 */
function rawItemsFor(input: PreviewInput, baseTwd: number | null, itemName: string | null): PreviewItemInput[] {
  if (input.items && input.items.length > 0) return input.items;
  if (baseTwd == null) return [];
  return [{ name: itemName ?? "服務費", quantity: 1, price: baseTwd }];
}

/** 驗證並正規化品項（品名、數量、單價），算出每項小計。 */
function normalizeItems(rawItems: PreviewItemInput[]): InvoicePreview["items"] {
  return rawItems.map((it, i) => {
    const name = sanitizeItemName(String(it.name ?? ""));
    if (!name) throw new SimpanyPreviewError(`第 ${i + 1} 個品項沒有品名`);
    if (name.length > 256) throw new SimpanyPreviewError(`第 ${i + 1} 個品項品名過長`);
    const quantity = Number(it.quantity);
    const price = Number(it.price);
    if (!isPositive(quantity)) throw new SimpanyPreviewError(`第 ${i + 1} 個品項數量要大於 0`);
    if (!isPositive(price)) throw new SimpanyPreviewError(`第 ${i + 1} 個品項單價要大於 0`);
    return { name, quantity, price, subTotal: round2(quantity * price) };
  });
}

/** 預覽的一行摘要（MCP 與 UI 用）。 */
function buildSummaryLine(p: {
  type: SimpanyReceiptType;
  buyer: ResolvedBuyer;
  taxTreatment: TaxTreatment;
  zeroRateReason: SimpanyZeroTaxReason | null;
  amounts: InvoiceAmounts;
  foreign: ForeignInfo | null;
  itemCount: number;
}): string {
  const vatPart = p.buyer.vat ? `（${p.buyer.vat}）` : "";
  let reasonPart = "";
  if (p.zeroRateReason) {
    const reasonName = p.zeroRateReason.name ? ` ${p.zeroRateReason.name}` : "";
    reasonPart = ` ${p.zeroRateReason.code}${reasonName}`;
  }
  return [
    `${p.type} ${p.buyer.name}${vatPart}`,
    `${TAX_TREATMENT_LABEL[p.taxTreatment]}${reasonPart}`,
    `未稅 ${p.amounts.untaxed} + 稅 ${p.amounts.tax} = 總計 NT$${p.amounts.total}`,
    p.foreign ? `${p.foreign.currency} ${p.foreign.amount} × ${p.foreign.exchangeRate}` : null,
    `${p.itemCount} 個品項`,
  ]
    .filter(Boolean)
    .join("｜");
}

/**
 * 產生開立預覽並存成草稿。會讀 Simpany（原因清單、字軌、重複檢查），**不會開立**。
 * 驗證失敗丟 SimpanyPreviewError（訊息給人看）。
 */
export async function previewSimpanyInvoice(
  orgId: string,
  userId: string,
  input: PreviewInput,
  client?: SimpanyClient,
): Promise<InvoicePreview> {
  const simpany = client ?? (await getSimpanyClient(orgId));
  const db = getDb();
  const warnings: string[] = [];
  const links: DraftLinks = { transactionIds: [] };
  const src = await loadSource(orgId, input, links, warnings);

  // ---- buyer ----
  const buyer = await resolveBuyer(orgId, src.partyId, input, warnings);
  const { vat, name: buyerName, address, emails } = buyer;

  // ---- foreign currency ----
  const foreign = resolveForeign(input, src);
  const baseTwd = foreign ? foreign.twdAmount : src.amount;

  // ---- type / tax treatment ----
  const { type, taxTreatment } = resolveTypeAndTreatment(input, vat, foreign, warnings);
  const { zeroRateReason, customsClearanceType } = await resolveZeroRate(
    simpany,
    input,
    src,
    foreign,
    taxTreatment,
    warnings,
  );

  // ---- items ----
  const rawItems = rawItemsFor(input, baseTwd, src.itemName);
  if (rawItems.length === 0) {
    throw new SimpanyPreviewError("沒有品項也沒有可預填的金額：請給 items，或指定 transactionId / billingItemId / subscriptionId");
  }
  const items = normalizeItems(rawItems);
  const sum = round2(items.reduce((s, it) => s + it.subTotal, 0));
  if (!Number.isInteger(sum)) {
    throw new SimpanyPreviewError(`品項合計 ${sum} 不是整數台幣；發票金額必須是整數`);
  }
  if (foreign && input.items && sum !== foreign.twdAmount) {
    warnings.push(`品項合計 ${sum} 與外幣換算的台幣銷售額 ${foreign.twdAmount} 不一致`);
  }
  const isTaxIncluded = input.isTaxIncluded ?? true;
  const amounts = computeAmounts(sum, taxTreatment, isTaxIncluded);
  if (!isPositive(amounts.total)) throw new SimpanyPreviewError("發票總額必須大於 0");

  // ---- checks against Simpany / internal ----
  warnings.push(...(await duplicateWarnings(orgId, simpany, links, { vat, name: buyerName }, amounts.total)));
  const trackNumbersRemaining = await simpany.getRemainingTrackNumbers();
  if (trackNumbersRemaining != null && trackNumbersRemaining < LOW_TRACK_NUMBERS) {
    warnings.push(`字軌剩餘號碼只剩 ${trackNumbersRemaining} 個`);
  }

  const remark = (input.remark ?? "").trim();
  const body: SimpanyCreateBody = {
    customId: null,
    customer:
      type === "B2B"
        ? { vat: vat as string, name: buyerName, address, emails }
        : { name: buyerName, address, emails },
    taxType: simpanyTaxTypeOf(taxTreatment),
    customsClearanceType,
    remark,
    isTaxIncluded,
    shouldAdjustTaxAmount: false,
    carrier: { type: type === "B2C" ? "MEMBERSHIP" : null, number: null },
    npoBan: null,
    items,
    autocompleteSelectedIsVender: false,
    zeroTaxRateReasonCode: zeroRateReason?.code ?? null,
  };

  const summaryLine = buildSummaryLine({
    type,
    buyer,
    taxTreatment,
    zeroRateReason,
    amounts,
    foreign,
    itemCount: items.length,
  });

  const expiresAt = new Date(Date.now() + DRAFT_TTL_MS).toISOString();
  const preview: Omit<InvoicePreview, "draftId"> = {
    expiresAt,
    type,
    buyer: { vat, name: buyerName, address, emails },
    taxTreatment,
    taxTreatmentLabel: TAX_TREATMENT_LABEL[taxTreatment],
    zeroRateReason,
    customsClearanceType,
    isTaxIncluded,
    items,
    amounts,
    foreign,
    remark,
    links,
    warnings,
    trackNumbersRemaining,
    summary: summaryLine,
  };
  const [draft] = await db
    .insert(invoiceDrafts)
    .values({
      organizationId: orgId,
      createdByUserId: userId,
      payload: { type, body },
      summary: preview as unknown as Record<string, unknown>,
      links: links as unknown as Record<string, unknown>,
      status: "pending",
      expiresAt,
    })
    .returning({ id: invoiceDrafts.id });
  return { draftId: draft.id, ...preview };
}

// ---------------------------------------------------------------------------
// Issue
// ---------------------------------------------------------------------------

export type IssueResult = {
  invoiceId: number;
  invoiceNumber: string | null;
  externalId: string;
  type: string;
  buyer: string | null;
  total: number;
  uploadStatus: string | null;
  issuedAt: string | null;
  draftId: number;
};

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

async function explainUnavailableDraft(orgId: string, draftId: number): Promise<never> {
  const [d] = await getDb()
    .select({
      status: invoiceDrafts.status,
      expiresAt: invoiceDrafts.expiresAt,
      issuedInvoiceId: invoiceDrafts.issuedInvoiceId,
    })
    .from(invoiceDrafts)
    .where(and(eq(invoiceDrafts.organizationId, orgId), eq(invoiceDrafts.id, draftId)))
    .limit(1);
  if (!d) throw new SimpanyPreviewError(`找不到草稿 #${draftId}`);
  if (d.status === "issued") {
    const issuedRef = d.issuedInvoiceId ? `（發票 #${d.issuedInvoiceId}）` : "";
    throw new SimpanyPreviewError(`草稿 #${draftId} 已經開立過了${issuedRef}，不會重複開立`);
  }
  if (d.status === "cancelled") {
    throw new SimpanyPreviewError(`草稿 #${draftId} 已取消（先前送出失敗或結果不明），請重新預覽`);
  }
  if (d.status === "pending" && new Date(d.expiresAt).getTime() <= Date.now()) {
    await getDb()
      .update(invoiceDrafts)
      .set({ status: "expired" })
      .where(and(eq(invoiceDrafts.id, draftId), eq(invoiceDrafts.status, "pending")));
  }
  throw new SimpanyPreviewError(`草稿 #${draftId} 已過期（2 小時），請重新預覽`);
}

async function markDraft(
  draftId: number,
  status: "pending" | "cancelled",
  note?: string,
): Promise<void> {
  await getDb()
    .update(invoiceDrafts)
    .set({
      status,
      ...(note
        ? { summary: sql`${invoiceDrafts.summary} || ${JSON.stringify({ lastError: note })}::jsonb` }
        : {}),
    })
    .where(eq(invoiceDrafts.id, draftId));
}

/** 開立成功但回應沒有 id 時的後備：今天同買受人、同金額、最新的那張。 */
async function findJustIssued(
  client: SimpanyClient,
  body: SimpanyCreateBody,
  total: number,
): Promise<SimpanyReceiptDetail | null> {
  const today = taipeiDate();
  const res = await client.listReceipts({
    status: "ALL",
    startDate: today,
    endDate: today,
    query: body.customer.vat ?? body.customer.name,
    limit: 25,
  });
  const hits = res.data
    .filter((r) => Math.abs(r.totalAmount - total) < 0.005 && r.status.toUpperCase() !== "INVALID")
    .sort((a, b) => (b.issuedAt ?? "").localeCompare(a.issuedAt ?? ""));
  return hits[0] ? client.getReceipt(hits[0].id) : null;
}

/** Simpany 明確拒絕（驗證 / 業務 / 認證 / 設定錯誤）：確定沒開出來。 */
function isDefiniteRejection(e: unknown): e is SimpanyError {
  return (
    e instanceof SimpanyError &&
    (e.kind === "validation" || e.kind === "business" || e.kind === "auth" || e.kind === "config")
  );
}

/**
 * 送出開立。失敗時依錯誤種類處理草稿：明確拒絕 → 退回 pending 可再送；
 * 網路中斷 / 5xx → 不知道開了沒，草稿作廢並丟出請使用者先同步確認的錯誤。
 */
async function submitDraft(
  client: SimpanyClient,
  draftId: number,
  type: SimpanyReceiptType,
  body: SimpanyCreateBody,
): Promise<unknown> {
  try {
    return await client.createReceipt(type, body);
  } catch (e) {
    if (isDefiniteRejection(e)) {
      // Simpany 明確拒絕 → 沒開出來，草稿退回可再送（修正後通常要重新預覽）。
      await markDraft(draftId, "pending", e.message);
      throw e;
    }
    // 網路中斷 / 5xx：不知道到底開了沒有。草稿作廢，避免盲目重送造成重複開立。
    const msg = e instanceof Error ? e.message : String(e);
    await markDraft(draftId, "cancelled", msg);
    throw new SimpanyError(
      "http",
      `送出後沒有收到明確結果（${msg}）。發票可能已開出也可能沒有：請先執行「從 Simpany 同步」確認，確定沒開出再重新預覽開立。`,
    );
  }
}

/** 取完整明細：回應形狀未經實測，一律再 GET 一次；拿不到 id 就用買受人 + 金額找今天最新的一張。 */
async function fetchIssuedDetail(
  client: SimpanyClient,
  created: unknown,
  body: SimpanyCreateBody,
  total: number,
): Promise<SimpanyReceiptDetail | null> {
  const createdId = isObj(created) && typeof created.id === "string" ? created.id : null;
  try {
    if (createdId) return await client.getReceipt(createdId);
    return parseDetail(created) ?? (await findJustIssued(client, body, total));
  } catch {
    return parseDetail(created);
  }
}

/**
 * 開立一筆預覽過的草稿。**會在 Simpany 產生正式電子發票、上傳財政部、寄信給買受人。**
 * 只能在使用者明確確認預覽之後呼叫。
 */
export async function issueSimpanyDraft(
  orgId: string,
  draftId: number,
  opts: { notifyEmails?: string[] } = {},
): Promise<IssueResult> {
  const db = getDb();
  for (const e of opts.notifyEmails ?? []) {
    if (!isValidEmail(e.trim())) throw new SimpanyPreviewError(`Email 格式不正確：${e}`);
  }
  // 先搶下草稿（pending → issued）：同一份草稿被按兩次，第二次會搶不到，不會開兩張。
  const [draft] = await db
    .update(invoiceDrafts)
    .set({ status: "issued" })
    .where(
      and(
        eq(invoiceDrafts.organizationId, orgId),
        eq(invoiceDrafts.id, draftId),
        eq(invoiceDrafts.status, "pending"),
        gt(invoiceDrafts.expiresAt, sql`now()`),
      ),
    )
    .returning();
  if (!draft) return explainUnavailableDraft(orgId, draftId);

  const payload = draft.payload as { type?: unknown; body?: unknown };
  const type = payload.type === "B2B" || payload.type === "B2C" ? payload.type : null;
  if (!type || !isObj(payload.body)) {
    await markDraft(draftId, "cancelled", "草稿內容損毀");
    throw new SimpanyPreviewError(`草稿 #${draftId} 內容損毀，請重新預覽`);
  }
  const body = structuredClone(payload.body) as unknown as SimpanyCreateBody;
  if (opts.notifyEmails) body.customer.emails = opts.notifyEmails.map((e) => e.trim());
  const summary = draft.summary as Partial<InvoicePreview>;
  const links = (draft.links ?? {}) as DraftLinks;
  const total = summary.amounts?.total ?? 0;

  let client: SimpanyClient;
  try {
    client = await getSimpanyClient(orgId);
  } catch (e) {
    await markDraft(draftId, "pending");
    throw e;
  }

  const created = await submitDraft(client, draftId, type, body);
  const detail = await fetchIssuedDetail(client, created, body, total);
  if (!detail) {
    throw new SimpanyError(
      "business",
      `Simpany 已接受開立，但無法解析回應取得發票號碼。請到 Simpany 確認，並執行「從 Simpany 同步」把它拉回本系統（草稿 #${draftId} 已標記為已開立，不會重複送出）。`,
    );
  }

  const outcome = await upsertSimpanyReceipt(orgId, detail);
  await applyInvoiceLinks(orgId, outcome.invoiceId, outcome.invoiceDate, links);
  if (summary.foreign) {
    await db
      .update(invoices)
      .set({
        foreignCurrency: summary.foreign.currency,
        foreignAmount: String(summary.foreign.amount),
        exchangeRate: String(summary.foreign.exchangeRate),
      })
      .where(and(eq(invoices.organizationId, orgId), eq(invoices.id, outcome.invoiceId)));
  }
  await db
    .update(invoiceDrafts)
    .set({ issuedInvoiceId: outcome.invoiceId })
    .where(eq(invoiceDrafts.id, draftId));

  return {
    invoiceId: outcome.invoiceId,
    invoiceNumber: detail.invoiceNumber,
    externalId: detail.id,
    type: detail.type,
    buyer: detail.buyerName,
    total: detail.totalAmount,
    uploadStatus: detail.uploadStatus,
    issuedAt: detail.issuedAt,
    draftId,
  };
}

// ---------------------------------------------------------------------------
// Lookup & void
// ---------------------------------------------------------------------------

/** 發票號碼（FW12345678）或 Simpany id（R…）→ Simpany id。 */
export async function resolveSimpanyReceiptId(
  orgId: string,
  client: SimpanyClient,
  ref: string,
): Promise<string> {
  const r = ref.trim();
  if (/^R\d+$/i.test(r)) return r.toUpperCase();
  const number = r.toUpperCase().replaceAll(/[\s-]/g, "");
  if (!/^[A-Z]{2}\d{8}$/.test(number)) {
    throw new SimpanyPreviewError(`「${ref}」不是發票號碼（兩個英文字母 + 8 碼數字）也不是 Simpany id（R 開頭）`);
  }
  const [local] = await getDb()
    .select({ externalId: invoices.externalId })
    .from(invoices)
    .where(
      and(
        eq(invoices.organizationId, orgId),
        isNotNull(invoices.externalId),
        or(eq(invoices.externalRef, number), eq(invoices.invoiceNumber, number)),
      ),
    )
    .orderBy(desc(invoices.id))
    .limit(1);
  if (local?.externalId) return local.externalId;
  const today = taipeiDate();
  const res = await client.listReceipts({
    status: "ALL",
    startDate: format(addDays(parseISO(today), -400), "yyyy-MM-dd"),
    endDate: today,
    query: number,
    limit: 25,
  });
  const hit = res.data.find((x) => x.invoiceNumber?.toUpperCase() === number);
  if (!hit) throw new SimpanyPreviewError(`在 Simpany 找不到發票 ${number}（查了最近 400 天）`);
  return hit.id;
}

export type VoidResult = {
  invoiceId: number;
  invoiceNumber: string | null;
  externalId: string;
  voidedAt: string | null;
  reason: string;
  cleanup: VoidCleanup | null;
};

/** 作廢。**不可復原，Simpany 會通知買受人。** 之後重新同步這張並清掉開發票日 / 交易綁定。 */
export async function voidSimpanyInvoice(
  orgId: string,
  ref: string,
  reason: string,
): Promise<VoidResult> {
  const why = reason.trim();
  if (!why) throw new SimpanyPreviewError("作廢一定要填原因");
  if (why.length > VOID_REASON_MAX) {
    throw new SimpanyPreviewError(`作廢原因最多 ${VOID_REASON_MAX} 個字（財政部欄位上限），目前 ${why.length} 字`);
  }
  const client = await getSimpanyClient(orgId);
  const id = await resolveSimpanyReceiptId(orgId, client, ref);
  const before = await client.getReceipt(id);
  if (before.status.toUpperCase() === "INVALID") {
    throw new SimpanyPreviewError(`發票 ${before.invoiceNumber ?? id} 已經是作廢狀態`);
  }
  if (before.canInvalidate === false) {
    throw new SimpanyPreviewError(
      `Simpany 表示發票 ${before.invoiceNumber ?? id} 目前不能作廢（可能已跨申報期，或已有折讓；需改開折讓單或洽 Simpany）`,
    );
  }
  // 先確保本系統有這張（之前沒同步過的話，作廢後的清理才找得到綁定）。
  await upsertSimpanyReceipt(orgId, before);
  await client.invalidateReceipt(id, why);
  const after = await client.getReceipt(id);
  const outcome = await upsertSimpanyReceipt(orgId, after);
  const cleanup = outcome.becameVoid ? await clearLinksForVoidedInvoice(orgId, outcome.invoiceId) : null;
  if (after.status.toUpperCase() !== "INVALID") {
    throw new SimpanyError(
      "business",
      `已送出作廢，但 Simpany 回報的狀態仍是 ${after.status}。請到 Simpany 確認。`,
    );
  }
  return {
    invoiceId: outcome.invoiceId,
    invoiceNumber: after.invoiceNumber,
    externalId: after.id,
    voidedAt: after.invalidatedAt,
    reason: why,
    cleanup,
  };
}

/** Simpany 的零稅率原因清單（拿不到就回已知的後備清單）。 */
export async function listZeroTaxReasons(orgId: string): Promise<SimpanyZeroTaxReason[]> {
  const client = await getSimpanyClient(orgId);
  return client.getZeroTaxReasons();
}

/** 取消還沒開立的草稿（使用者在預覽後決定不開）。 */
export async function cancelSimpanyDraft(orgId: string, draftId: number): Promise<boolean> {
  const rows = await getDb()
    .update(invoiceDrafts)
    .set({ status: "cancelled" })
    .where(
      and(
        eq(invoiceDrafts.organizationId, orgId),
        eq(invoiceDrafts.id, draftId),
        eq(invoiceDrafts.status, "pending"),
      ),
    )
    .returning({ id: invoiceDrafts.id });
  return rows.length > 0;
}

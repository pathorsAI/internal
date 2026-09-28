import { addDays, differenceInCalendarDays, format, parseISO } from "date-fns";
import { and, eq, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import { getDb } from "@/db";
import {
  billingItems,
  invoices,
  parties,
  subscriptionPeriods,
  transactions,
} from "@/db/schema";
import { listBillingBoard } from "@/db/queries";
import {
  getSimpanyClient,
  type SimpanyClient,
  type SimpanyReceiptDetail,
  type SimpanyReceiptListItem,
} from "@/lib/integrations/simpany";

/**
 * Simpany → internal 的發票同步（migrations/0025）。
 *
 * Simpany 是銷項發票的真相來源：這裡把它的發票拉回 invoices（direction = issued），
 * 以 (organization_id, external_id) 為冪等鍵。之後嘗試把發票「掛」到本系統該開票的東西上：
 *
 *   - 收入交易（transactions.invoice_id）
 *   - 請款項目（billing_items.invoiced_on）或訂閱期別（subscription_periods.invoiced_on）
 *
 * 規則：同一客戶、金額完全相同、日期相差 ±45 天內，且**只有一個候選**才自動綁；
 * 有多個候選（或同一候選被多張發票搶）就不綁，回報在 needsReview 讓人決定。
 *
 * 發票在 Simpany 被作廢時，清掉它當初回填的 invoiced_on 與交易綁定，讓那一期重新出現在
 * 「待開發票」—— 除非同一期已經有另一張有效發票。
 *
 * xlsx 匯出檔對帳（src/lib/simpany-export.ts）保留作為沒開整合時的後備。
 */

const LINK_WINDOW_DAYS = 45;
/** 一次同步最多抓幾張明細（每張一個 subrequest）；超過就回 incomplete，再跑一次會接著做。 */
const MAX_DETAIL_FETCHES = 80;

export type TaxTreatment = "taxable" | "zero_rated" | "exempt";

export function taxTreatmentOf(taxType: string | null | undefined): TaxTreatment {
  if (taxType === "ZERO_TAX_RATE") return "zero_rated";
  if (taxType === "EXEMPTION") return "exempt";
  return "taxable";
}

export function simpanyTaxTypeOf(t: TaxTreatment): "TAXABLE" | "ZERO_TAX_RATE" | "EXEMPTION" {
  if (t === "zero_rated") return "ZERO_TAX_RATE";
  if (t === "exempt") return "EXEMPTION";
  return "TAXABLE";
}

/** B2C 的買受人統編在 Simpany 是 '0000000000'；只有 8 碼數字才算真的統編。 */
export function realVat(v: string | null | undefined): string | null {
  const s = v?.trim() ?? "";
  return /^\d{8}$/.test(s) ? s : null;
}

/** 台北時區的 YYYY-MM-DD。 */
export function taipeiDate(d: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** Simpany 的 issuedAt（ISO，+08:00）→ 開立日期（台北日期）。 */
export function dateOfIssued(iso: string | null): string | null {
  if (!iso) return null;
  if (/^\d{4}-\d{2}-\d{2}T.*\+08:00$/.test(iso)) return iso.slice(0, 10);
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : taipeiDate(d);
}

function isVoid(status: string): boolean {
  return status.toUpperCase() === "INVALID";
}

function sameMoney(a: number | string | null | undefined, b: number | string | null | undefined) {
  if (a == null || b == null) return false;
  return Math.abs(Number(a) - Number(b)) < 0.005;
}

function withinWindow(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  return Math.abs(differenceInCalendarDays(parseISO(a), parseISO(b))) <= LINK_WINDOW_DAYS;
}

/** 品項摘要，存在 note（本系統沒有發票品項表）。 */
export function itemsSummary(d: SimpanyReceiptDetail): string | null {
  const lines = d.items.map((it) => {
    const qty = it.quantity && it.quantity !== 1 ? ` × ${it.quantity}` : "";
    return `${it.name}${qty}：${it.amount || it.price * (it.quantity || 1)}`;
  });
  const parts = [];
  if (lines.length) parts.push(`品項：${lines.join("；")}`);
  if (d.remark) parts.push(`備註：${d.remark}`);
  return parts.length ? parts.join("\n") : null;
}

// ---------------------------------------------------------------------------
// Upsert one receipt
// ---------------------------------------------------------------------------

type ExistingInvoice = {
  id: number;
  externalId: string | null;
  externalRef: string | null;
  invoiceNumber: string | null;
  status: string;
  externalStatus: string;
  externalSyncedAt: string | null;
  partyId: number | null;
  billingItemId: number | null;
  subscriptionId: number | null;
  subscriptionPeriod: string | null;
  invoiceDate: string | null;
  amountGross: string | null;
  note: string | null;
};

const existingColumns = {
  id: invoices.id,
  externalId: invoices.externalId,
  externalRef: invoices.externalRef,
  invoiceNumber: invoices.invoiceNumber,
  status: invoices.status,
  externalStatus: invoices.externalStatus,
  externalSyncedAt: invoices.externalSyncedAt,
  partyId: invoices.partyId,
  billingItemId: invoices.billingItemId,
  subscriptionId: invoices.subscriptionId,
  subscriptionPeriod: invoices.subscriptionPeriod,
  invoiceDate: invoices.invoiceDate,
  amountGross: invoices.amountGross,
  note: invoices.note,
};

type PartyLite = { id: number; name: string; taxId: string | null };

async function loadParties(orgId: string): Promise<PartyLite[]> {
  return getDb()
    .select({ id: parties.id, name: parties.name, taxId: parties.taxId })
    .from(parties)
    .where(and(eq(parties.organizationId, orgId), isNull(parties.deletedAt)));
}

/** 先比統編，再比完全相同的名稱；各自只有唯一一筆才算數。 */
export function matchPartyId(
  all: PartyLite[],
  vat: string | null,
  name: string | null,
): number | null {
  const v = realVat(vat);
  if (v) {
    const byVat = all.filter((p) => p.taxId?.trim() === v);
    if (byVat.length === 1) return byVat[0].id;
  }
  const n = name?.trim();
  if (n) {
    const byName = all.filter((p) => p.name.trim() === n);
    if (byName.length === 1) return byName[0].id;
  }
  return null;
}

export type UpsertOutcome = {
  invoiceId: number;
  action: "created" | "updated" | "adopted";
  /** 這次同步才變成作廢（之前不是）。 */
  becameVoid: boolean;
  partyId: number | null;
  invoiceDate: string | null;
  amountGross: number;
  hasBillingLink: boolean;
};

/** upsertSimpanyReceipt 的既有列查找（順序見下方說明）；找不到回 existing = null。 */
async function findExistingForReceipt(
  orgId: string,
  d: SimpanyReceiptDetail,
  partyId: number | null,
  invoiceDate: string | null,
  known: ExistingInvoice | null | undefined,
): Promise<{ existing: ExistingInvoice | null; action: UpsertOutcome["action"] }> {
  const db = getDb();
  let existing: ExistingInvoice | null | undefined = known;
  if (existing === undefined) {
    [existing] = await db
      .select(existingColumns)
      .from(invoices)
      .where(and(eq(invoices.organizationId, orgId), eq(invoices.externalId, d.id)))
      .limit(1);
  }
  if (existing) return { existing, action: "updated" };
  if (d.invoiceNumber) {
    const [byNumber] = await db
      .select(existingColumns)
      .from(invoices)
      .where(
        and(
          eq(invoices.organizationId, orgId),
          eq(invoices.direction, "issued"),
          isNull(invoices.externalId),
          isNull(invoices.deletedAt),
          or(eq(invoices.externalRef, d.invoiceNumber), eq(invoices.invoiceNumber, d.invoiceNumber)),
        ),
      )
      .limit(1);
    if (byNumber) return { existing: byNumber, action: "adopted" };
  }
  if (partyId != null && invoiceDate) {
    const pending = await db
      .select(existingColumns)
      .from(invoices)
      .where(
        and(
          eq(invoices.organizationId, orgId),
          eq(invoices.direction, "issued"),
          eq(invoices.partyId, partyId),
          eq(invoices.externalStatus, "pending"),
          isNull(invoices.externalId),
          isNull(invoices.deletedAt),
        ),
      );
    const hits = pending.filter(
      (p) => sameMoney(p.amountGross, d.totalAmount) && withinWindow(p.invoiceDate, invoiceDate),
    );
    if (hits.length === 1) return { existing: hits[0], action: "adopted" };
  }
  return { existing: null, action: "updated" };
}

/**
 * 把一張 Simpany 發票寫進 invoices。找既有列的順序：
 *   1. 同 external_id
 *   2. 同發票號碼（external_ref / invoice_number）、還沒有 external_id 的銷項發票（手動或 xlsx 對帳建的）
 *   3. 「待開立」（pending、沒號碼）的銷項發票，同客戶、同金額、±45 天且唯一 —— 舊流程先在本系統建草稿、
 *      再到 Simpany 手開的那種
 * 都沒有才新增。既有列的綁定（客戶、合約、請款項目、訂閱期別、外幣資訊）不覆寫。
 */
export async function upsertSimpanyReceipt(
  orgId: string,
  d: SimpanyReceiptDetail,
  ctx: { parties?: PartyLite[]; existing?: ExistingInvoice | null } = {},
): Promise<UpsertOutcome> {
  const db = getDb();
  const allParties = ctx.parties ?? (await loadParties(orgId));
  const voided = isVoid(d.status);
  const invoiceDate = dateOfIssued(d.issuedAt);
  const partyId = matchPartyId(allParties, d.buyerVat, d.buyerName);

  const { existing, action } = await findExistingForReceipt(orgId, d, partyId, invoiceDate, ctx.existing);

  const facts = {
    direction: "issued",
    invoiceNumber: d.invoiceNumber,
    externalRef: d.invoiceNumber,
    externalId: d.id,
    invoiceDate,
    counterpartyName: d.buyerName,
    counterpartyTaxId: realVat(d.buyerVat),
    amountNet: String(d.untaxedAmount),
    tax: String(d.taxAmount),
    amountGross: String(d.totalAmount),
    currency: "TWD",
    status: voided ? "void" : "valid",
    externalStatus: voided ? "void" : "issued",
    taxTreatment: taxTreatmentOf(d.taxType),
    zeroRateReason: d.zeroTaxRateReason?.code ?? null,
    invoiceType: d.type === "B2B" || d.type === "B2C" ? d.type : null,
    voidedAt: voided ? d.invalidatedAt : null,
    voidReason: voided ? d.invalidReason : null,
    buyerEmails: d.buyerEmails,
    externalSyncedAt: new Date().toISOString(),
  };

  if (existing) {
    await db
      .update(invoices)
      .set({
        ...facts,
        partyId: existing.partyId ?? partyId,
        note: existing.note ?? itemsSummary(d),
      })
      .where(eq(invoices.id, existing.id));
    return {
      invoiceId: existing.id,
      action,
      becameVoid: voided && existing.status !== "void",
      partyId: existing.partyId ?? partyId,
      invoiceDate,
      amountGross: d.totalAmount,
      hasBillingLink: existing.billingItemId != null || existing.subscriptionId != null,
    };
  }

  const [inserted] = await db
    .insert(invoices)
    .values({ organizationId: orgId, ...facts, partyId, note: itemsSummary(d) })
    .onConflictDoUpdate({
      target: [invoices.organizationId, invoices.externalId],
      targetWhere: sql`external_id IS NOT NULL`,
      set: facts,
    })
    .returning({ id: invoices.id });
  return {
    invoiceId: inserted.id,
    action: "created",
    becameVoid: voided,
    partyId,
    invoiceDate,
    amountGross: d.totalAmount,
    hasBillingLink: false,
  };
}

// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------

export type InvoiceLinks = {
  transactionIds?: number[];
  billingItemId?: number | null;
  subscriptionId?: number | null;
  subscriptionPeriod?: string | null;
  contractId?: number | null;
  partyId?: number | null;
};

/** 回填訂閱某期的開發票日（期別不物化，沒有列就新建一列只帶日期）。 */
async function setSubscriptionPeriodInvoiced(
  orgId: string,
  subscriptionId: number,
  periodStart: string,
  date: string | null,
  onlyIfEmpty: boolean,
): Promise<void> {
  const db = getDb();
  const [row] = await db
    .select({ id: subscriptionPeriods.id, invoicedOn: subscriptionPeriods.invoicedOn })
    .from(subscriptionPeriods)
    .where(
      and(
        eq(subscriptionPeriods.organizationId, orgId),
        eq(subscriptionPeriods.subscriptionId, subscriptionId),
        eq(subscriptionPeriods.periodStart, periodStart),
        isNull(subscriptionPeriods.deletedAt),
      ),
    )
    .limit(1);
  if (row) {
    if (onlyIfEmpty && row.invoicedOn) return;
    await db
      .update(subscriptionPeriods)
      .set({ invoicedOn: date })
      .where(eq(subscriptionPeriods.id, row.id));
  } else if (date) {
    await db.insert(subscriptionPeriods).values({
      organizationId: orgId,
      subscriptionId,
      periodStart,
      invoicedOn: date,
    });
  }
}

/**
 * 把發票綁到交易 / 請款項目 / 訂閱期別，並回填開發票日（已有日期不覆蓋）。
 * 呼叫端負責確認這些 id 屬於同一個 org（這裡每個 update 也都帶 org 條件）。
 */
export async function applyInvoiceLinks(
  orgId: string,
  invoiceId: number,
  invoiceDate: string | null,
  links: InvoiceLinks,
): Promise<void> {
  const db = getDb();
  const patch: Partial<typeof invoices.$inferInsert> = {};
  if (links.partyId != null) patch.partyId = links.partyId;
  if (links.contractId != null) patch.contractId = links.contractId;
  if (links.billingItemId != null) patch.billingItemId = links.billingItemId;
  if (links.subscriptionId != null && links.subscriptionPeriod) {
    patch.subscriptionId = links.subscriptionId;
    patch.subscriptionPeriod = links.subscriptionPeriod;
  }
  if (Object.keys(patch).length) {
    await db
      .update(invoices)
      .set(patch)
      .where(and(eq(invoices.organizationId, orgId), eq(invoices.id, invoiceId)));
  }
  const txnIds = (links.transactionIds ?? []).filter((n) => Number.isFinite(n));
  if (txnIds.length) {
    await db
      .update(transactions)
      .set({ invoiceId })
      .where(
        and(
          eq(transactions.organizationId, orgId),
          inArray(transactions.id, txnIds),
          isNull(transactions.invoiceId),
        ),
      );
  }
  if (links.billingItemId != null && invoiceDate) {
    await db
      .update(billingItems)
      .set({ invoicedOn: invoiceDate })
      .where(
        and(
          eq(billingItems.organizationId, orgId),
          eq(billingItems.id, links.billingItemId),
          isNull(billingItems.invoicedOn),
        ),
      );
  }
  if (links.subscriptionId != null && links.subscriptionPeriod && invoiceDate) {
    await setSubscriptionPeriodInvoiced(
      orgId,
      links.subscriptionId,
      links.subscriptionPeriod,
      invoiceDate,
      true,
    );
  }
}

export type VoidCleanup = {
  invoiceId: number;
  invoiceNumber: string | null;
  clearedBillingItemId: number | null;
  clearedSubscription: { subscriptionId: number; periodStart: string } | null;
  unlinkedTransactionIds: number[];
};

/**
 * 發票作廢後：清掉它回填的開發票日（同一期若還有別張有效發票就不清），解除交易綁定。
 * 發票列本身的綁定欄位保留，當作歷史。
 */
export async function clearLinksForVoidedInvoice(
  orgId: string,
  invoiceId: number,
): Promise<VoidCleanup> {
  const db = getDb();
  const [inv] = await db
    .select({
      invoiceNumber: invoices.invoiceNumber,
      billingItemId: invoices.billingItemId,
      subscriptionId: invoices.subscriptionId,
      subscriptionPeriod: invoices.subscriptionPeriod,
    })
    .from(invoices)
    .where(and(eq(invoices.organizationId, orgId), eq(invoices.id, invoiceId)))
    .limit(1);
  const out: VoidCleanup = {
    invoiceId,
    invoiceNumber: inv?.invoiceNumber ?? null,
    clearedBillingItemId: null,
    clearedSubscription: null,
    unlinkedTransactionIds: [],
  };
  if (!inv) return out;

  const otherValid = (cond: ReturnType<typeof and>) =>
    db
      .select({ id: invoices.id })
      .from(invoices)
      .where(
        and(
          eq(invoices.organizationId, orgId),
          ne(invoices.id, invoiceId),
          ne(invoices.status, "void"),
          isNull(invoices.deletedAt),
          cond,
        ),
      )
      .limit(1);

  if (inv.billingItemId != null) {
    const [other] = await otherValid(and(eq(invoices.billingItemId, inv.billingItemId)));
    if (!other) {
      await db
        .update(billingItems)
        .set({ invoicedOn: null })
        .where(and(eq(billingItems.organizationId, orgId), eq(billingItems.id, inv.billingItemId)));
      out.clearedBillingItemId = inv.billingItemId;
    }
  }
  if (inv.subscriptionId != null && inv.subscriptionPeriod) {
    const [other] = await otherValid(
      and(
        eq(invoices.subscriptionId, inv.subscriptionId),
        eq(invoices.subscriptionPeriod, inv.subscriptionPeriod),
      ),
    );
    if (!other) {
      await setSubscriptionPeriodInvoiced(orgId, inv.subscriptionId, inv.subscriptionPeriod, null, false);
      out.clearedSubscription = {
        subscriptionId: inv.subscriptionId,
        periodStart: inv.subscriptionPeriod,
      };
    }
  }
  const unlinked = await db
    .update(transactions)
    .set({ invoiceId: null })
    .where(and(eq(transactions.organizationId, orgId), eq(transactions.invoiceId, invoiceId)))
    .returning({ id: transactions.id });
  out.unlinkedTransactionIds = unlinked.map((r) => r.id);
  return out;
}

// ---------------------------------------------------------------------------
// Auto-link candidates
// ---------------------------------------------------------------------------

type Candidate =
  | { kind: "transaction"; id: number; label: string; billingItemId: number | null }
  | { kind: "billing_item"; id: number; label: string; contractId: number | null }
  | {
      kind: "subscription_period";
      id: number;
      periodStart: string;
      label: string;
      contractId: number | null;
    };

function candidateKey(c: Candidate): string {
  return c.kind === "subscription_period" ? `sub:${c.id}:${c.periodStart}` : `${c.kind}:${c.id}`;
}

type CandidatePools = {
  txns: {
    id: number;
    partyId: number | null;
    txnDate: string;
    amount: string;
    currency: string;
    amountTwd: string | null;
    description: string | null;
    billingItemId: number | null;
  }[];
  items: {
    id: number;
    customerPartyId: number;
    contractId: number | null;
    title: string;
    amount: string;
    currency: string;
    anchor: string | null;
  }[];
  periods: {
    subscriptionId: number;
    periodStart: string;
    customerPartyId: number | null;
    contractId: number | null;
    title: string;
    expected: number;
    currency: string;
    anchor: string | null;
  }[];
  /** 已被某張有效發票綁走的請款項目 / 訂閱期別。 */
  takenBilling: Set<string>;
};

async function loadCandidatePools(orgId: string, from: string, to: string): Promise<CandidatePools> {
  const db = getDb();
  const lo = format(addDays(parseISO(from), -LINK_WINDOW_DAYS), "yyyy-MM-dd");
  const hi = format(addDays(parseISO(to), LINK_WINDOW_DAYS), "yyyy-MM-dd");
  const [txns, items, board, taken] = await Promise.all([
    db
      .select({
        id: transactions.id,
        partyId: transactions.partyId,
        txnDate: transactions.txnDate,
        amount: transactions.amount,
        currency: transactions.currency,
        amountTwd: transactions.amountTwd,
        description: transactions.description,
        billingItemId: transactions.billingItemId,
      })
      .from(transactions)
      .where(
        and(
          eq(transactions.organizationId, orgId),
          eq(transactions.type, "income"),
          isNull(transactions.invoiceId),
          isNull(transactions.deletedAt),
          isNotNull(transactions.partyId),
          sql`${transactions.txnDate} between ${lo} and ${hi}`,
        ),
      ),
    db
      .select({
        id: billingItems.id,
        customerPartyId: billingItems.customerPartyId,
        contractId: billingItems.contractId,
        title: billingItems.title,
        amount: billingItems.amount,
        currency: billingItems.currency,
        billedOn: billingItems.billedOn,
        dueDate: billingItems.dueDate,
        paidOn: billingItems.paidOn,
      })
      .from(billingItems)
      .where(
        and(
          eq(billingItems.organizationId, orgId),
          isNull(billingItems.deletedAt),
          isNull(billingItems.invoicedOn),
          eq(billingItems.needsInvoice, true),
          ne(billingItems.status, "cancelled"),
        ),
      ),
    listBillingBoard(orgId, { includeAllHistory: true }),
    db
      .select({
        billingItemId: invoices.billingItemId,
        subscriptionId: invoices.subscriptionId,
        subscriptionPeriod: invoices.subscriptionPeriod,
      })
      .from(invoices)
      .where(
        and(
          eq(invoices.organizationId, orgId),
          isNull(invoices.deletedAt),
          ne(invoices.status, "void"),
          or(isNotNull(invoices.billingItemId), isNotNull(invoices.subscriptionId)),
        ),
      ),
  ]);
  const takenBilling = new Set<string>();
  for (const t of taken) {
    if (t.billingItemId != null) takenBilling.add(`billing_item:${t.billingItemId}`);
    if (t.subscriptionId != null && t.subscriptionPeriod) {
      takenBilling.add(`sub:${t.subscriptionId}:${t.subscriptionPeriod}`);
    }
  }
  return {
    txns,
    items: items.map((it) => ({
      id: it.id,
      customerPartyId: it.customerPartyId,
      contractId: it.contractId,
      title: it.title,
      amount: it.amount,
      currency: it.currency,
      anchor: it.billedOn ?? it.dueDate ?? it.paidOn,
    })),
    periods: board
      .filter((r) => r.source === "subscription" && r.subscriptionId != null && r.periodStart && !r.invoicedOn)
      .map((r) => ({
        subscriptionId: r.subscriptionId as number,
        periodStart: r.periodStart as string,
        customerPartyId: r.customerPartyId,
        contractId: r.contractId,
        title: r.title,
        expected: r.expected,
        currency: r.currency,
        anchor: r.billedOn ?? r.dueDate ?? r.periodStart,
      })),
    takenBilling,
  };
}

type LinkTarget = { invoiceId: number; partyId: number; invoiceDate: string; gross: number };

function findCandidates(
  pools: CandidatePools,
  inv: LinkTarget,
  want: { txn: boolean; billing: boolean },
): { txn: Candidate[]; billing: Candidate[] } {
  const txn: Candidate[] = want.txn
    ? pools.txns
        .filter(
          (t) =>
            t.partyId === inv.partyId &&
            withinWindow(t.txnDate, inv.invoiceDate) &&
            ((t.currency === "TWD" && sameMoney(t.amount, inv.gross)) || sameMoney(t.amountTwd, inv.gross)),
        )
        .map((t) => ({
          kind: "transaction" as const,
          id: t.id,
          billingItemId: t.billingItemId,
          label: `${t.txnDate} ${t.description ?? "收入"} ${t.currency} ${Number(t.amount)}`,
        }))
    : [];
  const billing: Candidate[] = [];
  if (want.billing) {
    for (const it of pools.items) {
      if (
        it.customerPartyId === inv.partyId &&
        it.currency === "TWD" &&
        sameMoney(it.amount, inv.gross) &&
        withinWindow(it.anchor, inv.invoiceDate) &&
        !pools.takenBilling.has(`billing_item:${it.id}`)
      ) {
        billing.push({
          kind: "billing_item",
          id: it.id,
          contractId: it.contractId,
          label: `請款項目「${it.title}」TWD ${Number(it.amount)}`,
        });
      }
    }
    for (const p of pools.periods) {
      if (
        p.customerPartyId === inv.partyId &&
        p.currency === "TWD" &&
        sameMoney(p.expected, inv.gross) &&
        withinWindow(p.anchor, inv.invoiceDate) &&
        !pools.takenBilling.has(`sub:${p.subscriptionId}:${p.periodStart}`)
      ) {
        billing.push({
          kind: "subscription_period",
          id: p.subscriptionId,
          periodStart: p.periodStart,
          contractId: p.contractId,
          label: `訂閱「${p.title}」TWD ${p.expected}`,
        });
      }
    }
  }
  return { txn, billing };
}

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

export type NeedsReviewItem = {
  invoiceId: number;
  invoiceNumber: string | null;
  buyer: string | null;
  amount: number;
  reason: string;
  candidates: { kind: string; id: number; periodStart?: string; label: string }[];
};

export type SyncResult = {
  startDate: string;
  endDate: string;
  seen: number;
  created: number;
  updated: number;
  unchanged: number;
  voided: number;
  autoLinked: { invoiceNumber: string | null; invoiceId: number; linkedTo: string[] }[];
  voidCleanups: VoidCleanup[];
  needsReview: NeedsReviewItem[];
  /** true = 這次沒做完（明細太多或分頁太多），再跑一次會接著做（冪等）。 */
  incomplete: boolean;
};

type TouchedInvoice = UpsertOutcome & { invoiceNumber: string | null; buyer: string | null };

/** 已同步過、狀態 / 號碼 / 金額都沒變 → 不用重抓明細。 */
function isUnchangedReceipt(existing: ExistingInvoice, item: SimpanyReceiptListItem): boolean {
  const statusNow = isVoid(item.status) ? "void" : "valid";
  return (
    Boolean(existing.externalSyncedAt) &&
    existing.status === statusNow &&
    existing.invoiceNumber === item.invoiceNumber &&
    sameMoney(existing.amountGross, item.totalAmount)
  );
}

/** 沒變的有效發票仍要參加自動綁定（可能之前沒綁上）；作廢或沒日期的不參加。 */
function touchedFromUnchanged(existing: ExistingInvoice, item: SimpanyReceiptListItem): TouchedInvoice | null {
  if (isVoid(item.status) || !existing.invoiceDate) return null;
  return {
    invoiceId: existing.id,
    action: "updated",
    becameVoid: false,
    partyId: existing.partyId,
    invoiceDate: existing.invoiceDate,
    amountGross: item.totalAmount,
    hasBillingLink: existing.billingItemId != null || existing.subscriptionId != null,
    invoiceNumber: existing.invoiceNumber,
    buyer: item.buyerName,
  };
}

/** 抓一張的明細並寫入，更新計數；新作廢的清掉綁定。回傳要參加自動綁定的發票（作廢的不參加）。 */
async function syncReceiptDetail(
  orgId: string,
  simpany: SimpanyClient,
  receiptId: string,
  existing: ExistingInvoice | null,
  allParties: PartyLite[],
  result: SyncResult,
): Promise<TouchedInvoice | null> {
  const detail = await simpany.getReceipt(receiptId);
  const outcome = await upsertSimpanyReceipt(orgId, detail, { parties: allParties, existing });
  if (outcome.action === "created") result.created++;
  else result.updated++;
  if (outcome.becameVoid) {
    result.voided++;
    if (outcome.action !== "created") {
      result.voidCleanups.push(await clearLinksForVoidedInvoice(orgId, outcome.invoiceId));
    }
  }
  if (isVoid(detail.status)) return null;
  return { ...outcome, invoiceNumber: detail.invoiceNumber, buyer: detail.buyerName };
}

/**
 * 同步一段日期區間的 Simpany 發票進 invoices，並嘗試自動綁定。冪等：同一張發票重跑只會更新。
 * 已同步過、狀態沒變的發票不會重抓明細。
 */
export async function syncSimpanyInvoices(
  orgId: string,
  range: { startDate: string; endDate: string },
  client?: SimpanyClient,
): Promise<SyncResult> {
  const simpany = client ?? (await getSimpanyClient(orgId));
  const db = getDb();

  // ALL 應該已含作廢的；另外抓一次 INVALID 以防 ALL 不含（兩邊以 id 去重）。
  const [all, invalid] = await Promise.all([
    simpany.listAllReceipts({ status: "ALL", ...range }),
    simpany.listAllReceipts({ status: "INVALID", ...range }),
  ]);
  const byId = new Map<string, SimpanyReceiptListItem>();
  for (const r of all.items) byId.set(r.id, r);
  for (const r of invalid.items) byId.set(r.id, r);
  const list = [...byId.values()];

  const result: SyncResult = {
    ...range,
    seen: list.length,
    created: 0,
    updated: 0,
    unchanged: 0,
    voided: 0,
    autoLinked: [],
    voidCleanups: [],
    needsReview: [],
    incomplete: all.truncated || invalid.truncated,
  };
  if (list.length === 0) return result;

  const [allParties, existingRows] = await Promise.all([
    loadParties(orgId),
    db
      .select(existingColumns)
      .from(invoices)
      .where(
        and(
          eq(invoices.organizationId, orgId),
          inArray(
            invoices.externalId,
            list.map((r) => r.id),
          ),
        ),
      ),
  ]);
  const existingById = new Map(existingRows.map((r) => [r.externalId as string, r]));

  const touched: TouchedInvoice[] = [];
  let fetched = 0;
  for (const item of list) {
    const existing = existingById.get(item.id) ?? null;
    if (existing && isUnchangedReceipt(existing, item)) {
      result.unchanged++;
      const touch = touchedFromUnchanged(existing, item);
      if (touch) touched.push(touch);
      continue;
    }
    if (fetched >= MAX_DETAIL_FETCHES) {
      result.incomplete = true;
      continue;
    }
    fetched++;
    const touch = await syncReceiptDetail(orgId, simpany, item.id, existing, allParties, result);
    if (touch) touched.push(touch);
  }

  await autoLink(orgId, range, touched, result);
  return result;
}

type LinkPlan = { t: TouchedInvoice; txn: Candidate[]; billing: Candidate[] };

/** 已經有交易綁著的發票 id（這些不用再找收款交易）。 */
async function invoiceIdsWithLinkedTxn(orgId: string, invoiceIds: number[]): Promise<Set<number | null>> {
  const rows = await getDb()
    .select({ invoiceId: transactions.invoiceId })
    .from(transactions)
    .where(
      and(
        eq(transactions.organizationId, orgId),
        isNull(transactions.deletedAt),
        inArray(transactions.invoiceId, invoiceIds),
      ),
    );
  return new Set(rows.map((r) => r.invoiceId));
}

/** 第一輪：每張發票各自的候選。對不上客戶的新發票直接列入待確認。 */
function planAutoLinks(
  touched: TouchedInvoice[],
  linkedTxn: Set<number | null>,
  pools: CandidatePools,
  result: SyncResult,
): LinkPlan[] {
  const plans: LinkPlan[] = [];
  for (const t of touched) {
    const wantTxn = !linkedTxn.has(t.invoiceId);
    const wantBilling = !t.hasBillingLink;
    if (!wantTxn && !wantBilling) continue;
    if (t.partyId == null || !t.invoiceDate) {
      if (t.action === "created") {
        result.needsReview.push({
          invoiceId: t.invoiceId,
          invoiceNumber: t.invoiceNumber,
          buyer: t.buyer,
          amount: t.amountGross,
          reason: "找不到對應的客戶（統編與名稱都對不上），無法自動綁定收款或請款",
          candidates: [],
        });
      }
      continue;
    }
    const c = findCandidates(
      pools,
      { invoiceId: t.invoiceId, partyId: t.partyId, invoiceDate: t.invoiceDate, gross: t.amountGross },
      { txn: wantTxn, billing: wantBilling },
    );
    plans.push({ t, ...c });
  }
  return plans;
}

/** 第二輪：每個候選是幾張發票的「唯一候選」。大於 1 就是模稜兩可。 */
function countSoleClaims(plans: LinkPlan[]): Map<string, number> {
  const soleClaims = new Map<string, number>();
  for (const p of plans) {
    for (const list of [p.txn, p.billing]) {
      if (list.length === 1) {
        const k = candidateKey(list[0]);
        soleClaims.set(k, (soleClaims.get(k) ?? 0) + 1);
      }
    }
  }
  return soleClaims;
}

/** 只有一個候選、而且它沒有被別張發票當成唯一候選，才能自動綁。 */
function uniqueUnclaimed(cands: Candidate[], soleClaims: Map<string, number>): Candidate | null {
  const only = cands[0];
  if (cands.length !== 1 || !only) return null;
  return (soleClaims.get(candidateKey(only)) ?? 0) === 1 ? only : null;
}

/** 把請款項目 / 訂閱期別候選寫進 links；回傳給人看的描述（交易候選不會走到這裡）。 */
function applyBillingCandidate(b: Candidate, links: InvoiceLinks): string | null {
  if (b.kind === "billing_item") {
    links.billingItemId = b.id;
    links.contractId = b.contractId;
    return `請款項目 #${b.id}`;
  }
  if (b.kind === "subscription_period") {
    links.subscriptionId = b.id;
    links.subscriptionPeriod = b.periodStart;
    links.contractId = b.contractId;
    return `訂閱 #${b.id} ${b.periodStart} 期`;
  }
  return null;
}

function reviewItem(t: TouchedInvoice, reason: string, cands: Candidate[]): NeedsReviewItem {
  return {
    invoiceId: t.invoiceId,
    invoiceNumber: t.invoiceNumber,
    buyer: t.buyer,
    amount: t.amountGross,
    reason,
    candidates: cands.map((c) => ({
      kind: c.kind,
      id: c.id,
      ...(c.kind === "subscription_period" ? { periodStart: c.periodStart } : {}),
      label: c.label,
    })),
  };
}

/** 依一張發票的候選決定綁定：唯一且無爭議就綁，否則列入待確認。 */
async function applyLinkPlan(
  orgId: string,
  { t, txn, billing }: LinkPlan,
  soleClaims: Map<string, number>,
  result: SyncResult,
): Promise<void> {
  const linkedTo: string[] = [];
  const links: InvoiceLinks = {};

  const txnHit = uniqueUnclaimed(txn, soleClaims);
  if (txnHit) {
    links.transactionIds = [txnHit.id];
    linkedTo.push(`交易 #${txnHit.id}`);
  } else if (txn.length > 0) {
    const reason =
      txn.length > 1
        ? "有多筆可能對應的收入交易，未自動綁定"
        : "對應的收入交易同時也可能屬於另一張發票，未自動綁定";
    result.needsReview.push(reviewItem(t, reason, txn));
  }

  const billingHit = uniqueUnclaimed(billing, soleClaims);
  if (billingHit) {
    const label = applyBillingCandidate(billingHit, links);
    if (label) linkedTo.push(label);
  } else if (billing.length > 0) {
    const reason =
      billing.length > 1
        ? "有多個可能對應的請款項目 / 訂閱期別，未自動綁定"
        : "對應的請款項目 / 訂閱期別同時也可能屬於另一張發票，未自動綁定";
    result.needsReview.push(reviewItem(t, reason, billing));
  }

  if (linkedTo.length) {
    await applyInvoiceLinks(orgId, t.invoiceId, t.invoiceDate, links);
    result.autoLinked.push({ invoiceNumber: t.invoiceNumber, invoiceId: t.invoiceId, linkedTo });
  }
}

async function autoLink(
  orgId: string,
  range: { startDate: string; endDate: string },
  touched: TouchedInvoice[],
  result: SyncResult,
): Promise<void> {
  if (touched.length === 0) return;
  const linkedTxn = await invoiceIdsWithLinkedTxn(
    orgId,
    touched.map((t) => t.invoiceId),
  );
  const pools = await loadCandidatePools(orgId, range.startDate, range.endDate);
  const plans = planAutoLinks(touched, linkedTxn, pools, result);
  const soleClaims = countSoleClaims(plans);
  for (const plan of plans) {
    await applyLinkPlan(orgId, plan, soleClaims, result);
  }
}

/** 預設同步區間：最近 90 天（台北日期）。 */
export function defaultSyncRange(): { startDate: string; endDate: string } {
  const end = taipeiDate();
  return { startDate: format(addDays(parseISO(end), -90), "yyyy-MM-dd"), endDate: end };
}

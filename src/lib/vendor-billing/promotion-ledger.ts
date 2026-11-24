import { and, desc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { categories, transactions, vendorBillingAccounts, vendorInvoices } from "@/db/schema";
import type { GcpPromotionMonth } from "@/lib/integrations/gcp";
import { booksPromotionCredits, matchPartiesOf } from "./account-meta";

/**
 * GCP 抵用點數（PROMOTION credits）記進管理帳。
 *
 * 帳本上的卡費（book both）只有實付的淨額；被點數抵掉的那部分成本看不到，點數用完那天才會
 * 突然冒出一大筆。所以每個已結束月份、抵用不為 0 時，在帳本建兩筆 **book = internal** 的交易
 * （只進管理帳，稅務帳完全不受影響）：
 *
 *   - 支出：|抵用|，對象 = 計費帳號的 party，「GCP 2026-10 用量（點數抵用部分）」
 *   - 收入：同額，分類「抵用點數」，「GCP 2026-10 抵用點數」
 *
 * 管理帳的雲端成本 = 實付（卡費）+ 抵用部分 = 全額；收入另記一筆抵用點數，淨額不變。
 * 兩筆都不是現金，所以不掛帳戶（from / to account 留空）。
 *
 * 冪等：external_source = 'gcp'、external_ref = `<帳號>:<YYYYMM>:promo-usage` / `:promo-credit`，
 * 寫入走 migrations/0026 的唯一索引 ON CONFLICT DO NOTHING。建過又被人刪掉的（deleted_at 有值）
 * 一樣算「建過」，不會長回來。帳號設定 meta.bookPromotionCredits = false 時停止新建，既有的不動。
 */

type Db = ReturnType<typeof getDb>;

export const PROMOTION_INCOME_CATEGORY = "抵用點數";
export const PROMO_REF_SUFFIX = { usage: "promo-usage", credit: "promo-credit" } as const;
export const PROMO_EXTERNAL_SOURCE = "gcp";

/** 對帳候選要排除這兩種交易（它們不是卡費，金額也不該拿去跟帳單比）。 */
export const PROMO_REF_LIKE = "%:promo-%";

/** 「雲端服務類」支出分類的名字特徵；組織沒有就留空，不自己建。 */
const CLOUD_CATEGORY_RE = /雲端|雲服務|cloud|伺服器|主機|hosting|server/i;

export type PromotionTxnPlan = {
  externalRef: string;
  type: "expense" | "income";
  txnDate: string;
  amount: string;
  currency: string;
  description: string;
  month: string;
};

const yyyymmOf = (month: string) => month.slice(0, 4) + month.slice(5, 7);

/** 每個月份 → 兩筆交易的計畫（純函式）。 */
export function planPromotionTransactions(months: readonly GcpPromotionMonth[]): PromotionTxnPlan[] {
  return months.flatMap((m) => {
    const label = m.month.slice(0, 7);
    const base = `${m.billingAccountId}:${yyyymmOf(m.month)}`;
    const common = { txnDate: m.periodEnd, amount: m.amount.toFixed(2), currency: m.currency, month: m.month };
    return [
      { ...common, externalRef: `${base}:${PROMO_REF_SUFFIX.usage}`, type: "expense" as const, description: `GCP ${label} 用量（點數抵用部分）` },
      { ...common, externalRef: `${base}:${PROMO_REF_SUFFIX.credit}`, type: "income" as const, description: `GCP ${label} 抵用點數` },
    ];
  });
}

/** 已經存在（含已刪除）的 external_ref 不再建 —— 刪掉的不長回來。 */
export function pendingPromotionTransactions(plan: readonly PromotionTxnPlan[], existingRefs: ReadonlySet<string>): PromotionTxnPlan[] {
  return plan.filter((p) => !existingRefs.has(p.externalRef));
}

/** 從組織的支出分類挑一個雲端服務類的；沒有回 null。 */
export function pickCloudCategory(rows: readonly { id: number; name: string; kind: string }[]): number | null {
  return rows.find((c) => (c.kind === "expense" || c.kind === "cogs") && CLOUD_CATEGORY_RE.test(c.name))?.id ?? null;
}

/**
 * 支出分類，依序：這個帳號已對到的卡費交易的分類 → 同一個交易對象最近一筆有分類的支出
 * （例如 Google Cloud 的卡費）→ 名字像雲端服務的分類 → 留空。
 */
async function expenseCategoryFor(
  db: Db,
  orgId: string,
  billingAccountRowId: number,
  partyId: number | null,
): Promise<number | null> {
  const [matched] = await db
    .select({ categoryId: transactions.categoryId })
    .from(vendorInvoices)
    .innerJoin(transactions, eq(transactions.id, vendorInvoices.matchedTransactionId))
    .where(
      and(
        eq(vendorInvoices.organizationId, orgId),
        eq(vendorInvoices.billingAccountId, billingAccountRowId),
        eq(transactions.organizationId, orgId),
        isNull(transactions.deletedAt),
        isNotNull(transactions.categoryId),
      ),
    )
    .orderBy(desc(vendorInvoices.invoiceDate))
    .limit(1);
  if (matched?.categoryId) return matched.categoryId;
  if (partyId !== null) {
    const [recent] = await db
      .select({ categoryId: transactions.categoryId })
      .from(transactions)
      .where(
        and(
          eq(transactions.organizationId, orgId),
          eq(transactions.partyId, partyId),
          eq(transactions.type, "expense"),
          isNull(transactions.deletedAt),
          isNotNull(transactions.categoryId),
        ),
      )
      .orderBy(desc(transactions.txnDate))
      .limit(1);
    if (recent?.categoryId) return recent.categoryId;
  }
  const rows = await db
    .select({ id: categories.id, name: categories.name, kind: categories.kind })
    .from(categories)
    .where(and(eq(categories.organizationId, orgId), isNull(categories.deletedAt), eq(categories.isActive, true)));
  return pickCloudCategory(rows);
}

/** 收入分類「抵用點數」：沒有就建這一個。 */
async function promotionIncomeCategory(db: Db, orgId: string): Promise<number> {
  const [found] = await db
    .select({ id: categories.id })
    .from(categories)
    .where(
      and(
        eq(categories.organizationId, orgId),
        eq(categories.kind, "income"),
        eq(categories.name, PROMOTION_INCOME_CATEGORY),
        isNull(categories.deletedAt),
      ),
    )
    .limit(1);
  if (found) return found.id;
  const [row] = await db
    .insert(categories)
    .values({ organizationId: orgId, name: PROMOTION_INCOME_CATEGORY, kind: "income" })
    .returning({ id: categories.id });
  return row.id;
}

async function existingRefs(db: Db, orgId: string, refs: string[]): Promise<Set<string>> {
  if (refs.length === 0) return new Set();
  const rows = await db
    .select({ ref: transactions.externalRef })
    .from(transactions)
    .where(
      and(
        eq(transactions.organizationId, orgId),
        eq(transactions.externalSource, PROMO_EXTERNAL_SOURCE),
        inArray(transactions.externalRef, refs),
      ),
    );
  return new Set(rows.map((r) => r.ref).filter((r): r is string => r !== null));
}

/**
 * 一個 GCP 計費帳號：把已結束月份的抵用點數記進管理帳。回傳這次新建了幾筆交易。
 * 帳號關掉了這個設定、或沒有要記的月份 → 0，什麼都不寫（也不建分類）。
 */
export async function bookPromotionCredits(
  db: Db,
  orgId: string,
  billingAccountRowId: number,
  months: readonly GcpPromotionMonth[],
): Promise<number> {
  if (months.length === 0) return 0;
  const [account] = await db
    .select({
      provider: vendorBillingAccounts.provider,
      displayName: vendorBillingAccounts.displayName,
      partyId: vendorBillingAccounts.partyId,
      meta: vendorBillingAccounts.meta,
    })
    .from(vendorBillingAccounts)
    .where(and(eq(vendorBillingAccounts.id, billingAccountRowId), eq(vendorBillingAccounts.organizationId, orgId)))
    .limit(1);
  if (!account || !booksPromotionCredits(account.provider, account.meta)) return 0;

  const plan = planPromotionTransactions(months);
  const todo = pendingPromotionTransactions(plan, await existingRefs(db, orgId, plan.map((p) => p.externalRef)));
  if (todo.length === 0) return 0;

  const partyId = matchPartiesOf(account)[0] ?? null;
  const expenseCategoryId = await expenseCategoryFor(db, orgId, billingAccountRowId, partyId);
  const incomeCategoryId = todo.some((p) => p.type === "income") ? await promotionIncomeCategory(db, orgId) : null;

  const inserted = await db
    .insert(transactions)
    .values(
      todo.map((p) => {
        const categoryId = p.type === "expense" ? expenseCategoryId : incomeCategoryId;
        return {
          organizationId: orgId,
          type: p.type,
          txnDate: p.txnDate,
          description: p.description,
          categoryId,
          partyId,
          amount: p.amount,
          currency: p.currency,
          amountTwd: p.currency === "TWD" ? p.amount : null,
          fromAccountId: null,
          toAccountId: null,
          book: "internal",
          billedToCompanyTaxId: false,
          externalSource: PROMO_EXTERNAL_SOURCE,
          externalRef: p.externalRef,
          externalMeta: {
            kind: p.type === "expense" ? "promotion_usage" : "promotion_credit",
            billingAccountId: billingAccountRowId,
            billingAccount: account.displayName,
            month: p.month,
            source: "gcp_bigquery",
          },
          // 分類有了就不用人看；支出找不到雲端分類時留給人確認
          needsReview: categoryId === null,
        };
      }),
    )
    .onConflictDoNothing()
    .returning({ id: transactions.id });
  return inserted.length;
}

/** SQL 條件：不是抵用點數那兩種交易（對帳候選用）。 */
export const notPromotionTransaction = sql`(${transactions.externalRef} IS NULL OR ${transactions.externalSource} IS DISTINCT FROM ${PROMO_EXTERNAL_SOURCE} OR ${transactions.externalRef} NOT LIKE ${PROMO_REF_LIKE})`;

import { and, eq, inArray, isNull, type SQL } from "drizzle-orm";
import type { Db } from "@/db";
import { billingItems, transactions } from "@/db/schema";
import { statusHints, type StatusHint } from "./hints";
import type { PendingParty } from "./party";
import {
  resolveLinks,
  resolveLinksMany,
  type LinkContext,
  type LinkDraft,
  type LinkedRef,
  type LinkResolution,
  type Unlinked,
} from "./resolve";

/**
 * **唯一**能 insert / update `transactions` 的地方（src/lib/linking/guard.test.ts 靜態掃描整個
 * src，別處出現 `.insert(transactions)` / `.update(transactions)` 就會失敗）。
 *
 * - insertTransactions：建立交易一律走這支，先過連結層（resolveLinksMany）再寫入。
 * - updateTransactionLinked：改到對象、金額、日期或任何連結欄位的更新走這支，會重新推導。
 * - updateTransactionsPlain：只改跟連結無關的欄位（軟刪除、發票、分類、待確認旗標）。
 *   型別上就拿不到連結欄位，想偷改專案 / 合約會編譯不過。
 */

export type TxnInsert = typeof transactions.$inferInsert;
export type TxnRow = typeof transactions.$inferSelect;
export type LinkedInsert = TxnInsert & { pendingParty?: PendingParty | null };

export type LinkReport = {
  /** 這筆交易掛上了什麼（given = 呼叫端給的；inherited = 繼承；matched = 連結層比對到的） */
  links: LinkedRef[];
  /** 沒掛上的部分：原因 + 候選。null = 不用人看 */
  unlinked: Unlinked | null;
  /** 相關合約已收齊、專案可結案之類的提示 */
  hints: StatusHint[];
};

/** 連結層負責的欄位：呼叫端可以給（= given），但最後寫進去的值以連結層算出來的為準。 */
const LINK_KEYS = [
  "projectId",
  "contractId",
  "subscriptionId",
  "subscriptionPeriod",
  "billingItemId",
  "vendorBillingAccountId",
  "reviewReason",
  "linkCandidates",
] as const;

/** 會影響推導結果的欄位：更新時改到這些就重新推導。 */
const DRIVER_KEYS = ["partyId", "amount", "currency", "type", "txnDate", "relatedToId"] as const;

type LinkKey = (typeof LINK_KEYS)[number];
type DriverKey = (typeof DRIVER_KEYS)[number];
export type PlainPatch = Omit<Partial<TxnInsert>, LinkKey | DriverKey | "id" | "organizationId">;

function draftOf(r: Partial<TxnInsert> & { pendingParty?: PendingParty | null }): LinkDraft {
  return {
    type: r.type ?? "expense",
    txnDate: r.txnDate ?? "",
    amount: r.amount ?? "0",
    currency: r.currency ?? "TWD",
    partyId: r.partyId ?? null,
    projectId: r.projectId ?? null,
    contractId: r.contractId ?? null,
    subscriptionId: r.subscriptionId ?? null,
    subscriptionPeriod: r.subscriptionPeriod ?? null,
    billingItemId: r.billingItemId ?? null,
    vendorBillingAccountId: r.vendorBillingAccountId ?? null,
    relatedToId: r.relatedToId ?? null,
    reviewReason: r.reviewReason ?? null,
    pendingParty: r.pendingParty ?? null,
  };
}

/** 請款項被掛上收款時，paid_on 還空著就填上收款日（跟請款看板「登記收款」同一個行為）。 */
async function markBillingItemsPaid(db: Db, orgId: string, rows: readonly TxnRow[]) {
  const byItem = new Map<number, string>();
  for (const r of rows) {
    if (r.type !== "income" || r.billingItemId == null) continue;
    const prev = byItem.get(r.billingItemId);
    if (!prev || r.txnDate < prev) byItem.set(r.billingItemId, r.txnDate);
  }
  for (const [id, date] of byItem) {
    await db
      .update(billingItems)
      .set({ paidOn: date })
      .where(and(eq(billingItems.organizationId, orgId), eq(billingItems.id, id), isNull(billingItems.paidOn)));
  }
}

async function hintsFor(db: Db, orgId: string, rows: readonly Pick<TxnRow, "contractId" | "projectId">[]) {
  return statusHints(
    db,
    orgId,
    rows.map((r) => r.contractId),
    rows.map((r) => r.projectId),
  );
}

function hintsOfRow(all: StatusHint[], row: Pick<TxnRow, "contractId" | "projectId">): StatusHint[] {
  return all.filter((h) =>
    h.kind === "contract_fully_collected" ? h.contractId === row.contractId : h.projectId === row.projectId,
  );
}

function withValues(r: LinkedInsert, res: LinkResolution): TxnInsert {
  const { pendingParty: _pending, ...rest } = r;
  return { ...rest, ...res.values };
}

export type InsertResult = { row: TxnRow; report: LinkReport };

/**
 * 建立交易（一筆或一批）。回傳每筆實際寫進去的列與它的連結報告。
 * onConflictDoNothing：同步用（外部 ref 去重），被擋下的列不會出現在結果裡。
 */
export async function insertTransactions(
  ctx: LinkContext,
  rows: readonly LinkedInsert[],
  opts: { onConflictDoNothing?: boolean; chunkSize?: number } = {},
): Promise<InsertResult[]> {
  if (rows.length === 0) return [];
  for (const r of rows) {
    if (r.organizationId !== ctx.orgId) throw new Error("insertTransactions: organizationId mismatch");
  }
  const resolutions = await resolveLinksMany(rows.map(draftOf), ctx);
  const values = rows.map((r, i) => withValues(r, resolutions[i]));
  const chunk = opts.chunkSize ?? 200;
  const inserted: TxnRow[] = [];
  const reportByKey = new Map<string, LinkResolution>();
  values.forEach((v, i) => {
    if (v.externalRef) reportByKey.set(`${v.externalSource}:${v.externalRef}`, resolutions[i]);
  });
  const indexOf: number[] = [];
  for (let i = 0; i < values.length; i += chunk) {
    const part = values.slice(i, i + chunk);
    const q = ctx.db.insert(transactions).values(part);
    const got = opts.onConflictDoNothing ? await q.onConflictDoNothing().returning() : await q.returning();
    if (!opts.onConflictDoNothing) got.forEach((_, j) => indexOf.push(i + j));
    inserted.push(...got);
  }
  await markBillingItemsPaid(ctx.db, ctx.orgId, inserted);
  const hints = await hintsFor(ctx.db, ctx.orgId, inserted);
  return inserted.map((row, k) => {
    const res = opts.onConflictDoNothing
      ? reportByKey.get(`${row.externalSource}:${row.externalRef}`)
      : resolutions[indexOf[k]];
    return {
      row,
      report: { links: res?.links ?? [], unlinked: res?.unlinked ?? null, hints: hintsOfRow(hints, row) },
    };
  });
}

/** 單筆建立。 */
export async function insertTransaction(ctx: LinkContext, row: LinkedInsert): Promise<InsertResult> {
  const [r] = await insertTransactions(ctx, [row]);
  return r;
}

const PARENT_KEYS = ["billingItemId", "subscriptionId", "contractId"] as const;

function changed<T extends object>(patch: Partial<T>, existing: T, key: keyof T): boolean {
  return key in patch && patch[key] !== undefined && (patch[key] ?? null) !== (existing[key] ?? null);
}

/**
 * 更新一筆交易並重新推導連結。patch 裡給了的連結欄位 = given（人選的優先）。
 *
 * - 換了請款項 / 訂閱 / 合約、但沒指定專案：原本的專案如果是從舊的上層繼承來的，就清掉重新繼承
 *   （人手動填、跟舊上層不同的專案會保留）。合約同理（從請款項 / 訂閱繼承來的才清）。
 * - 對象、金額、幣別、日期、類型有變，或呼叫端要求（ctx.autoMatch === true），才重新比對候選；
 *   否則原本的待連結狀態保留。
 * - 明確給了任何連結 → 待連結狀態清掉。
 *
 * 找不到（不是本組織的）回傳 null。
 */
export async function updateTransactionLinked(
  ctx: LinkContext,
  id: number,
  patch: Partial<TxnInsert> & { pendingParty?: PendingParty | null },
): Promise<InsertResult | null> {
  const { db, orgId } = ctx;
  const [existing] = await db
    .select()
    .from(transactions)
    .where(and(eq(transactions.organizationId, orgId), eq(transactions.id, id)))
    .limit(1);
  if (!existing) return null;

  const merged: Partial<TxnInsert> & { pendingParty?: PendingParty | null } = { ...existing, ...patch };
  const parentChanged = PARENT_KEYS.some((k) => changed(patch, existing, k));
  if (parentChanged) {
    const old = await resolveLinks(
      {
        ...draftOf(existing),
        projectId: null,
        contractId: existing.billingItemId || existing.subscriptionId ? null : existing.contractId,
      },
      { ...ctx, autoMatch: false },
    );
    if (!("projectId" in patch) && existing.projectId != null && existing.projectId === old.values.projectId) {
      merged.projectId = null;
    }
    if (
      !("contractId" in patch) &&
      existing.contractId != null &&
      (existing.billingItemId || existing.subscriptionId) &&
      existing.contractId === old.values.contractId
    ) {
      merged.contractId = null;
    }
  }

  const explicitLink = PARENT_KEYS.some((k) => patch[k] != null);
  const driverChanged = DRIVER_KEYS.some((k) => changed(patch, existing, k));
  const rematch = ctx.autoMatch === true || driverChanged;
  if (explicitLink && !("reviewReason" in patch)) merged.reviewReason = null;

  const res = await resolveLinks(draftOf(merged), {
    ...ctx,
    autoMatch: rematch,
    excludeTransactionIds: [id, ...(ctx.excludeTransactionIds ?? [])],
  });
  const values = { ...res.values };
  if (!rematch && !explicitLink && !("reviewReason" in patch) && !patch.pendingParty) {
    // 沒重新比對：原本的待連結狀態原封不動
    values.reviewReason = existing.reviewReason as typeof values.reviewReason;
    values.linkCandidates = existing.linkCandidates ?? null;
  }
  // 略過（待連結頁「不連」）：明確記成 link_skipped，之後不再自動比對。
  // patch.reviewReason = null 則代表「舊的狀態作廢」：重新比對有新結果就用新的，沒有就是 null。
  if (patch.reviewReason === "link_skipped" && !explicitLink) {
    values.reviewReason = "link_skipped";
    values.linkCandidates = null;
  }

  const { pendingParty: _pending, ...plain } = patch;
  const [row] = await db
    .update(transactions)
    .set({ ...plain, ...values, updatedAt: new Date().toISOString() })
    .where(and(eq(transactions.organizationId, orgId), eq(transactions.id, id)))
    .returning();
  if (row.billingItemId !== existing.billingItemId) await markBillingItemsPaid(db, orgId, [row]);
  const hints = await hintsFor(db, orgId, [row, existing]);
  return { row, report: { links: res.links, unlinked: res.unlinked, hints } };
}

/**
 * 只改跟連結無關的欄位（軟刪除、發票、分類、needsReview、描述…）。where 一定會被加上組織條件。
 */
export async function updateTransactionsPlain(
  db: Db,
  orgId: string,
  where: SQL | undefined,
  set: PlainPatch,
): Promise<{ id: number }[]> {
  return db
    .update(transactions)
    .set(set)
    .where(and(eq(transactions.organizationId, orgId), where))
    .returning({ id: transactions.id });
}

/** updateTransactionsPlain 的常用形：依 id。 */
export async function updateTransactionsPlainByIds(
  db: Db,
  orgId: string,
  idList: readonly number[],
  set: PlainPatch,
): Promise<{ id: number }[]> {
  if (idList.length === 0) return [];
  return updateTransactionsPlain(db, orgId, inArray(transactions.id, [...idList]), set);
}

export type ReviewFlag = {
  id: number;
  reviewReason: NonNullable<LinkResolution["values"]["reviewReason"]>;
  linkCandidates: Record<string, unknown> | null;
};

/**
 * 重新掃描用：只把「還沒人看過」（review_reason IS NULL）的交易標成待連結，只寫 review_reason 與
 * link_candidates 兩欄（+ updatedAt），其他欄位一律不動。已經在待連結或略過的列不覆蓋。
 * 回傳實際被標記的 id。
 */
export async function flagTransactionsForReview(
  db: Db,
  orgId: string,
  items: readonly ReviewFlag[],
): Promise<number[]> {
  const out: number[] = [];
  const now = new Date().toISOString();
  for (const it of items) {
    const got = await db
      .update(transactions)
      .set({ reviewReason: it.reviewReason, linkCandidates: it.linkCandidates, updatedAt: now })
      .where(
        and(
          eq(transactions.organizationId, orgId),
          eq(transactions.id, it.id),
          isNull(transactions.reviewReason),
          isNull(transactions.deletedAt),
        ),
      )
      .returning({ id: transactions.id });
    if (got[0]) out.push(got[0].id);
  }
  return out;
}

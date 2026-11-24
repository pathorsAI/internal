import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import type { Db } from "@/db";
import { parties, transactions } from "@/db/schema";
import { resolveLinksMany, type LinkDraft, type LinkedRef, type LinkSource, type Unlinked } from "./resolve";
import { flagTransactionsForReview, type ReviewFlag } from "./write";

/**
 * 重新掃描既有收入：連結層上線前就存在的收入（有客戶、卻沒掛任何請款項 / 訂閱 / 合約、也還沒人看過）
 * 再跑一次比對。歷史資料一律 suggestOnly —— 只標成待連結讓人確認，不自動掛。
 *
 * - dryRun：只回傳會被標記的列，什麼都不寫。
 * - transactionId：只看這一筆（不管它現在是什麼狀態，也不管有沒有掛上東西），一律 dry run。
 *   給「拿這筆 HNT 的收款跑一次連結層，看會得到什麼」用。
 */
export type RescanOptions = {
  partyId?: number;
  transactionId?: number;
  limit?: number;
  dryRun?: boolean;
  source?: LinkSource;
};

export type RescanItem = {
  id: number;
  txnDate: string;
  amount: string;
  currency: string;
  partyId: number | null;
  partyName: string | null;
  /** 這筆目前（或比對後）掛著的東西；整批掃描時只會有繼承 / 廠商帳戶這類 */
  links: LinkedRef[];
  unlinked: Unlinked | null;
};

export type RescanResult = {
  scanned: number;
  /** 有候選、會（dryRun）或已經被標成待連結的筆數 */
  flagged: number;
  dryRun: boolean;
  results: RescanItem[];
};

const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 2000;

export async function rescanUnlinkedIncome(db: Db, orgId: string, opts: RescanOptions = {}): Promise<RescanResult> {
  const single = opts.transactionId != null;
  const dryRun = single || opts.dryRun !== false;
  const limit = Math.min(Math.max(Math.trunc(opts.limit ?? DEFAULT_LIMIT), 1), MAX_LIMIT);

  const where = single
    ? and(eq(transactions.organizationId, orgId), eq(transactions.id, opts.transactionId!), isNull(transactions.deletedAt))
    : and(
        eq(transactions.organizationId, orgId),
        eq(transactions.type, "income"),
        isNull(transactions.deletedAt),
        isNotNull(transactions.partyId),
        isNull(transactions.billingItemId),
        isNull(transactions.subscriptionId),
        isNull(transactions.contractId),
        isNull(transactions.reviewReason),
        opts.partyId ? eq(transactions.partyId, opts.partyId) : undefined,
      );

  const rows = await db
    .select({
      id: transactions.id,
      type: transactions.type,
      txnDate: transactions.txnDate,
      amount: transactions.amount,
      currency: transactions.currency,
      partyId: transactions.partyId,
      partyName: parties.name,
      projectId: transactions.projectId,
      contractId: transactions.contractId,
      subscriptionId: transactions.subscriptionId,
      subscriptionPeriod: transactions.subscriptionPeriod,
      billingItemId: transactions.billingItemId,
      vendorBillingAccountId: transactions.vendorBillingAccountId,
      relatedToId: transactions.relatedToId,
    })
    .from(transactions)
    .leftJoin(parties, eq(parties.id, transactions.partyId))
    .where(where)
    .orderBy(desc(transactions.txnDate), desc(transactions.id))
    .limit(single ? 1 : limit);

  if (rows.length === 0) return { scanned: 0, flagged: 0, dryRun, results: [] };

  // 不帶既有的待連結狀態（略過過的也重新比對一次給人看）。單筆預覽時連目前掛著的請款項 / 訂閱 /
  // 合約 / 專案也拿掉，看的是「連結層自己會怎麼判斷」；這筆自己的金額不算進候選的已收。
  const drafts: LinkDraft[] = rows.map((r) => ({
    ...r,
    ...(single ? { billingItemId: null, subscriptionId: null, subscriptionPeriod: null, contractId: null, projectId: null } : {}),
    reviewReason: null,
    pendingParty: null,
  }));
  const resolutions = await resolveLinksMany(drafts, {
    db,
    orgId,
    source: opts.source ?? "rescan",
    suggestOnly: true,
    excludeTransactionIds: single ? rows.map((r) => r.id) : undefined,
  });

  const items: RescanItem[] = rows.map((r, i) => ({
    id: r.id,
    txnDate: r.txnDate,
    amount: r.amount,
    currency: r.currency,
    partyId: r.partyId,
    partyName: r.partyName,
    links: resolutions[i].links,
    unlinked: resolutions[i].unlinked,
  }));
  const flags: ReviewFlag[] = [];
  rows.forEach((r, i) => {
    const v = resolutions[i].values;
    if (resolutions[i].unlinked && v.reviewReason) {
      flags.push({ id: r.id, reviewReason: v.reviewReason, linkCandidates: v.linkCandidates });
    }
  });

  if (dryRun) {
    return {
      scanned: rows.length,
      flagged: flags.length,
      dryRun,
      results: single ? items : items.filter((it) => it.unlinked),
    };
  }
  const written = new Set(await flagTransactionsForReview(db, orgId, flags));
  return {
    scanned: rows.length,
    flagged: written.size,
    dryRun,
    results: items.filter((it) => written.has(it.id)),
  };
}

// 合併交易對象：把幾個「其實是同一家」的交易對象併進一個目標。
//
//   - 所有指向來源的外鍵改指目標（交易、專案、訂閱、合約、請款項目、發票、雲端帳單帳號、固定支出），
//     雲端帳單帳號 meta.matchPartyIds 裡的來源 id 也換成目標
//   - 來源的名稱與別名併進目標的 aliases（之後同名的匯入直接對到目標）
//   - 來源軟刪除；頭像不動（不搬 R2 物件）
//
// 全部在同一個 DB transaction 裡（src/lib/party-merge-deps.ts），每個查詢都帶 organization_id。
// 這支只做驗證與編排，DB 由 deps 注入，方便測試。

import { mergedAliases } from "./party-aliases";
import { parseMatchPartyIds } from "./vendor-billing/account-meta";

export type MergeParty = {
  id: number;
  organizationId: string | null;
  name: string;
  aliases: string[];
};

/** 每張表改指目標的列數。 */
export type MergeCounts = {
  transactions: number;
  projects: number;
  subscriptions: number;
  contracts: number;
  billingItems: number;
  invoices: number;
  vendorBillingAccounts: number;
  /** 雲端帳單帳號 meta.matchPartyIds 有改到的帳號數。 */
  vendorBillingMatchParties: number;
  recurringExpenses: number;
};

export type MatchAccountUpdate = { id: number; matchPartyIds: number[] };

export type MergePlan = {
  orgId: string;
  targetId: number;
  sourceIds: number[];
  aliases: string[];
  matchAccountUpdates: MatchAccountUpdate[];
};

export type PartyMergeDeps = {
  /** 同組織、未刪除、id 在清單裡的交易對象。 */
  loadParties(orgId: string, ids: number[]): Promise<MergeParty[]>;
  /** 同組織的雲端帳單帳號（只要 id 與 meta）。 */
  loadMatchAccounts(orgId: string): Promise<{ id: number; meta: Record<string, unknown> | null }[]>;
  /** 在單一 transaction 裡執行合併；目標或任何來源已不存在 / 已刪除時整筆失敗。 */
  apply(plan: MergePlan): Promise<MergeCounts>;
};

export type MergeResult = {
  id: number;
  name: string;
  mergedIds: number[];
  mergedNames: string[];
  aliases: string[];
  moved: MergeCounts;
};

export class PartyMergeError extends Error {}

/**
 * 合併的守門語句（src/lib/party-merge-deps.ts）在目標或來源於驗證之後被刪掉時，會以
 * 「division by zero」中止整個 transaction。drizzle 會把原始錯誤包在 cause 裡。
 */
export function isMergeGuardFailure(e: unknown): boolean {
  for (let cur: unknown = e, depth = 0; cur instanceof Error && depth < 3; cur = cur.cause, depth++) {
    if (cur.message.includes("division by zero")) return true;
  }
  return false;
}

function uniqueIds(ids: readonly unknown[]): number[] {
  const out: number[] = [];
  for (const v of ids) {
    if (typeof v !== "number" || !Number.isSafeInteger(v) || v <= 0) {
      throw new PartyMergeError(`Invalid party id: ${String(v)}`);
    }
    if (!out.includes(v)) out.push(v);
  }
  return out;
}

/** matchPartyIds 裡的來源換成目標（去重）；沒變就回 null。 */
export function repointIds(ids: readonly number[], sourceIds: readonly number[], targetId: number): number[] | null {
  if (!ids.some((id) => sourceIds.includes(id))) return null;
  const out: number[] = [];
  for (const id of ids) {
    const next = sourceIds.includes(id) ? targetId : id;
    if (!out.includes(next)) out.push(next);
  }
  return out;
}

/** 驗證並算出要做的事；不碰 DB。 */
export function planPartyMerge(args: {
  orgId: string;
  targetId: number;
  sourceIds: readonly unknown[];
  parties: readonly MergeParty[];
  matchAccounts: readonly { id: number; meta: Record<string, unknown> | null }[];
}): { plan: MergePlan; target: MergeParty; sources: MergeParty[] } {
  const { orgId, targetId } = args;
  const [checkedTarget] = uniqueIds([targetId]);
  const sourceIds = uniqueIds(args.sourceIds);
  if (sourceIds.length === 0) throw new PartyMergeError("sourceIds must list at least one party to merge.");
  if (sourceIds.includes(checkedTarget)) {
    throw new PartyMergeError("The target party cannot also be a source.");
  }
  // 第二道防線：deps 的查詢已經帶 org 與未刪除條件，這裡再擋一次。
  const inOrg = args.parties.filter((p) => p.organizationId === orgId);
  const target = inOrg.find((p) => p.id === checkedTarget);
  if (!target) throw new PartyMergeError(`Party ${checkedTarget} not found in your organization.`);
  const sources: MergeParty[] = [];
  const missing: number[] = [];
  for (const id of sourceIds) {
    const row = inOrg.find((p) => p.id === id);
    if (row) sources.push(row);
    else missing.push(id);
  }
  if (missing.length) {
    throw new PartyMergeError(`Party ${missing.join(", ")} not found in your organization.`);
  }

  const matchAccountUpdates: MatchAccountUpdate[] = [];
  for (const a of args.matchAccounts) {
    const next = repointIds(parseMatchPartyIds(a.meta), sourceIds, checkedTarget);
    if (next) matchAccountUpdates.push({ id: a.id, matchPartyIds: next });
  }

  return {
    plan: {
      orgId,
      targetId: checkedTarget,
      sourceIds,
      aliases: mergedAliases(target, sources),
      matchAccountUpdates,
    },
    target,
    sources,
  };
}

export async function mergeParties(
  deps: PartyMergeDeps,
  orgId: string,
  targetId: number,
  sourceIds: readonly unknown[],
): Promise<MergeResult> {
  const ids = uniqueIds([targetId, ...sourceIds]);
  const [loaded, matchAccounts] = await Promise.all([
    deps.loadParties(orgId, ids),
    deps.loadMatchAccounts(orgId),
  ]);
  const { plan, target, sources } = planPartyMerge({ orgId, targetId, sourceIds, parties: loaded, matchAccounts });
  const moved = await deps.apply(plan);
  return {
    id: target.id,
    name: target.name,
    mergedIds: plan.sourceIds,
    mergedNames: sources.map((s) => s.name),
    aliases: plan.aliases,
    moved,
  };
}

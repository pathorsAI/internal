"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { getDb } from "@/db";
import { logWeb } from "@/db/activity";
import { requireOrg } from "@/lib/session";
import {
  PartyMergeError,
  isMergeGuardFailure,
  mergeParties,
  planPartyMerge,
  type MergeCounts,
} from "@/lib/party-merge";
import { partyMergeDeps, previewMergeCounts } from "@/lib/party-merge-deps";

/**
 * 交易對象頁的「合併」：先預覽（每張表會改指幾列、目標合併後的別名），確認後才真的合併。
 * 驗證與編排都在 src/lib/party-merge.ts（跟 MCP 的 merge_parties 同一條路）。
 */

export type MergePreviewState = {
  ok: boolean;
  error?: string;
  counts?: MergeCounts;
  aliases?: string[];
  targetName?: string;
  sourceNames?: string[];
};

export type MergeActionState = { ok: boolean; error?: string; name?: string; merged?: number };

export async function previewPartyMerge(targetId: number, sourceIds: number[]): Promise<MergePreviewState> {
  const t = await getTranslations("links");
  try {
    const { orgId } = await requireOrg();
    const db = getDb();
    const deps = partyMergeDeps(db);
    const ids = [targetId, ...sourceIds];
    const [loaded, matchAccounts] = await Promise.all([deps.loadParties(orgId, ids), deps.loadMatchAccounts(orgId)]);
    const { plan, target, sources } = planPartyMerge({ orgId, targetId, sourceIds, parties: loaded, matchAccounts });
    return {
      ok: true,
      counts: await previewMergeCounts(db, plan),
      aliases: plan.aliases,
      targetName: target.name,
      sourceNames: sources.map((s) => s.name),
    };
  } catch (e) {
    if (e instanceof PartyMergeError) return { ok: false, error: t("merge.pickBoth") };
    return { ok: false, error: e instanceof Error ? e.message : t("errors.failed") };
  }
}

export async function mergePartiesAction(targetId: number, sourceIds: number[]): Promise<MergeActionState> {
  const t = await getTranslations("links");
  try {
    const { orgId } = await requireOrg();
    const res = await mergeParties(partyMergeDeps(getDb()), orgId, targetId, sourceIds);
    await logWeb(orgId, "update", "party", res.id, `merge ${res.mergedNames.join(", ")} → ${res.name}`);
    for (const p of [
      "/dashboard/parties",
      "/dashboard/transactions",
      "/dashboard/links",
      "/dashboard/contracts",
      "/dashboard/projects",
      "/dashboard/subscriptions",
      "/dashboard/billing",
      "/dashboard/invoices",
      "/dashboard/vendor-billing",
    ]) {
      revalidatePath(p);
    }
    return { ok: true, name: res.name, merged: res.mergedIds.length };
  } catch (e) {
    if (isMergeGuardFailure(e)) return { ok: false, error: t("merge.changed") };
    if (e instanceof PartyMergeError) return { ok: false, error: t("merge.pickBoth") };
    return { ok: false, error: e instanceof Error ? e.message : t("errors.failed") };
  }
}

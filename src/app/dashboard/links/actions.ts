"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { getDb } from "@/db";
import { logWeb } from "@/db/activity";
import { requireOrg } from "@/lib/session";
import {
  LinkChoiceError,
  resolvePendingLink,
  rescanUnlinkedIncome,
  type LinkChoice,
  type LinkKind,
} from "@/lib/linking";

/**
 * 待連結頁的 server actions。寫入一律走連結層（resolvePendingLink → updateTransactionLinked）；
 * 候選 id 由連結層再驗一次：不在這筆的候選清單裡的，要確認是本組織的才接受。
 */

export type LinkActionState = {
  ok: boolean;
  error?: string;
  /** 選對象之後收款還是沒對上（又進了待連結） */
  stillPending?: boolean;
  aliasAdded?: string | null;
  /** 這次掛上之後，相關合約已收齊的提示（合約標題） */
  contractsReady?: string[];
};

const KINDS: ReadonlySet<string> = new Set<LinkKind>(["billing_item", "subscription", "contract"]);

function revalidateAll() {
  // layout 也要重算：側欄的待連結筆數
  revalidatePath("/dashboard", "layout");
  revalidatePath("/dashboard/links");
  revalidatePath("/dashboard/transactions");
  revalidatePath("/dashboard/billing");
  revalidatePath("/dashboard/contracts");
  revalidatePath("/dashboard/subscriptions");
}

async function run(id: number, choice: LinkChoice, summary: string): Promise<LinkActionState> {
  const t = await getTranslations("links");
  if (!Number.isSafeInteger(id) || id <= 0) return { ok: false, error: t("errors.not_found") };
  try {
    const { orgId } = await requireOrg();
    const res = await resolvePendingLink(getDb(), orgId, id, choice, "pending_links");
    await logWeb(orgId, "update", "transaction", id, summary);
    if (choice.kind === "party" || choice.kind === "new_party") revalidatePath("/dashboard/parties");
    revalidateAll();
    return {
      ok: true,
      stillPending: res.report.unlinked != null,
      aliasAdded: res.aliasAdded,
      contractsReady: res.report.hints.flatMap((h) => (h.kind === "contract_fully_collected" ? [h.title] : [])),
    };
  } catch (e) {
    if (e instanceof LinkChoiceError) return { ok: false, error: t(`errors.${e.code}`) };
    return { ok: false, error: e instanceof Error ? e.message : t("errors.failed") };
  }
}

/** 掛上一個候選（請款項 / 訂閱期別 / 合約）。 */
export async function attachLinkCandidate(
  id: number,
  kind: string,
  candidateId: number,
  subscriptionPeriod: string | null,
): Promise<LinkActionState> {
  const t = await getTranslations("links");
  if (!KINDS.has(kind) || !Number.isSafeInteger(candidateId) || candidateId <= 0) {
    return { ok: false, error: t("errors.candidate_not_found") };
  }
  const periodSuffix = subscriptionPeriod ? ` ${subscriptionPeriod}` : "";
  return run(
    id,
    { kind: "candidate", candidateKind: kind as LinkKind, id: candidateId, subscriptionPeriod },
    `link ${kind} #${candidateId}${periodSuffix}`,
  );
}

/** 略過：不連，之後不再自動比對。 */
export async function skipPendingLink(id: number): Promise<LinkActionState> {
  return run(id, { kind: "skip" }, "link skipped");
}

/** 對象相似：選既有對象（原始名稱加成那個對象的別名），然後重新比對連結。 */
export async function choosePartyForLink(id: number, partyId: number): Promise<LinkActionState> {
  const t = await getTranslations("links");
  if (!Number.isSafeInteger(partyId) || partyId <= 0) return { ok: false, error: t("errors.party_not_found") };
  return run(id, { kind: "party", partyId, addAlias: true }, `party #${partyId}`);
}

/** 對象相似：確認是新的對象，用原始名稱建立。 */
export async function createPartyForLink(id: number): Promise<LinkActionState> {
  return run(id, { kind: "new_party" }, "party created");
}

export type RescanActionState = { ok: boolean; error?: string; scanned?: number; flagged?: number };

/** 重新掃描既有收入：只標待連結，不自動掛。 */
export async function rescanExistingIncome(): Promise<RescanActionState> {
  const t = await getTranslations("links");
  try {
    const { orgId } = await requireOrg();
    const res = await rescanUnlinkedIncome(getDb(), orgId, { dryRun: false, source: "rescan" });
    if (res.flagged > 0) {
      await logWeb(orgId, "update", "transaction", null, `rescan: ${res.flagged}/${res.scanned} flagged`);
      revalidateAll();
    }
    return { ok: true, scanned: res.scanned, flagged: res.flagged };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : t("errors.failed") };
  }
}

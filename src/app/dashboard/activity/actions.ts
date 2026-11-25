"use server";

import { revalidatePath } from "next/cache";
import { getLocale, getTranslations } from "next-intl/server";
import { activitySnapshot, activityUndoLinks } from "@/db/undo";
import { requireOrgWithRole } from "@/lib/session";
import { executeUndo, planUndo, type UndoPlan } from "@/lib/undo";
import { diffSnapshots, type UndoKind, type UndoLocale } from "@/lib/undo-rules";

/**
 * 操作紀錄頁的 server actions。
 * - 看細節：任何成員（只看得到自己組織的紀錄；快照裡的敏感欄位寫入時就遮罩了）。
 * - 復原：操作人本人或 owner／admin —— 權限在 src/lib/undo-rules.ts 的 mayUndo 再判斷一次，
 *   不信任畫面上有沒有顯示按鈕。
 */

export type ActivityDiffRow = { key: string; label: string; before: unknown; after: unknown };

export type ActivityDetail = {
  id: number;
  summary: string | null;
  diff: ActivityDiffRow[];
  plan: { ok: true; kind: UndoKind } | { ok: false; reason: string };
  undoOf: number | null;
  undoneBy: number | null;
};

async function locale(): Promise<UndoLocale> {
  return (await getLocale()) === "en" ? "en" : "zh-TW";
}

function planView(plan: UndoPlan): ActivityDetail["plan"] {
  return plan.ok ? { ok: true, kind: plan.kind } : { ok: false, reason: plan.reason };
}

export async function activityDetailAction(id: number): Promise<ActivityDetail | null> {
  if (!Number.isInteger(id)) return null;
  const { orgId, userId, role } = await requireOrgWithRole();
  let snap: Awaited<ReturnType<typeof activitySnapshot>> = null;
  try {
    snap = await activitySnapshot(orgId, id);
  } catch {
    snap = null; // migration 0045 還沒跑
  }
  const t = await getTranslations("activity.undo.fields");
  const label = (key: string) => (t.has(key as never) ? t(key as never) : key);
  const [plan, links] = await Promise.all([
    planUndo(orgId, id, { userId, role }, await locale()),
    activityUndoLinks(orgId, [id]),
  ]);
  const link = links.get(id);
  return {
    id,
    summary: snap?.summary ?? null,
    diff: diffSnapshots(snap?.before ?? null, snap?.after ?? null).map((d) => ({ ...d, label: label(d.key) })),
    plan: planView(plan),
    undoOf: link?.undoOf ?? null,
    undoneBy: link?.undoneBy ?? null,
  };
}

export type UndoActionState = { ok: true; activityId: number | null } | { ok: false; error: string };

/** 網頁的「復原」（操作紀錄頁、站內 AI 確認卡共用）。 */
export async function undoActivityAction(id: number): Promise<UndoActionState> {
  if (!Number.isInteger(id)) return { ok: false, error: "invalid id" };
  const { orgId, userId, role } = await requireOrgWithRole();
  const res = await executeUndo({ orgId, activityId: id, caller: { userId, role }, channel: "web", locale: await locale() });
  if (!res.ok) return { ok: false, error: res.reason };
  revalidatePath("/dashboard", "layout");
  return { ok: true, activityId: res.activityId };
}

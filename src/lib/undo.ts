import { applyUndo, loadUndoFacts } from "@/db/undo";
import { logToolActivity, logWeb, type ToolCallChannel } from "@/db/activity";
import { formatDateTime } from "@/lib/format";
import {
  decideUndo,
  UNDO_ACTION,
  undoErrorRefusal,
  undoReasonText,
  undoSummary,
  type UndoDecision,
  type UndoKind,
  type UndoLocale,
  type UndoReasonCode,
} from "./undo-rules";

/**
 * 復原（undo）：操作紀錄頁的「復原」按鈕、MCP 的 undo_activity、站內 AI 確認卡的「復原」
 * 都走這裡。規則見 src/lib/undo-rules.ts；資料存取見 src/db/undo.ts。
 *
 * 復原本身是一筆普通的資料變動：一樣會被 trigger 記下 entity_changes、一樣寫一筆操作紀錄
 * （undo_of = 原本那筆），所以可以再復原一次（＝重做）。
 */

export type UndoCaller = { userId: string; role: string | null };

export type UndoPlan =
  | { ok: true; kind: UndoKind; table: string; rowId: number; summary: string | null }
  | { ok: false; code: UndoReasonCode; reason: string };

type Decided = { plan: UndoPlan; decision: UndoDecision; entityType: string | null };

function toPlan(d: UndoDecision, summary: string | null, locale: UndoLocale): UndoPlan {
  if (d.ok) return { ok: true, kind: d.kind, table: d.table, rowId: d.rowId, summary };
  const params = { ...d.params };
  if (d.code === "conflict" && typeof params.when === "string" && params.when) {
    params.when = formatDateTime(params.when);
  }
  return { ok: false, code: d.code, reason: undoReasonText({ code: d.code, params }, locale) };
}

async function decideMany(
  orgId: string,
  ids: readonly number[],
  caller: UndoCaller,
  locale: UndoLocale,
): Promise<Map<number, Decided>> {
  const facts = await loadUndoFacts(orgId, ids, caller);
  const out = new Map<number, Decided>();
  for (const id of ids) {
    const f = facts.get(id);
    const decision: UndoDecision = f ? decideUndo(f) : { ok: false, code: "not_found" };
    out.set(id, {
      decision,
      plan: toPlan(decision, f?.activity.summary ?? null, locale),
      entityType: f?.activity.entityType ?? null,
    });
  }
  return out;
}

/** 一批操作紀錄各自能不能復原（操作紀錄頁、list_activity 用；查詢數量不隨筆數增加）。 */
export async function planUndoMany(
  orgId: string,
  ids: readonly number[],
  caller: UndoCaller,
  locale: UndoLocale = "zh-TW",
): Promise<Map<number, UndoPlan>> {
  try {
    const decided = await decideMany(orgId, ids, caller, locale);
    return new Map([...decided].map(([id, d]) => [id, d.plan]));
  } catch (err) {
    // migration 0045 還沒跑（欄位不存在）之類：列表照常顯示，只是全部不能復原。
    console.error("[undo] planUndoMany failed", err);
    const reason = undoReasonText({ code: "no_snapshot" }, locale);
    return new Map(ids.map((id) => [id, { ok: false as const, code: "no_snapshot" as const, reason }]));
  }
}

export async function planUndo(
  orgId: string,
  activityId: number,
  caller: UndoCaller,
  locale: UndoLocale = "zh-TW",
): Promise<UndoPlan> {
  const plans = await planUndoMany(orgId, [activityId], caller, locale);
  return plans.get(activityId) ?? { ok: false, code: "not_found", reason: undoReasonText({ code: "not_found" }, locale) };
}

/** 復原寫操作紀錄的入口：web = 網頁 server action；其他 = 工具呼叫（API key 帶金鑰名稱）。 */
export type UndoChannel = "web" | ToolCallChannel | { apiKeyName: string };

export type UndoResult =
  | {
      ok: true;
      /** 復原自己那筆操作紀錄的 id（再復原它＝重做）。 */
      activityId: number | null;
      undoneActivityId: number;
      entityType: string;
      kind: UndoKind;
      table: string;
      rowId: number;
      /** restore：改回去的欄位；其他種類是空陣列。 */
      restoredFields: string[];
      summary: string;
    }
  | { ok: false; code: UndoReasonCode; reason: string };

function failure(code: UndoReasonCode, locale: UndoLocale, params?: Record<string, string>): UndoResult {
  return { ok: false, code, reason: undoReasonText({ code, params }, locale) };
}

/**
 * 執行復原：重新判斷一次（資料可能在畫面打開之後又變了）、寫回、記操作紀錄。
 * 寫回那一句本身也會再擋一次衝突（restore 的 NOT EXISTS），兩個人同時按只有一個會成功。
 */
export async function executeUndo(opts: {
  orgId: string;
  activityId: number;
  caller: UndoCaller;
  channel: UndoChannel;
  locale?: UndoLocale;
}): Promise<UndoResult> {
  const locale = opts.locale ?? "zh-TW";
  let decided: Decided | undefined;
  try {
    decided = (await decideMany(opts.orgId, [opts.activityId], opts.caller, locale)).get(opts.activityId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return failure("failed", locale, { error: message.slice(0, 200) });
  }
  if (!decided) return failure("not_found", locale);
  const { decision, plan, entityType } = decided;
  if (!decision.ok || !plan.ok) {
    return plan.ok ? failure("not_found", locale) : { ok: false, code: plan.code, reason: plan.reason };
  }

  let applied: boolean;
  try {
    applied = await applyUndo(opts.orgId, decision);
  } catch (err) {
    // 0044 的結帳鎖定（PERIOD_CLOSED）等資料庫錯誤 → 看得懂的理由，不丟原始錯誤
    const r = undoErrorRefusal(err);
    return { ok: false, code: r.code, reason: undoReasonText(r, locale) };
  }
  if (!applied) return failure(decision.kind === "restore" ? "conflict" : "nothing_to_do", locale);

  const action = UNDO_ACTION[decision.kind];
  const summary = undoSummary(opts.activityId, plan.summary);
  // entityType 與原本那筆相同：record() 照常抓這次變動的快照，所以復原也能再復原。
  let newId: number | null = null;
  if (entityType) {
    newId =
      opts.channel === "web"
        ? await logWeb(opts.orgId, action, entityType, decision.rowId, summary, { undoOf: opts.activityId })
        : await logToolActivity(opts.channel, opts.orgId, opts.caller.userId, action, entityType, decision.rowId, summary, {
            toolName: "undo_activity",
            undoOf: opts.activityId,
          });
  }
  return {
    ok: true,
    activityId: newId,
    undoneActivityId: opts.activityId,
    entityType: entityType ?? decision.table,
    kind: decision.kind,
    table: decision.table,
    rowId: decision.rowId,
    restoredFields: decision.kind === "restore" ? Object.keys(decision.values) : [],
    summary,
  };
}

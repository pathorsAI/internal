/**
 * 復原（undo）的純邏輯：entity type ↔ 資料表、快照遮罩、對應這筆操作的 entity_changes 區間、
 * 以及「這筆能不能復原、要怎麼復原」的決策表。不碰資料庫，src/db/undo.ts 撈好事實丟進來；
 * src/lib/undo-rules.test.ts 把每一條規則都測過。
 *
 * 規則（migrations/0045）：
 * - 新增 → 刪掉（表有 deleted_at 就軟刪，沒有才真的 DELETE）。
 * - 修改 → 把改過的欄位改回第一筆變動之前的值；但這列之後還有更新的變動就拒絕（會蓋掉別人的修改）。
 * - 刪除 → 軟刪的清掉 deleted_at；真的刪掉的用刪除前的資料重新 INSERT（保留原本的 id）。
 * - 對外生效的（電子發票、薪資申報、送出的通知、日曆同步）與一次動很多列的工具一律拒絕，說清楚該怎麼做。
 * - 只有操作人本人或 owner／admin 能復原。
 */

import activityMessages from "@/i18n/messages/activity";

/**
 * activity_log.entity_type → 資料表。只列「一筆操作紀錄 = 這張表的一列」的類型。
 * 每一張表都要在 migrations/0045 的 trigger 清單裡（有 bigint id 與 organization_id）。
 * 沒列在這裡、也沒列在 NOT_UNDOABLE_ENTITIES 的類型，src/lib/undo-rules.test.ts 會擋下來。
 */
export const ENTITY_TABLES: Readonly<Record<string, string>> = {
  transaction: "transactions",
  // create_reimbursement 建的是一筆 reimbursement 類型的交易
  reimbursement: "transactions",
  party: "parties",
  category: "categories",
  bank_account: "bank_accounts",
  project: "projects",
  contract: "contracts",
  subscription: "subscriptions",
  subscription_period: "subscription_periods",
  billing_item: "billing_items",
  invoice: "invoices",
  employee: "employees",
  employee_bank_account: "employee_bank_accounts",
  reconciliation: "account_reconciliations",
  recurring_expense: "recurring_expenses",
  document: "documents",
  vendor_billing_account: "vendor_billing_accounts",
  payment_method: "payment_methods",
  vendor_invoice: "vendor_invoices",
  ai_rule: "ai_rules",
  // 0044 總帳
  journal_entry: "journal_entries",
  fixed_asset: "fixed_assets",
  gl_account: "gl_accounts",
  fx_rate: "fx_rates",
};

/** 有 deleted_at（軟刪）的表。新增的復原在這些表上是軟刪，其他表是真的 DELETE。 */
export const SOFT_DELETE_TABLES: ReadonlySet<string> = new Set([
  "transactions",
  "parties",
  "categories",
  "bank_accounts",
  "projects",
  "contracts",
  "subscriptions",
  "subscription_periods",
  "billing_items",
  "invoices",
  "employees",
  "employee_bank_accounts",
  "account_reconciliations",
  "recurring_expenses",
  "documents",
  "vendor_billing_accounts",
  "payment_methods",
  "ai_rules",
  "journal_entries",
  "fixed_assets",
]);

/**
 * 0044 結帳鎖定（guard_closed_period）擋的表：日期欄位、以及改了才會被擋的欄位（跟 trigger 參數一致）。
 * 新增／刪除（含軟刪、救回）一律算動到帳；修改只有動到這些欄位才算。
 */
export const PERIOD_GUARDS: Readonly<Record<string, { dateColumn: string; columns: readonly string[] }>> = {
  transactions: {
    dateColumn: "txn_date",
    columns: [
      "txn_date", "amount", "amount_twd", "currency", "type", "book", "category_id", "from_account_id",
      "to_account_id", "invoice_id", "related_to_id", "settle_employee_id", "party_id", "deleted_at",
    ],
  },
  invoices: {
    dateColumn: "invoice_date",
    columns: ["invoice_date", "direction", "status", "amount_net", "tax", "amount_gross", "currency", "deleted_at"],
  },
  journal_entries: { dateColumn: "entry_date", columns: ["entry_date", "ledger", "deleted_at"] },
  fixed_assets: {
    dateColumn: "acquired_on",
    columns: [
      "acquired_on", "cost", "salvage_value", "useful_life_months", "asset_account_id", "source_transaction_id",
      "deleted_at",
    ],
  },
};

export type UndoReasonCode = keyof typeof activityMessages.undo.reasons;

/** 不能復原的 entity type 與理由（對外生效、多列、或根本不是一列資料）。 */
export const NOT_UNDOABLE_ENTITIES: Readonly<Record<string, UndoReasonCode>> = {
  integration: "integration",
  api_key: "integration",
  organization: "integration",
  accounting_settings: "integration",
  member: "integration",
  tool: "integration",
  calendar: "calendar",
  // 結帳／重新開帳：到財務報表操作
  fiscal_period: "period_close",
  // 發薪：薪資單＋支出交易；刪薪資批次會連帶刪掉底下的薪資單
  payslip: "pay_employee_salary",
  payroll_run: "multi_row",
};

/** 工具名稱 → 不能復原的理由（activity_log.tool_name）。 */
export const NOT_UNDOABLE_TOOLS: Readonly<Record<string, UndoReasonCode>> = {
  bulk_create_transactions: "bulk_create_transactions",
  merge_parties: "merge_parties",
  pay_employee_salary: "pay_employee_salary",
  set_payment_allocations: "set_payment_allocations",
  simpany_issue_invoice: "e_invoice",
  simpany_void_invoice: "e_invoice",
  simpany_apply_salary_filing: "salary_filing",
  simpany_settle_salary_filing: "salary_filing",
  simpany_upload_tax_files: "salary_filing",
  simpany_create_tax_upload_slots: "salary_filing",
  simpany_send_payslips: "notification",
  preview_billing_notifications: "notification",
  sync_billing_calendar: "calendar",
  run_integration_sync: "integration",
  wise_sync_transactions: "multi_row",
  simpany_sync_invoices: "multi_row",
  simpany_sync_salary_declarations: "multi_row",
};

/** 永遠不改的欄位：主鍵、組織、建立時間；updated_at 交給資料本身（復原不把它改回舊值）。 */
export const PROTECTED_COLUMNS: ReadonlySet<string> = new Set(["id", "organization_id", "created_at", "updated_at"]);

// ---------------------------------------------------------------------------
// 遮罩
// ---------------------------------------------------------------------------

/** 遮罩後顯示的值。 */
export const MASK = "••••";

/**
 * 敏感欄位：密文（*_enc，身分證字號、銀行帳號、整合憑證）一律只顯示「••••」，
 * 跟網頁、MCP 一樣不給完整值（src/lib/pii.ts、src/db/employee-accounts.ts）。
 * 列表上本來就看得到的末 5 碼（account_last5）不必遮。
 */
export function isSensitiveColumn(key: string): boolean {
  return key.endsWith("_enc") || key === "national_id" || key === "account_number" || key === "salary_account";
}

export type Snapshot = Record<string, unknown>;

/** 寫進 activity_log.before／after 的快照：敏感欄位換成遮罩。 */
export function maskSnapshot(row: Snapshot | null | undefined): Snapshot | null {
  if (!row) return null;
  const out: Snapshot = {};
  for (const [k, v] of Object.entries(row)) {
    out[k] = isSensitiveColumn(k) && v !== null && v !== undefined && v !== "" ? MASK : v;
  }
  return out;
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return a === b;
  return JSON.stringify(a) === JSON.stringify(b);
}

/** 前後有差的欄位（依 key 排序）。新增時 before 是 null、刪除時 after 是 null。 */
export function changedKeys(before: Snapshot | null, after: Snapshot | null): string[] {
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  return [...keys]
    .filter((k) => {
      const prev = before ? before[k] : undefined;
      const next = after ? after[k] : undefined;
      if (!before) return next !== null && next !== undefined; // 新增：只列有值的欄位
      if (!after) return prev !== null && prev !== undefined; // 刪除：同上
      return !sameValue(prev, next);
    })
    .sort((a, b) => a.localeCompare(b));
}

export type FieldDiff = { key: string; before: unknown; after: unknown };

/** 畫面上的差異：只列改過的欄位（值已是遮罩過的）。 */
export function diffSnapshots(before: Snapshot | null, after: Snapshot | null): FieldDiff[] {
  return changedKeys(before, after).map((key) => ({
    key,
    before: before ? (before[key] ?? null) : null,
    after: after ? (after[key] ?? null) : null,
  }));
}

// ---------------------------------------------------------------------------
// 找這筆操作對到的 entity_changes
// ---------------------------------------------------------------------------

export type ChangeRow = { id: number; op: "insert" | "update" | "delete"; before: Snapshot | null; after: Snapshot | null };

function isSoftDelete(c: ChangeRow): boolean {
  return c.op === "update" && c.after?.deleted_at != null && c.before?.deleted_at == null;
}

/**
 * 寫完資料、記操作紀錄時，從這一列最近還沒被認領的變動裡挑出屬於這筆操作的區間。
 * changes：這一列最近 2 分鐘內、id 比上一筆操作認領過的還大的變動（依 id 由小到大）。
 * 動作要對得上才認：新增的第一筆必須是 INSERT、刪除的最後一筆必須是 DELETE 或「設了 deleted_at」。
 * 對不上就不認（寧可這筆不能復原，也不要復原到別人的變動）。
 */
export function pickChangeGroup(
  action: string,
  changes: readonly ChangeRow[],
): { first: ChangeRow; last: ChangeRow } | null {
  if (changes.length === 0) return null;
  const first = changes[0];
  const last = changes.at(-1) as ChangeRow;
  if (action === "create" && first.op !== "insert") return null;
  if (action === "delete" && last.op !== "delete" && !isSoftDelete(last)) return null;
  if (action !== "create" && action !== "update" && action !== "delete") return null;
  return { first, last };
}

// ---------------------------------------------------------------------------
// 決策表
// ---------------------------------------------------------------------------

export type UndoKind = "softDelete" | "delete" | "restore" | "undelete" | "reinsert";

/** 復原實際做了什麼 → 復原自己那筆操作紀錄的 action。 */
export const UNDO_ACTION: Readonly<Record<UndoKind, "create" | "update" | "delete">> = {
  softDelete: "delete",
  delete: "delete",
  restore: "update",
  undelete: "create",
  reinsert: "create",
};

export type UndoActivity = {
  id: number;
  action: string;
  entityType: string;
  entityId: number | null;
  actorUserId: string | null;
  toolName: string | null;
  summary: string | null;
  changeId: number | null;
  firstChangeId: number | null;
};

export type UndoFacts = {
  activity: UndoActivity;
  caller: { userId: string; role: string | null };
  /** 已經復原過這筆的操作紀錄 id。 */
  undoneBy: number | null;
  firstChange: ChangeRow | null;
  lastChange: ChangeRow | null;
  /** 這列現在的樣子（完整、未遮罩）；不存在是 null。 */
  current: Snapshot | null;
  /** 這個組織已結帳的月份（YYYY-MM）。 */
  closedPeriods?: ReadonlySet<string>;
  /** change_id 之後這一列最新的一筆變動（有就代表之後又被改過）。 */
  newer: { changedAt: string; activityId: number | null; actorName: string | null } | null;
};

export type UndoRefusal = { ok: false; code: UndoReasonCode; params?: Record<string, string | number> };

export type UndoDecision =
  | {
      ok: true;
      kind: UndoKind;
      table: string;
      rowId: number;
      /** restore：要改回去的欄位與值（未遮罩）；reinsert：整列。 */
      values: Snapshot;
      /** restore 的衝突判斷：這列在這個 entity_changes id 之後不能再有變動。 */
      guardChangeId: number;
    }
  | UndoRefusal;

function refuse(code: UndoReasonCode, params?: Record<string, string | number>): UndoRefusal {
  return params ? { ok: false, code, params } : { ok: false, code };
}

/** 對外生效或多列的工具／類型：回傳理由；可以往下判斷就回 null。 */
export function blockedReason(a: Pick<UndoActivity, "action" | "entityType" | "toolName" | "summary">): UndoRefusal | null {
  if (a.action === "read") return refuse("read_action");
  const byTool = a.toolName ? NOT_UNDOABLE_TOOLS[a.toolName] : undefined;
  if (byTool) return refuse(byTool);
  // 網頁上開立／作廢電子發票、Simpany 薪資動作的 summary 都以「simpany」開頭（simpany-actions.ts）
  if (a.summary && /^simpany\b/i.test(a.summary)) {
    return refuse(a.entityType === "invoice" ? "e_invoice" : "salary_filing");
  }
  const byEntity = NOT_UNDOABLE_ENTITIES[a.entityType];
  if (byEntity) return refuse(byEntity);
  if (!ENTITY_TABLES[a.entityType]) return refuse("unsupported_entity", { entity: a.entityType });
  return null;
}

/** 本人或 owner／admin。 */
export function mayUndo(actorUserId: string | null, caller: { userId: string; role: string | null }): boolean {
  if (caller.role === "owner" || caller.role === "admin") return true;
  return Boolean(caller.role) && actorUserId !== null && actorUserId === caller.userId;
}

/** restore 要改回去的欄位：前後有差、而且不是受保護的欄位。 */
export function restoreValues(before: Snapshot, after: Snapshot | null): Snapshot {
  const out: Snapshot = {};
  for (const k of changedKeys(before, after ?? {})) {
    if (PROTECTED_COLUMNS.has(k)) continue;
    if (!(k in before)) continue;
    out[k] = before[k];
  }
  return out;
}

function decideCreate(table: string, rowId: number, f: UndoFacts, guard: number): UndoDecision {
  if (!f.current) return refuse("row_missing");
  if (SOFT_DELETE_TABLES.has(table)) {
    if (f.current.deleted_at != null) return refuse("nothing_to_do");
    return { ok: true, kind: "softDelete", table, rowId, values: {}, guardChangeId: guard };
  }
  return { ok: true, kind: "delete", table, rowId, values: {}, guardChangeId: guard };
}

function decideUpdate(table: string, rowId: number, f: UndoFacts, guard: number): UndoDecision {
  if (f.newer) {
    return refuse("conflict", {
      when: f.newer.changedAt,
      who: f.newer.actorName ?? "",
      ref: f.newer.activityId ?? "",
    });
  }
  if (!f.current) return refuse("row_missing");
  const before = f.firstChange?.before;
  if (!before) return refuse("no_snapshot");
  const values = restoreValues(before, f.lastChange?.after ?? null);
  if (Object.keys(values).length === 0) return refuse("nothing_to_do");
  return { ok: true, kind: "restore", table, rowId, values, guardChangeId: guard };
}

function decideDelete(table: string, rowId: number, f: UndoFacts, guard: number): UndoDecision {
  if (f.current) {
    if (f.current.deleted_at != null) {
      return { ok: true, kind: "undelete", table, rowId, values: {}, guardChangeId: guard };
    }
    return refuse("nothing_to_do");
  }
  const last = f.lastChange;
  const before = last?.op === "delete" ? last.before : null;
  if (!before) return refuse("row_missing");
  return { ok: true, kind: "reinsert", table, rowId, values: before, guardChangeId: guard };
}

function monthOf(v: unknown): string | null {
  return typeof v === "string" && /^\d{4}-\d{2}/.test(v) ? v.slice(0, 7) : null;
}

/**
 * 復原會不會撞到已結帳的月份（0044 guard_closed_period）：這列現在的日期、或要改回去的日期，
 * 落在已結帳月份，而且這次復原會動到 trigger 會擋的欄位。撞到就回那個月份。
 */
export function closedPeriodHit(d: Extract<UndoDecision, { ok: true }>, f: UndoFacts): string | null {
  const guard = PERIOD_GUARDS[d.table];
  if (!guard || !f.closedPeriods || f.closedPeriods.size === 0) return null;
  if (d.kind === "restore" && !Object.keys(d.values).some((k) => guard.columns.includes(k))) return null;
  const dates = [f.current?.[guard.dateColumn], d.values[guard.dateColumn]];
  for (const v of dates) {
    const m = monthOf(v);
    if (m && f.closedPeriods.has(m)) return m;
  }
  return null;
}

/** 結帳時系統自動產生的分錄（kind = snapshot）：跟著結帳／重新開帳走，不能單獨復原。 */
function isSystemGenerated(table: string, f: UndoFacts): boolean {
  if (table !== "journal_entries") return false;
  const row = f.current ?? f.lastChange?.before ?? f.lastChange?.after;
  return row?.kind === "snapshot";
}

/** 這筆操作紀錄能不能復原、要怎麼復原。 */
export function decideUndo(f: UndoFacts): UndoDecision {
  const d = decideRow(f);
  if (!d.ok) return d;
  if (isSystemGenerated(d.table, f)) return refuse("system_generated");
  const month = closedPeriodHit(d, f);
  return month ? refuse("period_closed", { month }) : d;
}

/** 丟出來的不是 Error 時轉成字串：基本型別照 String()，物件用 JSON（失敗才退回 String()）。 */
function describeThrown(v: unknown): string {
  if (typeof v === "object" && v !== null) {
    try {
      return JSON.stringify(v) ?? Object.prototype.toString.call(v);
    } catch {
      return Object.prototype.toString.call(v);
    }
  }
  return String(v as string | number | boolean | bigint | symbol | undefined);
}

/** 執行時撞到的資料庫錯誤 → 看得懂的理由（PERIOD_CLOSED 來自 0044 的 trigger）。 */
export function undoErrorRefusal(err: unknown): UndoRefusal {
  const parts: string[] = [];
  let cur: unknown = err;
  for (let i = 0; i < 4 && cur; i++) {
    parts.push(cur instanceof Error ? cur.message : describeThrown(cur));
    cur = cur instanceof Error ? (cur as Error & { cause?: unknown }).cause : null;
  }
  const text = parts.join(" | ");
  const m = /PERIOD_CLOSED:\s*(\d{4}-\d{2})/.exec(text);
  if (text.includes("PERIOD_CLOSED")) return refuse("period_closed", { month: m ? m[1] : "?" });
  return refuse("failed", { error: text.slice(0, 200) });
}

function decideRow(f: UndoFacts): UndoDecision {
  const a = f.activity;
  const blocked = blockedReason(a);
  if (blocked) return blocked;
  if (!mayUndo(a.actorUserId, f.caller)) return refuse("forbidden");
  if (f.undoneBy !== null) return refuse("already_undone", { id: f.undoneBy });
  const table = ENTITY_TABLES[a.entityType];
  if (a.changeId === null || a.entityId === null || !f.lastChange) return refuse("no_snapshot");
  if (a.action === "create") return decideCreate(table, a.entityId, f, a.changeId);
  if (a.action === "update") return decideUpdate(table, a.entityId, f, a.changeId);
  if (a.action === "delete") return decideDelete(table, a.entityId, f, a.changeId);
  return refuse("no_snapshot");
}

// ---------------------------------------------------------------------------
// 理由文字
// ---------------------------------------------------------------------------

export type UndoLocale = "zh-TW" | "en";

function fill(template: string, params: Record<string, string | number>): string {
  return template.replaceAll(/\{(\w+)\}/g, (_, k: string) => (k in params ? String(params[k]) : ""));
}

/**
 * 理由的文字（網頁、MCP、站內 AI 共用 src/i18n/messages/activity.ts 的 undo.reasons）。
 * conflict 的 who 空白時補「其他人」，ref 有值時補「（#id）」。
 */
export function undoReasonText(r: Pick<UndoRefusal, "code" | "params">, locale: UndoLocale): string {
  const template = activityMessages.undo.reasons[r.code][locale];
  const params: Record<string, string | number> = { ...r.params };
  if (r.code === "conflict") {
    if (!params.who) params.who = activityMessages.undo.someone[locale];
    params.ref = params.ref ? `（#${params.ref}）` : "";
    if (locale === "en" && params.ref) params.ref = ` (#${r.params?.ref})`;
  }
  return fill(template, params);
}

/** 復原自己那筆操作紀錄的 summary：「復原 #123：原本的說明」。 */
export function undoSummary(originalId: number, originalSummary: string | null, locale: UndoLocale = "zh-TW"): string {
  return fill(activityMessages.undo.summary[locale], { id: originalId, summary: originalSummary ?? "" }).replace(/[：:]\s*$/, "");
}

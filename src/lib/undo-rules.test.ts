import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { tools } from "@/lib/mcp/tools";
import { deriveMcpAudit } from "@/lib/mcp/handler";
import { activityIdOf, withActivityId } from "@/lib/ai/history";
import {
  decideUndo,
  diffSnapshots,
  ENTITY_TABLES,
  MASK,
  maskSnapshot,
  mayUndo,
  NOT_UNDOABLE_ENTITIES,
  pickChangeGroup,
  restoreValues,
  SOFT_DELETE_TABLES,
  undoReasonText,
  undoSummary,
  type ChangeRow,
  type UndoActivity,
  type UndoFacts,
} from "./undo-rules";

const ROOT = join(import.meta.dir, "..", "..");

function activity(over: Partial<UndoActivity> = {}): UndoActivity {
  return {
    id: 10,
    action: "update",
    entityType: "transaction",
    entityId: 5,
    actorUserId: "u1",
    toolName: null,
    summary: "午餐",
    changeId: 101,
    firstChangeId: 100,
    ...over,
  };
}

const ins: ChangeRow = { id: 100, op: "insert", before: null, after: { id: 5, amount: 100, deleted_at: null } };
const upd1: ChangeRow = {
  id: 100,
  op: "update",
  before: { id: 5, organization_id: "o1", amount: 100, note: "a", created_at: "t0", updated_at: "t1", deleted_at: null },
  after: { id: 5, organization_id: "o1", amount: 200, note: "a", created_at: "t0", updated_at: "t2", deleted_at: null },
};
const upd2: ChangeRow = {
  id: 101,
  op: "update",
  before: upd1.after,
  after: { ...upd1.after, note: "b", updated_at: "t3" },
};

function facts(over: Partial<UndoFacts> = {}): UndoFacts {
  return {
    activity: activity(),
    caller: { userId: "u1", role: "member" },
    undoneBy: null,
    firstChange: upd1,
    lastChange: upd2,
    current: { id: 5, amount: 200, note: "b", deleted_at: null },
    newer: null,
    ...over,
  };
}

describe("decideUndo", () => {
  test("update → restore the first change's before, only changed, non-protected columns", () => {
    const d = decideUndo(facts());
    expect(d).toEqual({
      ok: true,
      kind: "restore",
      table: "transactions",
      rowId: 5,
      values: { amount: 100, note: "a" },
      guardChangeId: 101,
    });
  });

  test("update with a newer change → conflict naming when / who / which entry", () => {
    const d = decideUndo(facts({ newer: { changedAt: "2026-11-25T10:00:00Z", activityId: 42, actorName: "Amy" } }));
    expect(d).toEqual({ ok: false, code: "conflict", params: { when: "2026-11-25T10:00:00Z", who: "Amy", ref: 42 } });
    if (d.ok) throw new Error("unreachable");
    expect(undoReasonText(d, "zh-TW")).toContain("Amy");
    expect(undoReasonText(d, "zh-TW")).toContain("#42");
    expect(undoReasonText(d, "en")).toContain("(#42)");
    // 不知道是誰改的：補「其他人」
    const anon = decideUndo(facts({ newer: { changedAt: "x", activityId: null, actorName: null } }));
    if (anon.ok) throw new Error("unreachable");
    expect(undoReasonText(anon, "zh-TW")).toContain("其他人");
    expect(undoReasonText(anon, "en")).toContain("someone else");
  });

  test("create → soft delete on soft-delete tables, hard delete elsewhere", () => {
    const create = activity({ action: "create", changeId: 100, firstChangeId: 100 });
    expect(decideUndo(facts({ activity: create, firstChange: ins, lastChange: ins }))).toMatchObject({
      ok: true,
      kind: "softDelete",
      table: "transactions",
    });
    const vi = activity({ action: "create", entityType: "vendor_invoice", changeId: 100, firstChangeId: 100 });
    expect(SOFT_DELETE_TABLES.has("vendor_invoices")).toBe(false);
    expect(decideUndo(facts({ activity: vi, firstChange: ins, lastChange: ins }))).toMatchObject({
      ok: true,
      kind: "delete",
      table: "vendor_invoices",
    });
    // 已經被刪掉了
    expect(
      decideUndo(facts({ activity: create, firstChange: ins, lastChange: ins, current: { id: 5, deleted_at: "now" } })),
    ).toEqual({ ok: false, code: "nothing_to_do" });
    expect(decideUndo(facts({ activity: create, firstChange: ins, lastChange: ins, current: null }))).toEqual({
      ok: false,
      code: "row_missing",
    });
  });

  test("create is not blocked by later edits (only updates check conflicts)", () => {
    const create = activity({ action: "create", changeId: 100, firstChangeId: 100 });
    const d = decideUndo(
      facts({ activity: create, firstChange: ins, lastChange: ins, newer: { changedAt: "x", activityId: 9, actorName: "B" } }),
    );
    expect(d).toMatchObject({ ok: true, kind: "softDelete" });
  });

  test("delete → undelete when soft-deleted, reinsert when the row is gone", () => {
    const del = activity({ action: "delete" });
    const softDel: ChangeRow = { id: 101, op: "update", before: { id: 5, deleted_at: null }, after: { id: 5, deleted_at: "t" } };
    expect(decideUndo(facts({ activity: del, lastChange: softDel, current: { id: 5, deleted_at: "t" } }))).toMatchObject({
      ok: true,
      kind: "undelete",
    });
    const hardDel: ChangeRow = { id: 101, op: "delete", before: { id: 5, organization_id: "o1", amount: 1 }, after: null };
    expect(decideUndo(facts({ activity: del, lastChange: hardDel, current: null }))).toEqual({
      ok: true,
      kind: "reinsert",
      table: "transactions",
      rowId: 5,
      values: { id: 5, organization_id: "o1", amount: 1 },
      guardChangeId: 101,
    });
    // 已經救回來了
    expect(decideUndo(facts({ activity: del, lastChange: softDel, current: { id: 5, deleted_at: null } }))).toEqual({
      ok: false,
      code: "nothing_to_do",
    });
    // 軟刪的列又被永久刪掉了
    expect(decideUndo(facts({ activity: del, lastChange: softDel, current: null }))).toEqual({ ok: false, code: "row_missing" });
  });

  test("refusals: read, no snapshot, already undone, forbidden", () => {
    expect(decideUndo(facts({ activity: activity({ action: "read" }) }))).toEqual({ ok: false, code: "read_action" });
    expect(decideUndo(facts({ activity: activity({ changeId: null, firstChangeId: null }), lastChange: null }))).toEqual({
      ok: false,
      code: "no_snapshot",
    });
    expect(decideUndo(facts({ undoneBy: 77 }))).toEqual({ ok: false, code: "already_undone", params: { id: 77 } });
    expect(decideUndo(facts({ caller: { userId: "u2", role: "member" } }))).toEqual({ ok: false, code: "forbidden" });
    // owner／admin 可以復原別人的
    expect(decideUndo(facts({ caller: { userId: "u2", role: "admin" } }))).toMatchObject({ ok: true });
    // 系統排程（沒有操作人）只有 owner／admin 能復原
    expect(decideUndo(facts({ activity: activity({ actorUserId: null }) }))).toEqual({ ok: false, code: "forbidden" });
  });

  test("external effects and multi-row tools are refused with what to do instead", () => {
    const cases: Array<[Partial<UndoActivity>, string]> = [
      [{ toolName: "bulk_create_transactions", action: "create" }, "bulk_create_transactions"],
      [{ toolName: "merge_parties", entityType: "party" }, "merge_parties"],
      [{ toolName: "pay_employee_salary", entityType: "payslip", action: "create" }, "pay_employee_salary"],
      [{ toolName: "simpany_void_invoice", entityType: "invoice" }, "e_invoice"],
      [{ entityType: "invoice", action: "create", summary: "simpany: issue draft #3 → AB12345678 NT$100" }, "e_invoice"],
      [{ entityType: "integration", summary: "simpany: salary settle 2026-10" }, "salary_filing"],
      [{ toolName: "simpany_send_payslips", entityType: "integration" }, "notification"],
      [{ toolName: "preview_billing_notifications", entityType: "integration" }, "notification"],
      [{ entityType: "calendar" }, "calendar"],
      [{ entityType: "integration" }, "integration"],
      [{ entityType: "payroll_run", action: "delete" }, "multi_row"],
    ];
    for (const [over, code] of cases) {
      expect(decideUndo(facts({ activity: activity(over) }))).toMatchObject({ ok: false, code });
    }
    expect(undoReasonText({ code: "e_invoice" }, "zh-TW")).toContain("作廢發票");
    expect(decideUndo(facts({ activity: activity({ entityType: "widget" }) }))).toEqual({
      ok: false,
      code: "unsupported_entity",
      params: { entity: "widget" },
    });
  });
});

describe("snapshots", () => {
  test("encrypted columns are masked; plain values and nulls are kept", () => {
    expect(
      maskSnapshot({ name: "Amy", national_id_enc: "v1:abc", account_number_enc: "v1:def", account_last5: "12345", phone: null }),
    ).toEqual({ name: "Amy", national_id_enc: MASK, account_number_enc: MASK, account_last5: "12345", phone: null });
    expect(maskSnapshot({ national_id_enc: null })).toEqual({ national_id_enc: null });
    expect(maskSnapshot(null)).toBeNull();
  });

  test("diff lists only changed fields (create: non-null fields; delete: non-null fields)", () => {
    expect(diffSnapshots({ a: 1, b: 2 }, { a: 1, b: 3 })).toEqual([{ key: "b", before: 2, after: 3 }]);
    expect(diffSnapshots(null, { a: 1, b: null })).toEqual([{ key: "a", before: null, after: 1 }]);
    expect(diffSnapshots({ a: 1, b: null }, null)).toEqual([{ key: "a", before: 1, after: null }]);
    expect(diffSnapshots({ j: { x: 1 } }, { j: { x: 1 } })).toEqual([]);
  });

  test("restore never touches id / organization_id / created_at / updated_at", () => {
    expect(
      restoreValues(
        { id: 1, organization_id: "o", created_at: "a", updated_at: "b", amount: 1 },
        { id: 2, organization_id: "p", created_at: "c", updated_at: "d", amount: 2 },
      ),
    ).toEqual({ amount: 1 });
  });

  test("pickChangeGroup: action must match the ops", () => {
    expect(pickChangeGroup("create", [ins, upd2])).toEqual({ first: ins, last: upd2 });
    expect(pickChangeGroup("create", [upd1])).toBeNull();
    expect(pickChangeGroup("update", [upd1, upd2])).toEqual({ first: upd1, last: upd2 });
    const softDel: ChangeRow = { id: 3, op: "update", before: { deleted_at: null }, after: { deleted_at: "t" } };
    expect(pickChangeGroup("delete", [softDel])).toEqual({ first: softDel, last: softDel });
    expect(pickChangeGroup("delete", [upd1])).toBeNull();
    expect(pickChangeGroup("read", [upd1])).toBeNull();
    expect(pickChangeGroup("update", [])).toBeNull();
  });

  test("mayUndo: own entries for members, anyone's for owner/admin, nothing for non-members", () => {
    expect(mayUndo("u1", { userId: "u1", role: "member" })).toBe(true);
    expect(mayUndo("u1", { userId: "u2", role: "member" })).toBe(false);
    expect(mayUndo("u1", { userId: "u2", role: "owner" })).toBe(true);
    expect(mayUndo("u1", { userId: "u1", role: null })).toBe(false);
  });

  test("undo summary", () => {
    expect(undoSummary(123, "午餐")).toBe("復原 #123：午餐");
    expect(undoSummary(123, null)).toBe("復原 #123");
  });
});

/** src 底下所有 .ts／.tsx（不含測試）。 */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sourceFiles(p));
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

describe("entity type → table map", () => {
  test("every entity type written to activity_log is mapped or explicitly not undoable", () => {
    const used = new Set<string>();
    // 網頁 / 整合直接呼叫 log*() 的字面值
    const re = /"(?:create|update|delete|read)",\s*"([a-z_]+)"/g;
    for (const f of sourceFiles(join(ROOT, "src"))) {
      const text = readFileSync(f, "utf8");
      if (!/log(?:Web|Mcp|Ai|Api|Chat|System|ToolActivity)\(|auditIntegrationCall/.test(text)) continue;
      for (const m of text.matchAll(re)) used.add(m[1]);
    }
    // MCP／站內 AI 的工具：handler 依工具名稱推出來的 entity type
    for (const name of Object.keys(tools)) {
      const audit = deriveMcpAudit(name, { id: 1 });
      if (audit && audit.action !== "read") used.add(audit.entityType);
    }
    expect(used.size).toBeGreaterThan(15);
    const unmapped = [...used].filter((e) => !ENTITY_TABLES[e] && !NOT_UNDOABLE_ENTITIES[e]);
    expect(unmapped).toEqual([]);
  });

  test("every mapped table gets the trigger in migrations/0045", () => {
    const migration = readFileSync(join(ROOT, "migrations", "0045_undo.sql"), "utf8");
    for (const table of Object.values(ENTITY_TABLES)) expect(migration).toContain(`'${table}'`);
    for (const table of SOFT_DELETE_TABLES) expect(Object.values(ENTITY_TABLES)).toContain(table);
  });
});

describe("AI tool result carries the activity id", () => {
  test("withActivityId puts it first; activityIdOf reads it even when truncated", () => {
    const content = JSON.stringify(withActivityId({ id: 5, activityId: 1, name: "x" }, 42));
    expect(content.startsWith('{"activityId":42')).toBe(true);
    expect(activityIdOf(content)).toBe(42);
    expect(activityIdOf(`${content.slice(0, 20)}…`)).toBe(42);
    expect(JSON.parse(JSON.stringify(withActivityId([1], 7)))).toEqual({ activityId: 7, result: [1] });
    expect(activityIdOf('{"id":1}')).toBeUndefined();
    expect(activityIdOf(null)).toBeUndefined();
  });
});

import { sql, type SQL } from "drizzle-orm";
import { getDb, type Db } from "./index";
import {
  ENTITY_TABLES,
  pickChangeGroup,
  type ChangeRow,
  type Snapshot,
  type UndoActivity,
  type UndoDecision,
  type UndoFacts,
} from "@/lib/undo-rules";

/**
 * 復原（migrations/0045）的資料庫存取。決策在 src/lib/undo-rules.ts（純函式），
 * 這裡只負責撈事實、執行。
 *
 * 一律用 raw SQL：要跨十幾張表、用 to_jsonb／jsonb_populate_record 一般化處理，
 * drizzle 的型別化查詢幫不上忙。表名只來自 ENTITY_TABLES（白名單），欄位名只來自
 * information_schema，兩者都再經 sql.identifier 加引號。
 * 欄位一律轉成 text／jsonb 再出去：兩種 driver 對 bigint、timestamptz 的解析不一樣。
 */

const TABLES = new Set(Object.values(ENTITY_TABLES));

/** 抓完這筆操作就記操作紀錄，所以 2 分鐘內的變動才算是它的。 */
const CAPTURE_WINDOW = sql.raw("interval '2 minutes'");

function rowsOf<T>(res: unknown): T[] {
  if (Array.isArray(res)) return res as T[];
  return (res as { rows?: T[] }).rows ?? [];
}

function idList(ids: readonly number[]): SQL {
  return sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `,
  );
}

function assertTable(table: string): ReturnType<typeof sql.identifier> {
  if (!TABLES.has(table)) throw new Error(`table not undoable: ${table}`);
  return sql.identifier(table);
}

type RawChange = { id: string; op: ChangeRow["op"]; before: Snapshot | null; after: Snapshot | null };

function toChange(r: RawChange): ChangeRow {
  return { id: Number(r.id), op: r.op, before: r.before ?? null, after: r.after ?? null };
}

/**
 * record() 用：這一列最近 2 分鐘內、還沒被其他操作紀錄認領的變動，挑出屬於這筆操作的區間。
 * 找不到（表沒掛 trigger、這筆操作沒動到這一列、動作對不上）回 null。
 */
export async function captureChangeGroup(
  orgId: string,
  table: string,
  rowId: number,
  action: string,
  db: Db = getDb(),
): Promise<{ first: ChangeRow; last: ChangeRow } | null> {
  const res = await db.execute(sql`
    select id::text as id, op, before, after
    from entity_changes ec
    where ec.table_name = ${table}
      and ec.row_id = ${rowId}
      and ec.organization_id = ${orgId}
      and ec.changed_at > now() - ${CAPTURE_WINDOW}
      and ec.id > coalesce((
        select max(a.change_id) from activity_log a
        where a.change_id in (
          select e2.id from entity_changes e2 where e2.table_name = ${table} and e2.row_id = ${rowId}
        )
      ), 0)
    order by ec.id`);
  return pickChangeGroup(action, rowsOf<RawChange>(res).map(toChange));
}

type RawActivity = {
  id: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  actor_user_id: string | null;
  tool_name: string | null;
  summary: string | null;
  change_id: string | null;
  first_change_id: string | null;
};

function toActivity(r: RawActivity): UndoActivity {
  const num = (v: string | null) => (v === null ? null : Number(v));
  return {
    id: Number(r.id),
    action: r.action,
    entityType: r.entity_type,
    entityId: num(r.entity_id),
    actorUserId: r.actor_user_id,
    toolName: r.tool_name,
    summary: r.summary,
    changeId: num(r.change_id),
    firstChangeId: num(r.first_change_id),
  };
}

async function loadActivities(orgId: string, ids: readonly number[], db: Db): Promise<UndoActivity[]> {
  const res = await db.execute(sql`
    select id::text as id, action, entity_type, entity_id::text as entity_id, actor_user_id, tool_name, summary,
           change_id::text as change_id, first_change_id::text as first_change_id
    from activity_log
    where organization_id = ${orgId} and id in (${idList(ids)})`);
  return rowsOf<RawActivity>(res).map(toActivity);
}

async function loadChanges(ids: readonly number[], db: Db): Promise<Map<number, ChangeRow>> {
  if (ids.length === 0) return new Map();
  const res = await db.execute(sql`
    select id::text as id, op, before, after from entity_changes where id in (${idList(ids)})`);
  return new Map(rowsOf<RawChange>(res).map((r) => [Number(r.id), toChange(r)]));
}

async function loadUndoneBy(orgId: string, ids: readonly number[], db: Db): Promise<Map<number, number>> {
  const res = await db.execute(sql`
    select undo_of::text as undo_of, min(id)::text as id from activity_log
    where organization_id = ${orgId} and undo_of in (${idList(ids)})
    group by undo_of`);
  return new Map(rowsOf<{ undo_of: string; id: string }>(res).map((r) => [Number(r.undo_of), Number(r.id)]));
}

/** 各表這些 id 現在的樣子（只看這個組織的）。 */
async function loadCurrentRows(
  orgId: string,
  byTable: ReadonlyMap<string, number[]>,
  db: Db,
): Promise<Map<string, Snapshot>> {
  const out = new Map<string, Snapshot>();
  for (const [table, ids] of byTable) {
    const t = assertTable(table);
    const res = await db.execute(sql`
      select t.id::text as id, to_jsonb(t) as row from ${t} t
      where t.organization_id = ${orgId} and t.id in (${idList(ids)})`);
    for (const r of rowsOf<{ id: string; row: Snapshot }>(res)) out.set(`${table}:${r.id}`, r.row);
  }
  return out;
}

/** 已結帳的月份（0044 fiscal_periods）。表還不存在（0044 沒跑）就是空的。 */
async function loadClosedPeriods(orgId: string, db: Db): Promise<Set<string>> {
  try {
    const res = await db.execute(sql`
      select year::text as year, month::text as month from fiscal_periods
      where organization_id = ${orgId} and status = 'closed'`);
    return new Set(
      rowsOf<{ year: string; month: string }>(res).map((r) => `${r.year}-${r.month.padStart(2, "0")}`),
    );
  } catch {
    return new Set();
  }
}

type Newer = NonNullable<UndoFacts["newer"]>;

/** 每一列最新的一筆變動，以及認領它的操作紀錄（之後有沒有被改過、被誰改）。 */
async function loadLatestChanges(
  orgId: string,
  rows: ReadonlyArray<{ table: string; rowId: number }>,
  db: Db,
): Promise<Map<string, { id: number } & Newer>> {
  if (rows.length === 0) return new Map();
  const keys = sql.join(
    rows.map((r) => sql`(${r.table}, ${r.rowId}::bigint)`),
    sql`, `,
  );
  const res = await db.execute(sql`
    with latest as (
      select distinct on (table_name, row_id) table_name, row_id, id, changed_at
      from entity_changes
      where (table_name, row_id) in (${keys})
      order by table_name, row_id, id desc
    )
    select l.table_name, l.row_id::text as row_id, l.id::text as id, to_json(l.changed_at) #>> '{}' as changed_at,
           a.id::text as activity_id, coalesce(a.actor_name, a.actor_email) as actor_name
    from latest l
    left join lateral (
      select id, actor_name, actor_email from activity_log
      where organization_id = ${orgId} and change_id >= l.id and coalesce(first_change_id, change_id) <= l.id
      order by id limit 1
    ) a on true`);
  return new Map(
    rowsOf<{
      table_name: string;
      row_id: string;
      id: string;
      changed_at: string;
      activity_id: string | null;
      actor_name: string | null;
    }>(res).map((r) => [
      `${r.table_name}:${r.row_id}`,
      {
        id: Number(r.id),
        changedAt: r.changed_at,
        activityId: r.activity_id === null ? null : Number(r.activity_id),
        actorName: r.actor_name,
      },
    ]),
  );
}

/**
 * 一批操作紀錄的復原事實（給 planUndoMany）。找不到的 id 不會出現在結果裡。
 * 查詢數量固定（不隨列數增加）：紀錄、變動、復原過沒、每張表的現況、每列最新變動。
 */
export async function loadUndoFacts(
  orgId: string,
  ids: readonly number[],
  caller: UndoFacts["caller"],
  db: Db = getDb(),
): Promise<Map<number, UndoFacts>> {
  const out = new Map<number, UndoFacts>();
  if (ids.length === 0) return out;
  const activities = await loadActivities(orgId, ids, db);
  const withChange = activities.filter((a) => a.changeId !== null && a.entityId !== null && ENTITY_TABLES[a.entityType]);
  const changeIds = withChange.flatMap((a) => [a.changeId as number, a.firstChangeId ?? (a.changeId as number)]);
  const byTable = rowIdsByTable(withChange);
  const [changes, undoneBy, current, latest, closedPeriods] = await Promise.all([
    loadChanges([...new Set(changeIds)], db),
    loadUndoneBy(orgId, ids, db),
    loadCurrentRows(orgId, byTable, db),
    loadLatestChanges(
      orgId,
      withChange.map((a) => ({ table: ENTITY_TABLES[a.entityType], rowId: a.entityId as number })),
      db,
    ),
    loadClosedPeriods(orgId, db),
  ]);
  for (const a of activities) {
    const table = ENTITY_TABLES[a.entityType];
    const key = table && a.entityId !== null ? `${table}:${a.entityId}` : null;
    const last = a.changeId === null ? null : (changes.get(a.changeId) ?? null);
    const first = a.firstChangeId === null ? last : (changes.get(a.firstChangeId) ?? last);
    out.set(a.id, {
      activity: a,
      caller,
      undoneBy: undoneBy.get(a.id) ?? null,
      firstChange: first,
      lastChange: last,
      current: key ? (current.get(key) ?? null) : null,
      closedPeriods,
      newer: newerChange(key ? latest.get(key) : undefined, a.changeId),
    });
  }
  return out;
}

/** 有變動的操作紀錄 → 每張表要查現況的列 id。 */
function rowIdsByTable(withChange: readonly { entityType: string; entityId: number | null }[]): Map<string, number[]> {
  const byTable = new Map<string, number[]>();
  for (const a of withChange) {
    const table = ENTITY_TABLES[a.entityType];
    const list = byTable.get(table) ?? [];
    list.push(a.entityId as number);
    byTable.set(table, list);
  }
  return byTable;
}

/** 這一列在這筆紀錄之後還有沒有更新的變動（有的話復原會蓋掉別人後來的修改）。 */
function newerChange(
  newest: ({ id: number } & Newer) | undefined,
  changeId: number | null,
): UndoFacts["newer"] {
  return newest && changeId !== null && newest.id > changeId
    ? { changedAt: newest.changedAt, activityId: newest.activityId, actorName: newest.actorName }
    : null;
}

/** 這張表現在有、而且可以寫的欄位（不含 generated column）。 */
async function writableColumns(table: string, db: Db): Promise<Set<string>> {
  const res = await db.execute(sql`
    select column_name from information_schema.columns
    where table_schema = current_schema() and table_name = ${table} and is_generated = 'NEVER'`);
  return new Set(rowsOf<{ column_name: string }>(res).map((r) => r.column_name));
}

function columnList(cols: readonly string[]): SQL {
  return sql.join(
    cols.map((c) => sql.identifier(c)),
    sql`, `,
  );
}

/**
 * 執行決策。成功回 true；資料在決策之後又變了（例如被別人搶先改掉、已經刪掉）回 false。
 * restore 的衝突判斷跟 UPDATE 寫在同一句裡：這列在 guardChangeId 之後有任何變動就不動。
 */
export async function applyUndo(
  orgId: string,
  d: Extract<UndoDecision, { ok: true }>,
  db: Db = getDb(),
): Promise<boolean> {
  const t = assertTable(d.table);
  let res: unknown;
  if (d.kind === "softDelete") {
    res = await db.execute(sql`
      update ${t} set deleted_at = now()
      where id = ${d.rowId} and organization_id = ${orgId} and deleted_at is null returning id`);
  } else if (d.kind === "delete") {
    res = await db.execute(sql`
      delete from ${t} where id = ${d.rowId} and organization_id = ${orgId} returning id`);
  } else if (d.kind === "undelete") {
    res = await db.execute(sql`
      update ${t} set deleted_at = null
      where id = ${d.rowId} and organization_id = ${orgId} and deleted_at is not null returning id`);
  } else if (d.kind === "restore") {
    const existing = await writableColumns(d.table, db);
    const cols = Object.keys(d.values).filter((c) => existing.has(c));
    if (cols.length === 0) return false;
    const list = columnList(cols);
    res = await db.execute(sql`
      update ${t} set (${list}) = (
        select ${list} from jsonb_populate_record(null::${t}, ${JSON.stringify(d.values)}::jsonb)
      )
      where id = ${d.rowId} and organization_id = ${orgId}
        and not exists (
          select 1 from entity_changes
          where table_name = ${d.table} and row_id = ${d.rowId} and id > ${d.guardChangeId}
        )
      returning id`);
  } else {
    // reinsert：保留原本的 id 與組織（只在這個組織的資料上做）
    if (d.values.organization_id !== orgId) return false;
    const existing = await writableColumns(d.table, db);
    const cols = Object.keys(d.values).filter((c) => existing.has(c));
    const list = columnList(cols);
    res = await db.execute(sql`
      insert into ${t} (${list}) overriding system value
      select ${list} from jsonb_populate_record(null::${t}, ${JSON.stringify(d.values)}::jsonb)
      returning id`);
  }
  return rowsOf<{ id: unknown }>(res).length > 0;
}

/** 操作紀錄頁的復原標記：這筆是復原哪一筆（undoOf）、被哪一筆復原（undoneBy）。 */
export async function activityUndoLinks(
  orgId: string,
  ids: readonly number[],
  db: Db = getDb(),
): Promise<Map<number, { undoOf: number | null; undoneBy: number | null }>> {
  const out = new Map<number, { undoOf: number | null; undoneBy: number | null }>();
  if (ids.length === 0) return out;
  try {
    const res = await db.execute(sql`
      select a.id::text as id, a.undo_of::text as undo_of,
             (select min(b.id) from activity_log b where b.organization_id = ${orgId} and b.undo_of = a.id)::text as undone_by
      from activity_log a
      where a.organization_id = ${orgId} and a.id in (${idList(ids)})`);
    for (const r of rowsOf<{ id: string; undo_of: string | null; undone_by: string | null }>(res)) {
      const undoOf = r.undo_of === null ? null : Number(r.undo_of);
      const undoneBy = r.undone_by === null ? null : Number(r.undone_by);
      if (undoOf !== null || undoneBy !== null) out.set(Number(r.id), { undoOf, undoneBy });
    }
  } catch {
    // migration 0045 還沒跑：沒有復原標記
  }
  return out;
}

/** 一筆操作紀錄存下來的前後快照（已遮罩）。 */
export async function activitySnapshot(
  orgId: string,
  id: number,
  db: Db = getDb(),
): Promise<{ summary: string | null; entityType: string; entityId: number | null; before: Snapshot | null; after: Snapshot | null } | null> {
  const res = await db.execute(sql`
    select summary, entity_type, entity_id::text as entity_id, before, after
    from activity_log where organization_id = ${orgId} and id = ${id}`);
  const [r] = rowsOf<{
    summary: string | null;
    entity_type: string;
    entity_id: string | null;
    before: Snapshot | null;
    after: Snapshot | null;
  }>(res);
  if (!r) return null;
  return {
    summary: r.summary,
    entityType: r.entity_type,
    entityId: r.entity_id === null ? null : Number(r.entity_id),
    before: r.before ?? null,
    after: r.after ?? null,
  };
}

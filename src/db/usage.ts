import { sql } from "drizzle-orm";
import { getDb, type Db } from "./index";
import type { UsageChannel } from "@/lib/usage/record";
import {
  activityToUsage,
  buildFeatureUsage,
  type ActivityAggregateRow,
  type FeatureKind,
  ENTITY_PAGE,
  type FeatureUsage,
  type UsageAggregateRow,
} from "@/lib/usage/stats";

/** 某一頁近 30 天在網頁上做的寫入動作（activity_log 的 web 管道，依 entity_type 對回頁面）。 */
export type PageAction = { entityType: string; action: string; count: number };

export type UsageReport = {
  features: FeatureUsage[];
  /** route → 動作，次數多的在前。 */
  pageActions: Map<string, PageAction[]>;
};

function rowsOf<T>(res: unknown): T[] {
  if (Array.isArray(res)) return res as T[];
  return ((res as { rows?: T[] }).rows ?? []) as T[];
}

/**
 * 某組織的功能使用狀況（設定 › 功能使用狀況）。
 *
 * usage_events 依組織篩；organization_id 是 NULL 的（還沒選組織前呼叫的工具）歸給這個組織的成員。
 * activity_log 只取 usage_events 開始記錄之前的部分（各類型分開算起點），見 src/lib/usage/stats.ts。
 */
export async function getFeatureUsage(
  orgId: string,
  toolNames: readonly string[],
  db: Db = getDb(),
): Promise<UsageReport> {
  const scope = sql`(e.organization_id = ${orgId}
      or (e.organization_id is null
          and e.user_id in (select m.user_id from member m where m.organization_id = ${orgId})))`;

  const [usageRes, activityRes, actionsRes] = await Promise.all([
    db.execute(sql`
      select e.kind, e.feature, e.channel, e.user_id,
             count(*)::int as total,
             (count(*) filter (where e.created_at >= now() - interval '30 days'))::int as last30,
             to_json(max(e.created_at)) #>> '{}' as last_at
      from usage_events e
      where ${scope}
      group by e.kind, e.feature, e.channel, e.user_id`),
    db.execute(sql`
      with starts as (
        select
          min(e.created_at) filter (where e.kind = 'page') as page_start,
          min(e.created_at) filter (where e.kind = 'tool') as tool_start
        from usage_events e
        where ${scope}
      )
      select a.channel, a.entity_type, left(a.summary, 200) as summary, a.actor_user_id as user_id,
             count(*)::int as total,
             (count(*) filter (where a.created_at >= now() - interval '30 days'))::int as last30,
             to_json(max(a.created_at)) #>> '{}' as last_at
      from activity_log a, starts s
      where a.organization_id = ${orgId}
        and a.channel <> 'system'
        and a.created_at < case when a.channel = 'web'
                                then coalesce(s.page_start, 'infinity'::timestamptz)
                                else coalesce(s.tool_start, 'infinity'::timestamptz) end
      group by a.channel, a.entity_type, left(a.summary, 200), a.actor_user_id`),
    db.execute(sql`
      select a.entity_type, a.action, count(*)::int as n
      from activity_log a
      where a.organization_id = ${orgId}
        and a.channel = 'web'
        and a.created_at >= now() - interval '30 days'
      group by a.entity_type, a.action`),
  ]);

  type UsageSqlRow = {
    kind: FeatureKind;
    feature: string;
    channel: UsageChannel;
    user_id: string | null;
    total: number;
    last30: number;
    last_at: string;
  };
  type ActivitySqlRow = {
    channel: string;
    entity_type: string;
    summary: string | null;
    user_id: string | null;
    total: number;
    last30: number;
    last_at: string;
  };

  const usageRows: UsageAggregateRow[] = rowsOf<UsageSqlRow>(usageRes).map((r) => ({
    kind: r.kind,
    feature: r.feature,
    channel: r.channel,
    userId: r.user_id,
    total: Number(r.total),
    last30: Number(r.last30),
    lastAt: r.last_at,
  }));
  const activityRows: ActivityAggregateRow[] = rowsOf<ActivitySqlRow>(activityRes).map((r) => ({
    channel: r.channel,
    entityType: r.entity_type,
    summary: r.summary,
    userId: r.user_id,
    total: Number(r.total),
    last30: Number(r.last30),
    lastAt: r.last_at,
  }));

  const pageActions = new Map<string, PageAction[]>();
  for (const r of rowsOf<{ entity_type: string; action: string; n: number }>(actionsRes)) {
    const page = ENTITY_PAGE[r.entity_type];
    if (!page) continue;
    const list = pageActions.get(page) ?? [];
    list.push({ entityType: r.entity_type, action: r.action, count: Number(r.n) });
    pageActions.set(page, list);
  }
  for (const list of pageActions.values()) list.sort((a, b) => b.count - a.count);

  return {
    features: buildFeatureUsage(
      [...usageRows, ...activityToUsage(activityRows, new Set(toolNames))],
      toolNames,
    ),
    pageActions,
  };
}

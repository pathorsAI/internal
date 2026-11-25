import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/page-header";
import { StatusTag } from "@/components/ds/status-dot";
import { EmptyRow } from "@/components/empty-state";
import { TableCard } from "@/components/table-card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getFeatureUsage, type PageAction } from "@/db/usage";
import { humanTitle, isReadOnlyTool } from "@/lib/mcp/handler";
import { tools } from "@/lib/mcp/tools";
import { formatDateTime } from "@/lib/format";
import { canManageOrg, requireOrgWithRole } from "@/lib/session";
import { usageTrackingEnabled } from "@/lib/usage/record";
import { FEATURE_CATEGORIES, categoryOf, type FeatureCategory } from "@/lib/usage/categories";
import type { FeatureUsage, UsageStatus } from "@/lib/usage/stats";
import { cn } from "@/lib/utils";
import { SettingsBody } from "../settings-body";

export const dynamic = "force-dynamic";

type LooseT = { (key: string, values?: Record<string, string | number>): string; has(key: string): boolean };

const FILTERS = ["attention", "never", "idle", "all"] as const;
type Filter = (typeof FILTERS)[number];
const KINDS = ["all", "page", "tool"] as const;
type KindFilter = (typeof KINDS)[number];

const STATUS_TONE: Record<UsageStatus, "neutral" | "warning" | "income"> = {
  never: "neutral",
  idle: "warning",
  active: "income",
};

/** 路由 → messages/usage.ts 的 pages 鍵：去掉 /dashboard、斜線換底線、[id] 換 id。 */
function pageKey(route: string): string {
  const rest = route.replace(/^\/dashboard\/?/, "");
  return rest === "" ? "home" : rest.replaceAll("[id]", "id").replaceAll("/", "_");
}

function matchesFilter(row: FeatureUsage, filter: Filter, kind: KindFilter): boolean {
  if (kind !== "all" && row.kind !== kind) return false;
  if (filter === "all") return true;
  if (filter === "attention") return row.status !== "active";
  return row.status === filter;
}

function pick<T extends string>(value: string | undefined, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly string[]).includes(value ?? "") ? (value as T) : fallback;
}

export default async function UsageSettingsPage({
  searchParams,
}: Readonly<{ searchParams: Promise<{ filter?: string; kind?: string }> }>) {
  const t = await getTranslations("usage");
  // 動態鍵（頁面、動作、對象）用寬鬆的型別查：逐一展開 next-intl 的鍵型別會讓 tsc 慢到爆記憶體。
  const ta = (await getTranslations("activity")) as unknown as LooseT;
  const tl = t as unknown as LooseT;
  const { orgId, role } = await requireOrgWithRole();
  const params = await searchParams;
  const filter = pick(params.filter, FILTERS, "attention");
  const kind = pick(params.kind, KINDS, "all");

  if (!canManageOrg(role)) {
    return (
      <>
        <PageHeader title={t("title")} />
        <SettingsBody>
          <p className="text-sm text-muted-foreground">{t("ownerOnly")}</p>
        </SettingsBody>
      </>
    );
  }

  const toolNames = Object.keys(tools).sort((a, b) => a.localeCompare(b));
  let rows: FeatureUsage[] = [];
  let pageActions = new Map<string, PageAction[]>();
  let loadFailed = false;
  try {
    ({ features: rows, pageActions } = await getFeatureUsage(orgId, toolNames));
  } catch (e) {
    console.error("[usage] failed to load feature usage", e);
    loadFailed = true;
  }
  const visible = rows.filter((r) => matchesFilter(r, filter, kind));
  const byUse = (a: FeatureUsage, b: FeatureUsage) => b.last30 - a.last30 || b.users30 - a.users30;
  const topPages = rows.filter((r) => r.kind === "page" && r.last30 > 0).sort(byUse);
  const topTools = rows.filter((r) => r.kind === "tool" && r.last30 > 0).sort(byUse);
  const toolCategoryTotals = categoryTotals(topTools);
  const pageLabel = (route: string) => tl(`pages.${pageKey(route)}`);
  const categoryLabel = (c: FeatureCategory | null) => (c ? tl(`category.${c}`) : "—");
  const actionLabel = (a: PageAction) =>
    tl("actionLabel", {
      action: ta.has(`action.${a.action}`) ? ta(`action.${a.action}`) : a.action,
      entity: ta.has(`entity.${a.entityType}`) ? ta(`entity.${a.entityType}`) : a.entityType,
    });
  const href = (next: { filter?: Filter; kind?: KindFilter }) => {
    const q = new URLSearchParams({ filter: next.filter ?? filter, kind: next.kind ?? kind });
    return `/dashboard/settings/usage?${q.toString()}`;
  };

  return (
    <>
      <PageHeader title={t("title")} />
      <SettingsBody>
        {usageTrackingEnabled() ? null : <p className="text-sm text-warning">{t("disabled")}</p>}
        {loadFailed ? <p className="text-sm text-destructive">{t("loadFailed")}</p> : null}

        <TableCard title={t("topPages.title")}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("columns.feature")}</TableHead>
                <TableHead>{t("columns.category")}</TableHead>
                <TableHead className="text-right">{t("topPages.views")}</TableHead>
                <TableHead className="text-right">{t("topPages.users")}</TableHead>
                <TableHead>{t("topPages.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {topPages.length === 0 ? (
                <EmptyRow colSpan={5} message={t("topPages.empty")} />
              ) : (
                topPages.map((r) => {
                  const actions = pageActions.get(r.feature) ?? [];
                  return (
                    <TableRow key={r.feature} className="align-top">
                      <TableCell className="min-w-[14rem]">
                        <FeatureName row={r} label={pageLabel(r.feature)} />
                      </TableCell>
                      <TableCell className="text-muted-foreground">{categoryLabel(categoryOf("page", r.feature))}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.last30}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.users30}</TableCell>
                      <TableCell className="min-w-[14rem]">
                        {actions.length === 0 ? (
                          <span className="text-xs text-muted-foreground">{t("topPages.noActions")}</span>
                        ) : (
                          <details>
                            <summary className="cursor-pointer text-sm text-primary">
                              {t("topPages.actionsToggle", { count: actions.length })}
                            </summary>
                            <ul className="mt-2 flex flex-col gap-1 text-sm">
                              {actions.map((a) => (
                                <li key={`${a.entityType}:${a.action}`} className="flex justify-between gap-4">
                                  <span>{actionLabel(a)}</span>
                                  <span className="tabular-nums text-muted-foreground">{a.count}</span>
                                </li>
                              ))}
                            </ul>
                          </details>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </TableCard>

        <TableCard
          title={t("topTools.title")}
          action={
            toolCategoryTotals.length === 0
              ? null
              : `${t("topTools.byCategory")}：${toolCategoryTotals
                  .map(([c, n]) => `${categoryLabel(c)} ${n}`)
                  .join(" · ")}`
          }
        >
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("columns.feature")}</TableHead>
                <TableHead>{t("topTools.category")}</TableHead>
                <TableHead>{t("topTools.access")}</TableHead>
                <TableHead className="text-right">{t("topTools.calls")}</TableHead>
                <TableHead className="text-right">{t("topTools.users")}</TableHead>
                <TableHead>{t("columns.channel")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {topTools.length === 0 ? (
                <EmptyRow colSpan={6} message={t("topTools.empty")} />
              ) : (
                topTools.map((r) => (
                  <TableRow key={r.feature}>
                    <TableCell className="min-w-[14rem]">
                      <FeatureName row={r} label={humanTitle(r.feature)} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">{categoryLabel(categoryOf("tool", r.feature))}</TableCell>
                    <TableCell>
                      <StatusTag tone={isReadOnlyTool(r.feature) ? "neutral" : "primary"}>
                        {isReadOnlyTool(r.feature) ? t("topTools.read") : t("topTools.write")}
                      </StatusTag>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{r.last30}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.users30}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {r.primaryChannel ? tl(`channel.${r.primaryChannel}`) : "—"}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableCard>

        <h2 className="text-sm font-medium text-muted-foreground">{t("allFeatures")}</h2>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            label={t("filter.label")}
            items={FILTERS.map((f) => ({ key: f, label: tl(`filter.${f}`), href: href({ filter: f }) }))}
            current={filter}
          />
          <Segmented
            label={t("columns.kind")}
            items={KINDS.map((k) => ({ key: k, label: tl(`kindFilter.${k}`), href: href({ kind: k }) }))}
            current={kind}
          />
        </div>

        <TableCard action={t("rowCount", { count: visible.length })}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("columns.feature")}</TableHead>
                <TableHead>{t("columns.kind")}</TableHead>
                <TableHead>{t("columns.category")}</TableHead>
                <TableHead>{t("columns.status")}</TableHead>
                <TableHead>{t("columns.lastUsed")}</TableHead>
                <TableHead className="text-right">{t("columns.count30")}</TableHead>
                <TableHead className="text-right">{t("columns.users30")}</TableHead>
                <TableHead>{t("columns.channel")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.length === 0 ? (
                <EmptyRow colSpan={8} message={t("empty")} />
              ) : (
                visible.map((r) => (
                  <TableRow key={`${r.kind}:${r.feature}`}>
                    <TableCell className="min-w-[16rem]">
                      <FeatureName row={r} label={r.kind === "page" ? pageLabel(r.feature) : humanTitle(r.feature)} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">{tl(`kind.${r.kind}`)}</TableCell>
                    <TableCell className="text-muted-foreground">{categoryLabel(categoryOf(r.kind, r.feature))}</TableCell>
                    <TableCell>
                      <StatusTag tone={STATUS_TONE[r.status]}>{tl(`status.${r.status}`)}</StatusTag>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground tabular-nums">
                      {r.lastAt ? formatDateTime(r.lastAt) : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{r.last30}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.users30}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {r.primaryChannel ? tl(`channel.${r.primaryChannel}`) : "—"}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableCard>
        <p className="text-xs text-muted-foreground">{t("note")}</p>
      </SettingsBody>
    </>
  );
}

/** 各分類近 30 天的呼叫次數，多的在前；沒用到的分類不列。 */
function categoryTotals(rows: readonly FeatureUsage[]): [FeatureCategory, number][] {
  const totals = new Map<FeatureCategory, number>();
  for (const r of rows) {
    const c = categoryOf(r.kind, r.feature);
    if (c) totals.set(c, (totals.get(c) ?? 0) + r.last30);
  }
  return FEATURE_CATEGORIES.filter((c) => totals.has(c))
    .map((c): [FeatureCategory, number] => [c, totals.get(c) ?? 0])
    .sort((a, b) => b[1] - a[1]);
}

function FeatureName({ row, label }: Readonly<{ row: FeatureUsage; label: string }>) {
  return (
    <div className="flex flex-col">
      <span className="font-medium">{label}</span>
      <code className="text-xs text-muted-foreground">{row.feature}</code>
    </div>
  );
}

/** 分段切換（跟發票頁的方向切換同一個樣式）：選中的一段用淺底。 */
function Segmented({
  label,
  items,
  current,
}: Readonly<{ label: string; items: { key: string; label: string; href: string }[]; current: string }>) {
  return (
    <nav aria-label={label} className="inline-flex w-fit gap-0.5 rounded-md border bg-card p-0.5">
      {items.map((item) => (
        <Button
          key={item.key}
          asChild
          size="sm"
          variant="ghost"
          aria-current={current === item.key ? "page" : undefined}
          className={cn("h-7 text-muted-foreground", current === item.key && "bg-accent text-foreground hover:bg-accent")}
        >
          <Link href={item.href}>{item.label}</Link>
        </Button>
      ))}
    </nav>
  );
}

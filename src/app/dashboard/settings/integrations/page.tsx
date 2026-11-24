import { eq } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { getDb } from "@/db";
import { organization } from "@/db/auth-schema";
import { PageHeader } from "@/components/page-header";
import { canManageOrg, requireOrgWithRole } from "@/lib/session";
import {
  getCalendarOwnerLabel,
  getCalendarSettings,
  hasCalendarGrant,
} from "@/lib/google-calendar";
import { formatDate, formatDateTime } from "@/lib/format";
import { INTEGRATION_CATALOG, INTEGRATION_ORDER } from "@/lib/integrations/catalog";
import { getProvider } from "@/lib/integrations/registry";
import { listIntegrations } from "@/lib/integrations/store";
import {
  isIntegrationProviderId,
  type IntegrationConfig,
  type IntegrationProviderId,
} from "@/lib/integrations/types";
import {
  isAutoSyncOn,
  parseLastAutoSync,
  supportsAutoSync,
} from "@/lib/integrations/autosync-config";
import { IntegrationsList, type IntegrationRowData } from "./integrations-client";
import { CalendarSettingsClient } from "./calendar-settings-client";
import { WiseMappingSection } from "./wise-mapping-client";
import { loadWiseMappingView } from "./wise-mapping-data";
import { CloudBillingScopeSection } from "./cloud-billing-scope-client";
import { loadCloudScopeView } from "./cloud-billing-scope-data";
import { SettingsBody } from "../settings-body";

export const dynamic = "force-dynamic";

/** 自動同步時間一律顯示台北時間（Worker 的時區是 UTC）：YYYY-MM-DD HH:mm。 */
function formatTaipeiMinute(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}

/** 列上「自動同步」開關與上次結果；不支援自動同步的整合回 null。 */
function autoSyncView(
  id: IntegrationProviderId,
  config: IntegrationConfig,
): NonNullable<IntegrationRowData["connection"]>["autoSync"] {
  if (!supportsAutoSync(id)) return null;
  const last = parseLastAutoSync(config);
  return {
    on: isAutoSyncOn(config),
    last: last
      ? {
          at: formatTaipeiMinute(last.at),
          ok: last.ok,
          error: last.error,
          manual: last.trigger === "manual",
        }
      : null,
  };
}

/**
 * `?connect=<provider>`（MCP 的 get_integration_connect_link 產生）：直接打開那個整合的連接視窗。
 * 連結帶的 `org` 跟目前組織不同時不打開 —— 憑證不能輸入到別的組織 —— 改顯示提示請使用者先切換。
 */
async function resolveConnectParam(
  orgId: string,
  canManage: boolean,
  params: Record<string, string | string[] | undefined>,
): Promise<{ connect: IntegrationProviderId | null; otherOrg: string | null }> {
  const connect = typeof params.connect === "string" ? params.connect : null;
  if (!connect || !isIntegrationProviderId(connect) || !canManage) return { connect: null, otherOrg: null };
  const org = typeof params.org === "string" ? params.org : null;
  if (!org || org === orgId) return { connect, otherOrg: null };
  const [row] = await getDb()
    .select({ slug: organization.slug })
    .from(organization)
    .where(eq(organization.id, orgId))
    .limit(1);
  return row?.slug === org ? { connect, otherOrg: null } : { connect: null, otherOrg: org };
}

export default async function IntegrationsPage({
  searchParams,
}: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>) {
  const t = await getTranslations("integrations");
  const { orgId, userId, role } = await requireOrgWithRole();
  const canManage = canManageOrg(role);
  const deepLink = await resolveConnectParam(orgId, canManage, await searchParams);
  const [summaries, calendar, granted, calendarOwner] = await Promise.all([
    listIntegrations(orgId),
    getCalendarSettings(orgId),
    hasCalendarGrant(userId),
    getCalendarOwnerLabel(orgId),
  ]);

  // 只把「可以顯示」的東西交給 client：IntegrationSummary 本來就不含密文，這裡再把
  // 日期先格式化好（server 與 client 時區不同，交給 client 格式化會 hydration mismatch）。
  const rows: IntegrationRowData[] = INTEGRATION_ORDER.map((id) => {
    const s = summaries.find((x) => x.provider === id) ?? null;
    return {
      id,
      logo: INTEGRATION_CATALOG[id].logo,
      credentialFields: INTEGRATION_CATALOG[id].credentialFields.map((f) => ({ ...f })),
      configFields: (INTEGRATION_CATALOG[id].configFields ?? []).map((f) => ({ ...f })),
      implemented: getProvider(id) !== null,
      connection: s
        ? {
            enabled: s.enabled,
            status: s.status,
            connectedAt: formatDate(s.connectedAt),
            connectedByName: s.connectedByName,
            lastSyncedAt: s.lastSyncedAt ? formatDateTime(s.lastSyncedAt) : null,
            lastError: s.lastError,
            autoSync: autoSyncView(id, s.config),
          }
        : null,
    };
  });

  const calendarConnected = Boolean(calendar?.ownerUserId && calendar?.googleCalendarId);
  const wiseSummary = summaries.find((x) => x.provider === "wise") ?? null;
  const wiseView = wiseSummary ? await loadWiseMappingView(orgId, wiseSummary) : null;
  const cloudViews = (["azure", "gcp"] as const).flatMap((p) => {
    const s = summaries.find((x) => x.provider === p);
    const view = s ? loadCloudScopeView(orgId, s) : null;
    return view ? [view] : [];
  });

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <SettingsBody>
        <IntegrationsList
          rows={rows}
          canRunAutoSync={canManage && rows.some((r) => r.connection?.autoSync)}
          canManage={canManage}
          calendar={{ connected: calendarConnected, ownerLabel: calendarOwner }}
          initialConnect={deepLink.connect}
          connectLinkOtherOrg={deepLink.otherOrg}
        />
        {wiseView ? (
          <section id="wise" className="scroll-mt-20">
            <WiseMappingSection
              key={wiseView.key}
              balances={wiseView.balances}
              accounts={wiseView.accounts}
              suggestions={wiseView.suggestions}
              canManage={canManage}
              enabled={wiseView.enabled}
            />
          </section>
        ) : null}
        {cloudViews.map((view) => (
          <section key={view.provider} id={view.provider} className="scroll-mt-20">
            {/* 存檔 / 重新探索後重掛，讓勾選回到存檔後的狀態 */}
            <CloudBillingScopeSection
              key={JSON.stringify([view.selected, view.candidates.map((c) => c.id), view.bigQuery])}
              view={view}
              canManage={canManage}
            />
          </section>
        ))}
        <section id="google-calendar" className="scroll-mt-20">
          <CalendarSettingsClient
            connected={calendarConnected}
            granted={granted}
            reminderDays={calendar?.reminderDays ?? 3}
            canManage={canManage}
            ownerLabel={calendarOwner}
            isOwner={calendar?.ownerUserId === userId}
          />
        </section>
      </SettingsBody>
    </>
  );
}

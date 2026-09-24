import { getTranslations } from "next-intl/server";
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
import { IntegrationsList, type IntegrationRowData } from "./integrations-client";
import { CalendarSettingsClient } from "./calendar-settings-client";

export const dynamic = "force-dynamic";

export default async function IntegrationsPage() {
  const t = await getTranslations("integrations");
  const { orgId, userId, role } = await requireOrgWithRole();
  const canManage = canManageOrg(role);
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
          }
        : null,
    };
  });

  const calendarConnected = Boolean(calendar?.ownerUserId && calendar?.googleCalendarId);

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <IntegrationsList
        rows={rows}
        canManage={canManage}
        calendar={{ connected: calendarConnected, ownerLabel: calendarOwner }}
      />
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
    </>
  );
}

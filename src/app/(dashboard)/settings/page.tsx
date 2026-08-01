import { PageHeader } from "@/components/page-header";
import { requireOrg } from "@/lib/session";
import { getCalendarSettings, hasCalendarGrant } from "@/lib/google-calendar";
import { OrgSettingsClient } from "./org-settings-client";
import { CalendarSettingsClient } from "./calendar-settings-client";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  // Guard: redirects to /login or /onboarding when needed.
  const { orgId, userId } = await requireOrg();
  const [calendar, granted] = await Promise.all([
    getCalendarSettings(orgId),
    hasCalendarGrant(userId),
  ]);

  return (
    <>
      <PageHeader title="組織設定" description="管理這個組織的基本資料與整合" />
      <OrgSettingsClient />
      <CalendarSettingsClient
        connected={Boolean(calendar?.ownerUserId && calendar?.googleCalendarId)}
        granted={granted}
        reminderDays={calendar?.reminderDays ?? 3}
      />
    </>
  );
}

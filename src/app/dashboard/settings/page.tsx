import { eq } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/page-header";
import { canManageOrg, requireOrgWithRole } from "@/lib/session";
import { getDb } from "@/db";
import { organization } from "@/db/auth-schema";
import {
  getCalendarOwnerLabel,
  getCalendarSettings,
  hasCalendarGrant,
} from "@/lib/google-calendar";
import { OrgSettingsClient } from "./org-settings-client";
import { CalendarSettingsClient } from "./calendar-settings-client";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const t = await getTranslations("settings");
  // Guard: redirects to /login or /onboarding when needed.
  const { orgId, userId, role } = await requireOrgWithRole();
  const [calendar, granted, ownerLabel, orgRow] = await Promise.all([
    getCalendarSettings(orgId),
    hasCalendarGrant(userId),
    getCalendarOwnerLabel(orgId),
    getDb()
      .select({ name: organization.name })
      .from(organization)
      .where(eq(organization.id, orgId))
      .limit(1),
  ]);

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <OrgSettingsClient
        orgId={orgId}
        orgName={orgRow[0]?.name ?? ""}
        canEdit={canManageOrg(role)}
      />
      <CalendarSettingsClient
        connected={Boolean(calendar?.ownerUserId && calendar?.googleCalendarId)}
        granted={granted}
        reminderDays={calendar?.reminderDays ?? 3}
        canManage={canManageOrg(role)}
        ownerLabel={ownerLabel}
        isOwner={calendar?.ownerUserId === userId}
      />
    </>
  );
}

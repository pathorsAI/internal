import { eq } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/page-header";
import { canManageOrg, requireOrgWithRole } from "@/lib/session";
import { getDb } from "@/db";
import { organization } from "@/db/auth-schema";
import { OrgSettingsClient } from "./org-settings-client";

export const dynamic = "force-dynamic";

// Google 日曆的設定已搬到 設定 › 整合（./integrations），與其他外部整合列在一起。
export default async function SettingsPage() {
  const t = await getTranslations("settings");
  // Guard: redirects to /login or /onboarding when needed.
  const { orgId, role } = await requireOrgWithRole();
  const orgRow = await getDb()
    .select({ name: organization.name })
    .from(organization)
    .where(eq(organization.id, orgId))
    .limit(1);

  return (
    <>
      <PageHeader title={t("title")} description={t("description")} />
      <OrgSettingsClient
        orgId={orgId}
        orgName={orgRow[0]?.name ?? ""}
        canEdit={canManageOrg(role)}
      />
    </>
  );
}

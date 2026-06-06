import { PageHeader } from "@/components/page-header";
import { requireOrg } from "@/lib/session";
import { OrgSettingsClient } from "./org-settings-client";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  // Guard: redirects to /login or /onboarding when needed.
  await requireOrg();

  return (
    <>
      <PageHeader title="組織設定" description="管理這個組織的基本資料" />
      <OrgSettingsClient />
    </>
  );
}

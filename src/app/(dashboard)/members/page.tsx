import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/page-header";
import { requireOrg } from "@/lib/session";
import { MembersClient } from "./members-client";

export const dynamic = "force-dynamic";

export default async function MembersPage() {
  const t = await getTranslations("members");
  // Guard: redirects to /login or /onboarding when needed.
  await requireOrg();

  return (
    <>
      <PageHeader
        title={t("title")}
        description={t("description")}
      />
      <MembersClient />
    </>
  );
}

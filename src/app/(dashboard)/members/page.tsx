import { PageHeader } from "@/components/page-header";
import { requireOrg } from "@/lib/session";
import { MembersClient } from "./members-client";

export const dynamic = "force-dynamic";

export default async function MembersPage() {
  // Guard: redirects to /login or /onboarding when needed.
  await requireOrg();

  return (
    <>
      <PageHeader
        title="成員"
        description="邀請同事加入這個組織，或管理現有成員"
      />
      <MembersClient />
    </>
  );
}

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";

export async function getSession() {
  return auth.api.getSession({ headers: await headers() });
}

/**
 * Server-side guard for dashboard pages/actions: returns the logged-in session
 * plus the active organization id to scope every query/mutation by.
 * Redirects to /login when unauthenticated and /onboarding when the user has
 * no organization yet.
 */
export async function requireOrg() {
  const session = await getSession();
  if (!session) redirect("/login");

  let orgId = session.session.activeOrganizationId;
  // No active org on the session (e.g. just accepted an invite, or the session
  // predates org membership). Fall back to the user's first membership and make
  // it active instead of forcing them through onboarding. Only truly org-less
  // users are sent to /onboarding.
  if (!orgId) {
    const reqHeaders = await headers();
    const orgs = await auth.api.listOrganizations({ headers: reqHeaders });
    const first = orgs?.[0];
    if (!first) redirect("/onboarding");
    await auth.api.setActiveOrganization({
      headers: reqHeaders,
      body: { organizationId: first.id },
    });
    orgId = first.id;
  }

  return { session, orgId, userId: session.user.id };
}

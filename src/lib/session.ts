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

  const orgId = session.session.activeOrganizationId;
  if (!orgId) redirect("/onboarding");

  return { session, orgId, userId: session.user.id };
}

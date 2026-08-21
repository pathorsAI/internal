import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { member } from "@/db/auth-schema";
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

/**
 * 這位使用者在指定組織裡的角色（owner / admin / member），不是成員則回 null。
 * 客戶端有 better-auth 的 useActiveMember() 可用，但 server action 不能只信客戶端
 * 傳來的角色 —— 隱藏按鈕擋得住誤按，擋不住直接呼叫 action。
 */
export async function getOrgRole(orgId: string, userId: string): Promise<string | null> {
  const [row] = await getDb()
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.organizationId, orgId), eq(member.userId, userId)))
    .limit(1);
  return row?.role ?? null;
}

/** 能不能改組織層級的設定（成員管理、整合設定這類）。 */
export function canManageOrg(role: string | null): boolean {
  return role === "owner" || role === "admin";
}

/** requireOrg() 再加上呼叫者的角色，給需要判斷權限的 server action 用。 */
export async function requireOrgWithRole() {
  const base = await requireOrg();
  return { ...base, role: await getOrgRole(base.orgId, base.userId) };
}

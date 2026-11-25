import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { member } from "@/db/auth-schema";
import { getCurrentOrgId, resolveCurrentOrgId } from "@/db/current-org";
import { auth } from "@/lib/auth";
import { USAGE_ROUTE_HEADER, recordPageView } from "@/lib/usage/record";
import { isDashboardRoute } from "@/lib/usage/routes";

/**
 * 目前登入的 session。dashboard 頁面載入時（src/proxy.ts 標了 USAGE_ROUTE_HEADER）順便記一筆
 * 功能使用紀錄：只記路由 pattern，寫入排在回應之後，失敗不影響頁面（src/lib/usage/record.ts）。
 * layout 與 page 各呼叫一次也只記一筆（30 秒去重）。
 */
export async function getSession() {
  const reqHeaders = await headers();
  const session = await auth.api.getSession({ headers: reqHeaders });
  // proxy 的 matcher 沒涵蓋的路徑（例如 /signup）不會清掉外部送來的 header，所以再確認一次
  // 它是一個已知頁面的 pattern，不讓任意字串寫進統計。
  const route = reqHeaders.get(USAGE_ROUTE_HEADER);
  if (session && route && isDashboardRoute(route)) {
    const userId = session.user.id;
    const active = session.session.activeOrganizationId ?? null;
    recordPageView({
      route,
      userId,
      // 跟 resolveSessionOrgId 同一個順序（目前的組織 → session 的 active org），但只讀不寫，
      // 在回應送出後才查；查不到就記 NULL，統計時依成員資格歸戶。
      resolveOrg: async () => (await getCurrentOrgId(userId)) ?? active,
    });
  }
  return session;
}

/**
 * 這個 session 該在哪個組織（每個 request 只算一次，layout 與頁面共用）。
 *
 * 以使用者「目前的組織」（"user".current_org_id，src/db/current-org.ts）為準：在另一台裝置、
 * LINE 或 MCP 切過組織，這裡的 session 下一次 request 就跟著換過去，組織切換器第一屏就是對的。
 * current_org_id 沒設或已不是成員時，沿用 session 自己的 active org；兩個都沒有才退回
 * 最早加入的組織。和 session 不一致時順手把 session 的 active org 改成它。
 * 一個組織都沒有回 null。
 */
export function resolveSessionOrgId(session: {
  user: { id: string };
  session: { activeOrganizationId?: string | null };
}): Promise<string | null> {
  return sessionOrgId(session.user.id, session.session.activeOrganizationId ?? null);
}

// react cache 以參數值當 key：同一個 request 裡 layout 與頁面各自 getSession() 拿到的是不同物件，
// 所以 key 用 userId + active org 這兩個字串，不用 session 物件本身。
const sessionOrgId = cache(
  async (userId: string, active: string | null): Promise<string | null> => {
    const orgId = (await getCurrentOrgId(userId)) ?? active ?? (await resolveCurrentOrgId(userId));
    if (orgId && orgId !== active) {
      try {
        await auth.api.setActiveOrganization({
          headers: await headers(),
          body: { organizationId: orgId },
        });
      } catch (err) {
        // 補設 session 失敗不擋畫面：這次 request 照樣用 orgId，下次再試。
        console.error("[session] setActiveOrganization failed", err);
      }
    }
    return orgId;
  },
);

/**
 * Server-side guard for dashboard pages/actions: returns the logged-in session
 * plus the active organization id to scope every query/mutation by.
 * Redirects to /login when unauthenticated and /onboarding when the user has
 * no organization yet.
 */
export async function requireOrg() {
  const session = await getSession();
  if (!session) redirect("/login");

  // 組織以使用者的「目前的組織」為準（見 resolveSessionOrgId）；只有真的一個組織都沒有的人
  // 才送去 /onboarding（例如剛接受邀請、session 還沒有 active org 的人會直接落在新組織）。
  const orgId = await resolveSessionOrgId(session);
  if (!orgId) redirect("/onboarding");

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

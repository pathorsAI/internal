import { and, asc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { member, organization, user } from "@/db/auth-schema";

/**
 * 每位使用者一個「目前的組織」（migrations/0046 的 "user".current_org_id）。
 *
 * 網頁的組織切換器、站內 AI、LINE／WhatsApp、MCP 共用這一個值：在網頁切到東蜂，
 * 下一段 MCP 對話、下一則 LINE 訊息也就在東蜂，不再每次問「要用哪個組織」。
 * 讀的時候一律再對一次成員資格 —— 被移出組織之後，殘留的 current_org_id 不算數。
 */

/** 這個人所屬的一個組織（含角色）。依加入時間排序，最早的在前。 */
export type UserOrg = {
  id: string;
  name: string;
  slug: string | null;
  /** organization.logo：上傳過 logo 時是 /api/orgs/<id>/logo?v=…，沒有是 null。 */
  logo: string | null;
  role: string;
};

/**
 * 沒有指定組織時要用哪一個（純函式，順序就是規格）：
 * 1. 目前的組織（而且還是成員）
 * 2. 只屬於一個組織 → 那一個
 * 3. 否則 → 最早加入的那一個（memberships 已依加入時間排序）
 * 一個組織都沒有才回 null。絕不因為「有好幾個」就丟錯。
 */
export function pickCurrentOrg(
  memberships: readonly { id: string }[],
  currentOrgId: string | null | undefined,
): string | null {
  if (currentOrgId && memberships.some((m) => m.id === currentOrgId)) return currentOrgId;
  return memberships[0]?.id ?? null;
}

/** 這個人所屬的全部組織（含角色、logo），最早加入的在前。 */
export async function listUserOrgsWithRoles(userId: string): Promise<UserOrg[]> {
  return getDb()
    .select({
      id: organization.id,
      name: organization.name,
      slug: organization.slug,
      logo: organization.logo,
      role: member.role,
    })
    .from(member)
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .where(eq(member.userId, userId))
    .orderBy(asc(member.createdAt));
}

/** 存著的 current_org_id（不檢查成員資格；要檢查用 getCurrentOrgId）。 */
async function storedCurrentOrgId(userId: string): Promise<string | null> {
  const [row] = await getDb()
    .select({ currentOrgId: user.currentOrgId })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  return row?.currentOrgId ?? null;
}

/** 目前的組織：有設、而且還是成員才回，否則 null。 */
export async function getCurrentOrgId(userId: string): Promise<string | null> {
  const [row] = await getDb()
    .select({ orgId: user.currentOrgId })
    .from(user)
    .innerJoin(
      member,
      and(eq(member.userId, user.id), eq(member.organizationId, user.currentOrgId)),
    )
    .where(eq(user.id, userId))
    .limit(1);
  return row?.orgId ?? null;
}

/**
 * 沒指定組織時實際要用的組織（pickCurrentOrg 的順序），連同這個人的全部組織一起回，
 * 呼叫端常常兩個都要（列組織、判斷角色）。一個組織都沒有時 orgId = null。
 */
export async function resolveCurrentOrg(
  userId: string,
): Promise<{ orgId: string | null; orgs: UserOrg[] }> {
  const [orgs, stored] = await Promise.all([listUserOrgsWithRoles(userId), storedCurrentOrgId(userId)]);
  return { orgId: pickCurrentOrg(orgs, stored), orgs };
}

/** 只要 id 的版本。 */
export async function resolveCurrentOrgId(userId: string): Promise<string | null> {
  return (await resolveCurrentOrg(userId)).orgId;
}

/**
 * 設定目前的組織。不是成員就不寫、回 false（不能把別人的組織設成自己的）。
 * 寫失敗不該擋住呼叫端的主流程，呼叫端自己決定要不要吞錯。
 */
export async function setCurrentOrgId(userId: string, orgId: string): Promise<boolean> {
  const db = getDb();
  const [m] = await db
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.userId, userId), eq(member.organizationId, orgId)))
    .limit(1);
  if (!m) return false;
  await db.update(user).set({ currentOrgId: orgId }).where(eq(user.id, userId));
  return true;
}

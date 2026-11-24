/**
 * bot 需要的幾個小查詢：組織名稱、使用者名稱、這個人在哪些組織。
 * 只讀 better-auth 的 organization／member／user 表，不碰帳務資料。
 */
import { asc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { member, organization, user } from "@/db/auth-schema";

export async function getOrgName(orgId: string): Promise<string | null> {
  const [row] = await getDb()
    .select({ name: organization.name })
    .from(organization)
    .where(eq(organization.id, orgId))
    .limit(1);
  return row?.name ?? null;
}

export async function getUserName(userId: string): Promise<string | null> {
  const [row] = await getDb().select({ name: user.name }).from(user).where(eq(user.id, userId)).limit(1);
  return row?.name ?? null;
}

/** 這個人所屬的組織（切換組織選單用），依名稱排序。 */
export async function listUserOrgs(userId: string): Promise<{ id: string; name: string }[]> {
  return getDb()
    .select({ id: organization.id, name: organization.name })
    .from(member)
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .where(eq(member.userId, userId))
    .orderBy(asc(organization.name));
}

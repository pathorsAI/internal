import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { member, organization, user } from "@/db/auth-schema";
import { deleteDocument, getObjectStream, putObject } from "@/lib/storage";
import type { OwnerAvatarDeps } from "./owner-avatar-store";

/** 正式環境的 deps：Postgres + 物件儲存（src/lib/storage，R2 / S3 / 本機檔案皆可）。 */
export function ownerAvatarDeps(): OwnerAvatarDeps {
  return {
    async load(kind, id) {
      const db = getDb();
      if (kind === "org") {
        const [row] = await db
          .select({ id: organization.id, avatarKey: organization.logoKey })
          .from(organization)
          .where(eq(organization.id, id))
          .limit(1);
        return row ?? null;
      }
      const [row] = await db
        .select({ id: user.id, avatarKey: user.avatarKey })
        .from(user)
        .where(eq(user.id, id))
        .limit(1);
      return row ?? null;
    },
    async save(kind, id, key, url) {
      const db = getDb();
      const rows =
        kind === "org"
          ? await db
              .update(organization)
              .set({ logoKey: key, logo: url })
              .where(eq(organization.id, id))
              .returning({ id: organization.id })
          : await db
              .update(user)
              .set({ avatarKey: key, image: url, updatedAt: new Date() })
              .where(eq(user.id, id))
              .returning({ id: user.id });
      return rows.length > 0;
    },
    putObject,
    deleteObject: deleteDocument,
    getObject: getObjectStream,
    now: () => new Date(),
  };
}

/** 呼叫者是不是這個組織的成員（看組織 logo 的條件）。 */
export async function isOrgMember(userId: string, orgId: string): Promise<boolean> {
  const [row] = await getDb()
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.userId, userId), eq(member.organizationId, orgId)))
    .limit(1);
  return Boolean(row);
}

/**
 * 呼叫者能不能看這位使用者的頭像：本人，或兩人至少同在一個組織（操作紀錄、成員清單會看到彼此）。
 * 不同組織的人拿 id 來猜只會得到 404。
 */
export async function sharesOrgWith(viewerId: string, targetId: string): Promise<boolean> {
  if (viewerId === targetId) return true;
  const db = getDb();
  const mine = db.select({ orgId: member.organizationId }).from(member).where(eq(member.userId, viewerId));
  const [row] = await db
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.userId, targetId), inArray(member.organizationId, mine)))
    .limit(1);
  return Boolean(row);
}

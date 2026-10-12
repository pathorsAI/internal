import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db";
import { parties } from "@/db/schema";
import { deleteDocument, getObjectStream, putObject } from "@/lib/storage";
import type { PartyAvatarDeps } from "./party-avatar-store";

/** 正式環境的 deps：Neon + R2。每個查詢都帶 organization_id 與未刪除條件。 */
export function partyAvatarDeps(): PartyAvatarDeps {
  return {
    async loadParty(orgId, partyId) {
      const [row] = await getDb()
        .select({
          id: parties.id,
          organizationId: parties.organizationId,
          avatarR2Key: parties.avatarR2Key,
        })
        .from(parties)
        .where(and(eq(parties.organizationId, orgId), eq(parties.id, partyId), isNull(parties.deletedAt)))
        .limit(1);
      return row ?? null;
    },
    async saveAvatar(orgId, partyId, key, updatedAt) {
      const rows = await getDb()
        .update(parties)
        .set({ avatarR2Key: key, avatarUpdatedAt: updatedAt })
        .where(and(eq(parties.organizationId, orgId), eq(parties.id, partyId), isNull(parties.deletedAt)))
        .returning({ id: parties.id });
      return rows.length > 0;
    },
    putObject,
    deleteObject: deleteDocument,
    getObject: getObjectStream,
    now: () => new Date(),
  };
}
